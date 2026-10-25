// dsh-main/lib/exec-client.js
// The single door from the shared DSH core to the on-demand tool sandbox.
// dsh-main mounts NO workspace volume: every file/shell operation the model asks for
// is POSTed to the gateway's internal exec router, which lazy-spawns dsh-tool-<username>
// and docker-execs the role-scoped runner there.
//
// Identity is taken from the CHILD PROCESS ENVIRONMENT (DSH_USER_ID / DSH_USER_NAME /
// DSH_USER_ROLE), which the dsh-main router set when it spawned this tenant — never from
// request-controlled data, so a prompt cannot redirect tool execution into another tenant.

import fs from 'node:fs';

const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL || 'http://dsh-gateway:3091';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';

export function tenantIdentity() {
  return {
    userId: process.env.DSH_USER_ID || '0',
    username: process.env.DSH_USER_NAME || 'user',
    role: (process.env.DSH_USER_ROLE || 'user').toLowerCase() === 'admin' ? 'admin' : 'user'
  };
}

/**
 * Execute one tool in this tenant's sandbox container.
 * @returns {Promise<{ok:boolean, result?:any, error?:string, code?:string}>}
 */
export async function execRemote(tool, args = {}, { workspace, timeoutMs } = {}) {
  const id = tenantIdentity();
  const gatewayUrl = process.env.GATEWAY_INTERNAL_URL || 'http://dsh-gateway:3091';
  const internalToken = process.env.INTERNAL_TOKEN || '';
  const body = JSON.stringify({ tool, args, userId: id.userId, username: id.username, role: id.role, workspace, timeoutMs });
  const res = await fetch(`${gatewayUrl}/internal/exec`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dsh-internal-token': internalToken
    },
    body
  });
  let json;
  try { json = await res.json(); } catch { json = { ok: false, error: `non-JSON response (HTTP ${res.status})`, code: 'EXEC_BAD_RESPONSE' }; }
  if (!res.ok && json.ok === undefined) json.ok = false;
  return json;
}

/**
 * Translate a DSH-internal attachment path into the canonical sandbox path.
 *
 * Why this exists: DSH's attachment mechanism embeds its OWN storage path
 * (`$DSH_HOME/attachments/v1/files/<prefix>/<sha>/<name>`, i.e. under the
 * dsh-homes volume) into the prompt it sends to the model. The sandbox
 * container deliberately does NOT mount dsh-homes (it would expose every
 * user's chat history), so a tool call using that path is rejected by the
 * path guard. Uploads are already forwarded into the sandbox by Patch 8, so
 * the correct target is always /data/workspace/<user>/<ws>/files/<cat>/<name>.
 *
 * Resolution order:
 *   1. workspace_files_index.json (attachmentId -> real sandbox path, written on upload)
 *   2. deterministic fallback built from the filename in the path
 * Non-attachment paths are returned unchanged.
 */
export function resolveSandboxPath(filePath, { workspace } = {}) {
  if (typeof filePath !== 'string' || !filePath) return filePath;
  const id = tenantIdentity();
  const attRe = /\/attachments\/v1\/files\/[0-9a-f]{2}\/([0-9a-f]{64})\/(.+)$/i;
  const m = attRe.exec(filePath);
  if (!m) return filePath;

  const [, sha, encodedName] = m;
  const name = decodeURIComponent(encodedName);

  const indexed = attachmentIndex()[`sha256:${sha}`] || attachmentIndex()[sha];
  if (indexed) return indexed;

  return posixJoinWorkspace(workspace, name, id);
}

let indexCache = null;
let indexCacheMtime = 0;
function attachmentIndex() {
  const dshHome = process.env.DSH_HOME || '/data/dsh_home';
  const indexPath = `${dshHome}/attachments/v1/workspace_files_index.json`;
  try {
    const st = require$fs().statSync(indexPath);
    if (!indexCache || st.mtimeMs !== indexCacheMtime) {
      indexCache = JSON.parse(require$fs().readFileSync(indexPath, 'utf8'));
      indexCacheMtime = st.mtimeMs;
    }
    return indexCache || {};
  } catch {
    return {};
  }
}

function require$fs() {
  if (!fsModule) fsModule = require('node:fs');
  return fsModule;
}
let fsModule = null;

function posixJoinWorkspace(workspace, name, id) {
  const cat = categorize(name);
  const ws = String(workspace || resolveActiveWorkspaceFromDisk() || process.env.DSH_WORKSPACE || 'default-workspace').replace(/[\\/:*?"<>|]/g, '_');
  const user = String(id.username || 'user').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return `/data/${user}/${ws}/files/${cat}/${name}`;
}

/**
 * Determine the user's currently active workspace name from $DSH_HOME/storages/workspace.json
 * (picks the most recently updated non-RO workspace, or 'default-workspace').
 */
export function resolveActiveWorkspaceFromDisk(sessionId) {
  const dshHome = process.env.DSH_HOME || '/data/dsh_home';
  const wsJsonPath = `${dshHome}/storages/workspace.json`;
  try {
    if (!fs.existsSync(wsJsonPath)) return null;
    const wsData = JSON.parse(fs.readFileSync(wsJsonPath, 'utf8'));
    const workspaces = wsData?.tables?.workspaces || {};
    if (sessionId) {
      for (const [wsId, ws] of Object.entries(workspaces)) {
        if (wsId.startsWith('ro-') || !ws) continue;
        const sids = Array.isArray(ws.sessionIds) ? ws.sessionIds : [];
        if (sids.includes(sessionId) || sids.includes(`session-${sessionId}`)) {
          const t = String(ws.title || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
          if (t && t.toLowerCase() !== 'workspace') return t;
        }
      }
    }
    // Fallback: pick the workspace with the newest updatedAt (excluding default "Workspace (<user>)" if user created a named workspace like "Test")
    let best = null;
    let bestTime = -1;
    for (const [wsId, ws] of Object.entries(workspaces)) {
      if (wsId.startsWith('ro-') || !ws) continue;
      const t = String(ws.title || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (!t || t.toLowerCase() === 'workspace') continue;
      const ts = Date.parse(ws.updatedAt || ws.createdAt || '') || 0;
      if (ts >= bestTime) {
        bestTime = ts;
        best = t;
      }
    }
    return best;
  } catch {
    return null;
  }
}

const CATEGORY_BY_EXT = {
  docs: ['doc', 'docx', 'dot', 'dotx', 'odt', 'rtf', 'txt', 'md', 'json', 'yaml', 'yml', 'xml', 'log', 'py', 'js', 'ts', 'html', 'css'],
  pdf: ['pdf'],
  sheets: ['xls', 'xlsx', 'xlsm', 'csv', 'tsv'],
  images: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']
};
function categorize(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  for (const [cat, exts] of Object.entries(CATEGORY_BY_EXT)) if (exts.includes(ext)) return cat;
  return 'others';
}

/** UTF-8 read of a workspace file through the sandbox. */
export async function readFileRemote(filePath, workspace) {
  const r = await execRemote('read_file', { file_path: resolveSandboxPath(filePath, { workspace }), workspace }, { workspace });
  return r.ok ? r.result.content : null;
}

/** Base64 bytes of a workspace file through the sandbox. */
export async function readBytesRemote(filePath, workspace) {
  const r = await execRemote('read_bytes', { file_path: resolveSandboxPath(filePath, { workspace }), workspace }, { workspace });
  return r.ok ? r.result.base64 : null;
}
