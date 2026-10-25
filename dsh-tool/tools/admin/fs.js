// dsh-tool/tools/admin/fs.js
// Admin-role filesystem tools — Read/Write in /data/workspace/admin/<ws>, Read-Only in /data/all_users_ro

import fs from 'node:fs';
import path from 'node:path';
import {
  ensureWorkspaceStructure,
  resolveCategorizedFilePath,
  autoOrganizeWorkspaceStrayFiles,
  categorizeFile,
  sanitizeSegment,
  normalizeWorkspaceName
} from '../common/auto-categorize.js';
import { guardAdminPath, findFileInWorkspace } from '../common/path-guard.js';

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/data';
const RO_ROOT = process.env.ALL_USERS_RO_ROOT || '/data/all_users_ro';

export async function ensureWorkspace(args, ctx) {
  const username = sanitizeSegment(ctx.username || process.env.DSH_USERNAME || 'admin', 'admin');
  const wsName = normalizeWorkspaceName(args.workspace || ctx.workspace || 'default-workspace', username);
  const wsDir = ensureWorkspaceStructure(WORKSPACE_ROOT, username, wsName);
  autoOrganizeWorkspaceStrayFiles(WORKSPACE_ROOT, username, wsName);
  return {
    ok: true,
    username,
    workspace: wsName,
    workspacePath: wsDir
  };
}

export async function writeFile(args, ctx) {
  const username = sanitizeSegment(ctx.username || process.env.DSH_USERNAME || 'admin', 'admin');
  const wsName = normalizeWorkspaceName(args.workspace || ctx.workspace || 'default-workspace', username);
  const reqPath = args.file_path || args.path || args.filename;
  if (!reqPath) throw new Error('Thiếu tham số file_path.');

  // Guard write (rejects /data/all_users_ro immediately)
  guardAdminPath({
    workspaceRoot: WORKSPACE_ROOT,
    roRoot: RO_ROOT,
    username,
    workspace: wsName,
    targetPath: reqPath,
    mode: 'write'
  });

  const finalPath = resolveCategorizedFilePath(WORKSPACE_ROOT, username, wsName, reqPath);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });

  if (args.encoding === 'base64') {
    fs.writeFileSync(finalPath, Buffer.from(args.content || '', 'base64'));
  } else {
    fs.writeFileSync(finalPath, String(args.content ?? ''), 'utf8');
  }

  return {
    ok: true,
    path: finalPath,
    category: categorizeFile(finalPath),
    bytes: fs.statSync(finalPath).size
  };
}

export async function uploadFile(args, ctx) {
  return writeFile({
    ...args,
    file_path: args.filename || args.file_path || args.path,
    encoding: args.encoding || 'base64'
  }, ctx);
}

export async function readFile(args, ctx) {
  const username = sanitizeSegment(ctx.username || process.env.DSH_USERNAME || 'admin', 'admin');
  const wsName = normalizeWorkspaceName(args.workspace || ctx.workspace || 'default-workspace', username);
  const reqPath = args.file_path || args.path;
  if (!reqPath) throw new Error('Thiếu tham số file_path.');

  const wsDir = ensureWorkspaceStructure(WORKSPACE_ROOT, username, wsName);
  let targetPath = guardAdminPath({
    workspaceRoot: WORKSPACE_ROOT,
    roRoot: RO_ROOT,
    username,
    workspace: wsName,
    targetPath: reqPath,
    mode: 'read'
  });

  if (!fs.existsSync(targetPath)) {
    const found = findFileInWorkspace(wsDir, reqPath);
    if (found) targetPath = found;
  }

  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    throw new Error(`Không tìm thấy tệp "${reqPath}".`);
  }

  const content = fs.readFileSync(targetPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const offset = Math.max(1, Number(args.offset) || 1);
  const limit = Math.max(1, Number(args.limit) || lines.length || 1);
  const sliced = lines.slice(offset - 1, offset - 1 + limit);

  return {
    ok: true,
    path: targetPath,
    totalLines: lines.length,
    offset,
    content: sliced.join('\n')
  };
}

export async function readBytes(args, ctx) {
  const username = sanitizeSegment(ctx.username || process.env.DSH_USERNAME || 'admin', 'admin');
  const wsName = normalizeWorkspaceName(args.workspace || ctx.workspace || 'default-workspace', username);
  const reqPath = args.file_path || args.path;
  if (!reqPath) throw new Error('Thiếu tham số file_path.');

  const wsDir = ensureWorkspaceStructure(WORKSPACE_ROOT, username, wsName);
  let targetPath = guardAdminPath({
    workspaceRoot: WORKSPACE_ROOT,
    roRoot: RO_ROOT,
    username,
    workspace: wsName,
    targetPath: reqPath,
    mode: 'read'
  });

  if (!fs.existsSync(targetPath)) {
    const found = findFileInWorkspace(wsDir, reqPath);
    if (found) targetPath = found;
  }

  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    throw new Error(`Không tìm thấy tệp "${reqPath}".`);
  }

  const buf = fs.readFileSync(targetPath);
  return {
    ok: true,
    path: targetPath,
    bytes: buf.length,
    base64: buf.toString('base64')
  };
}

