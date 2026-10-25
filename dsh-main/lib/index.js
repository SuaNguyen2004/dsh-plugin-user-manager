// dsh-main/lib/index.js
// Enterprise tenant plugin, loaded into every per-tenant DSH child process (dsh-main).
//
// Role in the architecture:
//   dsh-main runs ONE shared DSH core container; the router spawns one DSH child per tenant,
//   each with a private DSH_HOME under the dsh-homes volume. All local fs/bash/search tools
//   are disabled at both the profile and preset layers, and this plugin registers the remote
//   sandbox tools (`read`, `write`, `edit`, `list_dir`, `bash`, `read_document`, `search_files`).
//   Every call is POSTed to the gateway's internal exec router, which lazy-spawns
//   `dsh-tool-<username>` and executes inside `/data/<username>/<workspace>/files/<category>/<file>`.

import { execRemote, resolveSandboxPath, resolveActiveWorkspaceFromDisk } from './exec-client.js';
import { syncContainerWorkspace } from './user/workspace.js';

let enterpriseUi;
try {
  enterpriseUi = await import('../inject-ui.cjs');
} catch (e) {
  console.warn('[dsh-tenant-plugin] inject-ui unavailable:', e.message);
}

export const name = 'dsh-user-container-plugin';
export const inject = ['tools', 'systemPrompt'];

function unwrapRemote(res, fallbackError = 'Tool sandbox call failed.') {
  if (res && res.ok) {
    const r = res.result ?? {};
    const text = typeof r === 'string' ? r
      : r.content !== undefined ? String(r.content)
      : r.text !== undefined ? String(r.text)
      : JSON.stringify(r, null, 2);
    return { path: String(r.path ?? r.cwd ?? ''), text };
  }
  const msg = `${res?.error || fallbackError}${res?.code ? ` (${res.code})` : ''}`;
  const err = new Error(msg);
  if (res?.code) err.code = res.code;
  throw err;
}

const textValueSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { path: { type: 'string' }, text: { type: 'string' } }
};
const textRender = (args, value) => [{ type: 'text', text: value?.text ?? '' }];

function currentWorkspace(args, exec) {
  if (args?.workspace) return args.workspace;
  if (process.env.DSH_WORKSPACE) return process.env.DSH_WORKSPACE;
  const sessionId = exec?.agent?.id || exec?.agent?.session?.id;
  return resolveActiveWorkspaceFromDisk(sessionId) || 'default-workspace';
}