export async function editFile(args, ctx) {
  const username = sanitizeSegment(ctx.username || process.env.DSH_USERNAME || 'admin', 'admin');
  const wsName = normalizeWorkspaceName(args.workspace || ctx.workspace || 'default-workspace', username);
  const reqPath = args.file_path || args.path;
  if (!reqPath) throw new Error('Thiếu tham số file_path.');

  const wsDir = ensureWorkspaceStructure(WORKSPACE_ROOT, username, wsName);
  let targetPath = guardAdminPath({
    workspaceRoot: WORKSPACE_ROOT,
    roRoot: RO_ROOT,
    username,
    workspace: wsName,
    targetPath: reqPath,
    mode: 'edit'
  });

  if (!fs.existsSync(targetPath)) {
    const found = findFileInWorkspace(wsDir, reqPath);
    if (found) targetPath = found;
  }

  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    throw new Error(`Không tìm thấy tệp "${reqPath}" để chỉnh sửa.`);
  }

  const oldString = String(args.old_string ?? args.old_str ?? '');
  const newString = String(args.new_string ?? args.new_str ?? '');
  const current = fs.readFileSync(targetPath, 'utf8');
  if (!current.includes(oldString)) {
    throw new Error(`Không tìm thấy đoạn văn bản cần thay thế trong "${targetPath}".`);
  }

  const updated = args.replace_all
    ? current.split(oldString).join(newString)
    : current.replace(oldString, newString);

  fs.writeFileSync(targetPath, updated, 'utf8');
  return {
    ok: true,
    path: targetPath,
    bytes: Buffer.byteLength(updated, 'utf8')
  };
}

export async function statFile(args, ctx) {
  const username = sanitizeSegment(ctx.username || process.env.DSH_USERNAME || 'admin', 'admin');
  const wsName = normalizeWorkspaceName(args.workspace || ctx.workspace || 'default-workspace', username);
  const reqPath = args.file_path || args.path || '.';

  const wsDir = ensureWorkspaceStructure(WORKSPACE_ROOT, username, wsName);
  let targetPath = guardAdminPath({
    workspaceRoot: WORKSPACE_ROOT,
    roRoot: RO_ROOT,
    username,
    workspace: wsName,
    targetPath: reqPath,
    mode: 'read'
  });

  if (!fs.existsSync(targetPath)) {
    const found = findFileInWorkspace(wsDir, reqPath);
    if (found) targetPath = found;
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Không tồn tại đường dẫn "${reqPath}".`);
  }

  const st = fs.statSync(targetPath);
  return {
    ok: true,
    path: targetPath,
    type: st.isDirectory() ? 'directory' : 'file',
    size: st.size,
    mtimeMs: st.mtimeMs
  };
}

export async function listDir(args, ctx) {
  const username = sanitizeSegment(ctx.username || process.env.DSH_USERNAME || 'admin', 'admin');
  const wsName = normalizeWorkspaceName(args.workspace || ctx.workspace || 'default-workspace', username);
  const reqPath = args.path || args.dir_path || '.';

  ensureWorkspaceStructure(WORKSPACE_ROOT, username, wsName);
  const targetDir = guardAdminPath({
    workspaceRoot: WORKSPACE_ROOT,
    roRoot: RO_ROOT,
    username,
    workspace: wsName,
    targetPath: reqPath,
    mode: 'read'
  });

  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new Error(`Thư mục không tồn tại: "${reqPath}".`);
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true }).map((e) => {
    const full = path.join(targetDir, e.name);
    const st = fs.statSync(full);
    return {
      name: e.name,
      type: e.isDirectory() ? 'directory' : 'file',
      size: e.isFile() ? st.size : undefined
    };
  });

  return {
    ok: true,
    path: targetDir,
    entries
  };
}

export async function searchFiles(args, ctx) {
  const username = sanitizeSegment(ctx.username || process.env.DSH_USERNAME || 'admin', 'admin');
  const wsName = normalizeWorkspaceName(args.workspace || ctx.workspace || 'default-workspace', username);
  const wsDir = ensureWorkspaceStructure(WORKSPACE_ROOT, username, wsName);
  const query = String(args.query || args.pattern || '').toLowerCase();
  const includeUsers = Boolean(args.includeUsers);

  const matches = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.posix.join(dir.replace(/\\/g, '/'), entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (!query || entry.name.toLowerCase().includes(query)) {
          matches.push(full);
        }
      }
    }
  }
  walk(wsDir);
  if (includeUsers && fs.existsSync(RO_ROOT)) {
    walk(RO_ROOT);
  }
  return {
    ok: true,
    workspace: wsName,
    matches
  };
}