export async function apply(ctx) {
  const ROLE = String(process.env.DSH_USER_ROLE || 'user').toLowerCase() === 'admin' ? 'admin' : 'user';
  const USERNAME = process.env.DSH_USER_NAME || 'user';
  ctx.logger?.info?.(`[dsh-tenant-plugin] tenant=${USERNAME} role=${ROLE} -> remote tools via exec router (/data/${USERNAME}/<ws>/files/<cat>/<file>)`);

  try {
    syncContainerWorkspace(USERNAME, ROLE);
    if (ROLE === 'admin') {
      const iv = setInterval(() => {
        try { syncContainerWorkspace(USERNAME, ROLE); } catch {}
      }, 5000);
      if (iv.unref) iv.unref();
    }
  } catch (e) {
    console.warn('[dsh-tenant-plugin] syncContainerWorkspace warning:', e.message);
  }

  ctx.inject(['webServer'], (webCtx) => {
    const injectFn = enterpriseUi?.injectIntoHtml || enterpriseUi?.default?.injectIntoHtml;
    if (typeof injectFn === 'function' && typeof webCtx.webServer?.tapIndex === 'function') {
      webCtx.effect(() => webCtx.webServer.tapIndex((html) => injectFn(html, { username: USERNAME, role: ROLE })), 'dsh-tenant-plugin: enterprise UI');
    }
  });

  ctx.tools.register({
    name: 'read',
    description: 'Read a text file from your workspace (/data/<user>/<workspace>/files/<type>/<file>).',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path or filename inside your workspace.' },
      offset: { type: 'number', description: '1-based first line. Defaults to 1.' },
      limit: { type: 'number', description: 'Max lines to return.' }
    },
    output: { schema: textValueSchema, render: textRender },
    async execute(args, exec) {
      const ws = currentWorkspace(args, exec);
      const targetPath = resolveSandboxPath(args.file_path, { workspace: ws });
      const res = await execRemote('read_file', { file_path: targetPath, workspace: ws, offset: args.offset, limit: args.limit }, { workspace: ws });
      return unwrapRemote(res, 'read failed');
    }
  });

  ctx.tools.register({
    name: 'write',
    description: 'Create or replace a file in your workspace. Automatically stored under /data/<user>/<workspace>/files/<category>/<file>.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path or filename inside your workspace.' },
      content: { type: 'string', required: true, description: 'Full UTF-8 content.' }
    },
    output: { schema: textValueSchema, render: textRender },
    async execute(args, exec) {
      const ws = currentWorkspace(args, exec);
      const targetPath = resolveSandboxPath(args.file_path, { workspace: ws });
      const res = await execRemote('write_file', { file_path: targetPath, content: args.content, workspace: ws }, { workspace: ws });
      if (res.ok) {
        const p = String(res.result?.path ?? targetPath);
        return { path: p, text: `Created file at ${p}` };
      }
      return unwrapRemote(res, 'write failed');
    }
  });

  ctx.tools.register({
    name: 'edit',
    description: 'Replace one exact string in a workspace file (executed in your sandbox).',
    parameters: {
      file_path: { type: 'string', required: true },
      old_string: { type: 'string', required: true },
      new_string: { type: 'string', required: true },
      replace_all: { type: 'boolean', description: 'Replace every occurrence.' }
    },
    output: { schema: textValueSchema, render: textRender },
    async execute(args, exec) {
      const ws = currentWorkspace(args, exec);
      const targetPath = resolveSandboxPath(args.file_path, { workspace: ws });
      const res = await execRemote('edit_file', {
        file_path: targetPath, old_string: args.old_string, new_string: args.new_string,
        replace_all: args.replace_all, workspace: ws
      }, { workspace: ws });
      return unwrapRemote(res, 'edit failed');
    }
  });

  ctx.tools.register({
    name: 'list_dir',
    description: 'List entries of a workspace directory (executed in your sandbox).',
    parameters: { path: { type: 'string', description: 'Directory inside your workspace. Defaults to workspace root.' } },
    output: { schema: textValueSchema, render: textRender },
    async execute(args, exec) {
      const ws = currentWorkspace(args, exec);
      const res = await execRemote('list_dir', { path: args.path || '.', workspace: ws }, { workspace: ws });
      return unwrapRemote(res, 'list failed');
    }
  });

  ctx.tools.register({
    name: 'bash',
    description: 'Run a shell command inside your isolated sandbox container (cwd = /data/<user>/<workspace>).',
    parameters: { command: { type: 'string', required: true, description: 'Shell command to run.' } },
    output: { schema: textValueSchema, render: textRender },
    async execute(args, exec) {
      const ws = currentWorkspace(args, exec);
      const res = await execRemote('bash', { command: args.command, workspace: ws }, { workspace: ws });
      if (res.ok) {
        const r = res.result || {};
        const body = `${r.stdout ?? ''}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}\n[exit ${r.exitCode}]`;
        return { path: String(r.cwd ?? ''), text: body.trim() || '(no output)' };
      }
      return unwrapRemote(res, 'bash failed');
    }
  });

  ctx.tools.register({
    name: 'read_document',
    description: 'Extract text from .docx / .pdf / .txt in your workspace (/data/<user>/<workspace>/files/<category>/<file>). Prefer this tool whenever reading PDF or Word documents.',
    parameters: { file_path: { type: 'string', required: true, description: 'Path or filename of the document.' } },
    output: { schema: textValueSchema, render: textRender },
    async execute(args, exec) {
      const ws = currentWorkspace(args, exec);
      const targetPath = resolveSandboxPath(args.file_path, { workspace: ws });
      const res = await execRemote('read_document', { file_path: targetPath, workspace: ws }, { workspace: ws });
      return unwrapRemote(res, 'read_document failed');
    }
  });

  ctx.tools.register({
    name: 'search_files',
    description: 'Search file names inside your workspace (executed in your sandbox).',
    parameters: { query: { type: 'string', description: 'Filename substring to match.' } },
    output: { schema: textValueSchema, render: textRender },
    async execute(args, exec) {
      const ws = currentWorkspace(args, exec);
      const res = await execRemote('search_files', { query: args.query || '', workspace: ws }, { workspace: ws });
      return unwrapRemote(res, 'search_files failed');
    }
  });

  if (ROLE === 'admin') {
    ctx.tools.register({
      name: 'admin_list_user_workspaces',
      description: 'List every user workspace and its files (read-only monitoring, runs in the admin sandbox).',
      parameters: {},
      output: { schema: textValueSchema, render: textRender },
      async execute(_args, exec) {
        const ws = currentWorkspace({}, exec);
        const res = await execRemote('admin_list_user_workspaces', {}, { workspace: ws });
        return unwrapRemote(res, 'admin_list_user_workspaces failed');
      }
    });
    ctx.tools.register({
      name: 'admin_read_user_file',
      description: 'Read one file from a user workspace through the read-only monitoring mount.',
      parameters: { file_path: { type: 'string', required: true, description: 'Path under /data/all_users_ro/...' } },
      output: { schema: textValueSchema, render: textRender },
      async execute(args, exec) {
        const ws = currentWorkspace(args, exec);
        const res = await execRemote('admin_read_user_file', { file_path: args.file_path }, { workspace: ws });
        return unwrapRemote(res, 'admin_read_user_file failed');
      }
    });
    ctx.tools.register({
      name: 'admin_audit_storage',
      description: 'Audit file counts and byte totals across all user workspaces (read-only).',
      parameters: {},
      output: { schema: textValueSchema, render: textRender },
      async execute(_args, exec) {
        const ws = currentWorkspace({}, exec);
        const res = await execRemote('admin_audit_storage', {}, { workspace: ws });
        return unwrapRemote(res, 'admin_audit_storage failed');
      }
    });
  }

  ctx.systemPrompt.section({
    name: 'tool:sandbox-boundary',
    order: Number(ctx.systemPrompt.getSectionOrder?.('TOOL_READ')) || 500,
    text: () => `All file and shell tools execute inside your isolated sandbox container (dsh-tool-${USERNAME}). Files are stored at /data/${USERNAME}/<workspace>/files/<category>/<filename> (categories: docs, pdf, sheets, images, others). For .pdf and .docx files, always use the read_document tool directly with the file path.`
  });
}
