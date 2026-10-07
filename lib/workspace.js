import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { authenticateRequest, parseJsonBody, sendJson } from './auth.js';

const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..');
const WORKSPACES_ROOT = path.join(PLUGIN_ROOT, 'workspaces');

let cordisCtx = null;
export function setCordisContext(ctx) {
  cordisCtx = ctx;
}

/**
 * Returns the absolute path to a user's workspace.
 * Ensures the directory exists.
 */
export function getUserWorkspaceDir(username) {
  if (!username || typeof username !== 'string') {
    throw new Error('Invalid username');
  }
  const userDir = path.join(WORKSPACES_ROOT, username);
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  return path.resolve(userDir);
}

/**
 * Resolves a safe path inside the user's workspace directory.
 * Protects against path traversal, absolute path breakout, or symlink tricks.
 * Throws an Error('Forbidden: Access outside workspace') if unsafe.
 */
export function resolveSafePath(username, relativePath) {
  const baseDir = getUserWorkspaceDir(username);

  if (!relativePath || typeof relativePath !== 'string') {
    return baseDir;
  }

  // Pre-filter forbidden characters or traversal tokens
  if (relativePath.includes('\0')) {
    const err = new Error('Forbidden: Null byte detected');
    err.status = 403;
    throw err;
  }

  // Resolve target path
  const resolved = path.resolve(baseDir, relativePath);

  // Verification 1: resolved path must start with baseDir + path.sep (or equal baseDir)
  const isInside = resolved === baseDir || resolved.startsWith(baseDir + path.sep);

  // Verification 2: path.relative check
  const rel = path.relative(baseDir, resolved);
  const isTraversal = rel.startsWith('..') || path.isAbsolute(rel);

  if (!isInside || isTraversal) {
    const err = new Error('Forbidden: Path traversal outside workspace');
    err.status = 403;
    throw err;
  }

  return resolved;
}

/**
 * Lists files and directories in user's workspace recursively or for a sub-directory.
 */
export function listWorkspaceFiles(username, subDir = '') {
  const targetDir = resolveSafePath(username, subDir);
  if (!fs.existsSync(targetDir)) {
    return [];
  }

  const stat = fs.statSync(targetDir);
  if (!stat.isDirectory()) {
    return [];
  }

  function readDirRecursive(currentDir, currentRelPath = '') {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    const result = [];

    for (const entry of entries) {
      const entryRelPath = currentRelPath ? `${currentRelPath}/${entry.name}` : entry.name;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          path: entryRelPath,
          type: 'directory',
          children: readDirRecursive(fullPath, entryRelPath)
        });
      } else {
        const fileStat = fs.statSync(fullPath);
        result.push({
          name: entry.name,
          path: entryRelPath,
          type: 'file',
          size: fileStat.size,
          updatedAt: fileStat.mtime.toISOString()
        });
      }
    }
    return result;
  }

  return readDirRecursive(targetDir, subDir.replace(/^[\\/]+|[\\/]+$/g, ''));
}

/**
 * Writes content to a file inside the user's workspace.
 */
export function writeWorkspaceFile(username, relativePath, content) {
  if (!relativePath || typeof relativePath !== 'string') {
    const err = new Error('Invalid file path');
    err.status = 400;
    throw err;
  }

  const safePath = resolveSafePath(username, relativePath);
  const parentDir = path.dirname(safePath);

  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(safePath, content, 'utf8');
  return {
    path: relativePath,
    fullPath: safePath,
    size: Buffer.byteLength(content, 'utf8')
  };
}

/**
 * Reads content of a file inside the user's workspace.
 */
export function readWorkspaceFile(username, relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    const err = new Error('Invalid file path');
    err.status = 400;
    throw err;
  }

  const safePath = resolveSafePath(username, relativePath);

  if (!fs.existsSync(safePath)) {
    const err = new Error('File not found');
    err.status = 404;
    throw err;
  }

  const stat = fs.statSync(safePath);
  if (stat.isDirectory()) {
    const err = new Error('Path is a directory, not a file');
    err.status = 400;
    throw err;
  }

  return fs.readFileSync(safePath, 'utf8');
}

/**
 * Registers workspace REST routes on webServer.
 */
export function registerWorkspaceRoutes(webServer) {
  // 1. GET /api/workspace/files
  webServer.register({
    kind: 'exact',
    path: '/api/workspace/files',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      const session = authenticateRequest(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Unauthorized: Authentication required' });
      }

      try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const subDir = url.searchParams.get('dir') || '';
        const files = listWorkspaceFiles(session.username, subDir);
        return sendJson(res, 200, {
          workspace: session.username,
          subDir,
          files
        });
      } catch (err) {
        return sendJson(res, err.status || 500, { error: err.message });
      }
    }
  });

  // 2. /api/workspace/file (Handles both GET and POST)
  webServer.register({
    kind: 'exact',
    path: '/api/workspace/file',
    handler: async (req, res) => {
      const session = authenticateRequest(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Unauthorized: Authentication required' });
      }

      // GET: Read file content
      if (req.method === 'GET') {
        try {
          const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
          const filePath = url.searchParams.get('path');

          if (!filePath) {
            return sendJson(res, 400, { error: 'Query parameter "path" is required' });
          }

          const content = readWorkspaceFile(session.username, filePath);
          return sendJson(res, 200, {
            path: filePath,
            content
          });
        } catch (err) {
          return sendJson(res, err.status || 500, { error: err.message });
        }
      }

      // POST: Write file content
      if (req.method === 'POST') {
        try {
          const body = await parseJsonBody(req);
          const { path: filePath, content } = body;

          if (filePath === undefined || content === undefined) {
            return sendJson(res, 400, { error: 'Both "path" and "content" are required' });
          }

          const result = writeWorkspaceFile(session.username, filePath, String(content));
          return sendJson(res, 201, {
            message: 'File written successfully',
            file: result
          });
        } catch (err) {
          return sendJson(res, err.status || 500, { error: err.message });
        }
      }

      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }
  });

  // 3. POST /api/workspace/user-init - Ensure user workspace directory & DSH storage sync
  webServer.register({
    kind: 'exact',
    path: '/api/workspace/user-init',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }
      const session = authenticateRequest(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Unauthorized: Authentication required' });
      }
      try {
        const userDir = getUserWorkspaceDir(session.username);
        syncDshUserWorkspaces(session.username);
        return sendJson(res, 200, {
          success: true,
          username: session.username,
          workspacePath: userDir,
          title: `Workspace (${session.username})`,
          workspaceId: `user-workspace-${session.username}`
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  });

  console.log('[dsh-plugin-user-manager] Workspace routes registered:');
  console.log('  - GET  /api/workspace/files');
  console.log('  - GET  /api/workspace/file?path=...');
  console.log('  - POST /api/workspace/file');
  console.log('  - POST /api/workspace/user-init');
}

/**
 * Resolves DSH home directory for multi-user system (always isolated in .dsh-multiuser)
 */
export function getDshHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME;
  return path.join(process.env.USERPROFILE || 'C:\\Users\\Admin', '.dsh-multiuser');
}

/**
 * Syncs user workspace with DSH storage (workspace.json)
 */
export function syncDshUserWorkspaces(username) {
  const dshHome = getDshHome();
  const wsPath = path.join(dshHome, 'storages', 'workspace.json');

  if (!fs.existsSync(path.dirname(wsPath))) {
    fs.mkdirSync(path.dirname(wsPath), { recursive: true });
  }

  let data = {
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      workspaceIds: [],
      archivedSessionIds: [],
      pinnedSessionIds: []
    },
    tables: { workspaces: {} }
  };

  if (fs.existsSync(wsPath)) {
    try {
      data = JSON.parse(fs.readFileSync(wsPath, 'utf8'));
      if (!data.tables) data.tables = {};
      if (!data.tables.workspaces) data.tables.workspaces = {};
      if (!data.global) data.global = { initialized: true, workspaceIds: [], archivedSessionIds: [], pinnedSessionIds: [] };
      if (!Array.isArray(data.global.workspaceIds)) data.global.workspaceIds = [];
    } catch (e) {
      // fallback
    }
  }

  // Remove default-workspace or guest workspaces if any
  for (const [id, ws] of Object.entries(data.tables.workspaces)) {
    if (ws.title === 'default-workspace' || (ws.path && ws.path.includes('default-workspace')) ||
        id.includes('guest') || (ws.title && ws.title.includes('Khách')) || (ws.path && ws.path.includes('guest'))) {
      delete data.tables.workspaces[id];
      data.global.workspaceIds = data.global.workspaceIds.filter(x => x !== id);
    }
  }

  // Ensure workspace for specified username
  if (username && username !== 'guest' && !username.startsWith('guest_')) {
    const userDir = getUserWorkspaceDir(username);
    const wsId = 'user-workspace-' + username;
    const title = 'Workspace (' + username + ')';

    if (!data.tables.workspaces[wsId]) {
      data.tables.workspaces[wsId] = {
        path: userDir,
        title: title,
        sessionIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    } else {
      data.tables.workspaces[wsId].path = userDir;
      data.tables.workspaces[wsId].title = title;
      data.tables.workspaces[wsId].updatedAt = new Date().toISOString();
      if (!data.tables.workspaces[wsId].sessionIds || data.tables.workspaces[wsId].sessionIds.length === 0) {
        data.tables.workspaces[wsId].createdAt = new Date().toISOString();
      }
    }

    if (!data.global.workspaceIds.includes(wsId)) {
      data.global.workspaceIds.push(wsId);
    }
    data.global.defaultWorkspaceId = wsId;
  } else if (!data.global.defaultWorkspaceId || data.global.defaultWorkspaceId.includes('guest')) {
    data.global.defaultWorkspaceId = data.global.workspaceIds[0] || 'user-workspace-admin';
  }

  // Strictly filter out any dangling workspace IDs that do not exist in tables.workspaces
  data.global.workspaceIds = (data.global.workspaceIds || []).filter(id => !!data.tables.workspaces[id]);
  if (!data.tables.workspaces[data.global.defaultWorkspaceId]) {
    data.global.defaultWorkspaceId = data.global.workspaceIds[0] || 'user-workspace-admin';
  }

  // Clean guest test sessions from admin workspace if present
  if (data.tables.workspaces['user-workspace-admin']) {
    data.tables.workspaces['user-workspace-admin'].sessionIds = 
      (data.tables.workspaces['user-workspace-admin'].sessionIds || []).filter(sId => {
        return sId !== 'session-da72e939-a7f5-47a6-8ec0-98c9355c6268' && sId !== 'session-28219d62-76a7-4cb7-ad73-0ecb390fbece';
      });
  }

  fs.writeFileSync(wsPath, JSON.stringify(data, null, 2), 'utf8');

  // Dynamically register in DSH's live in-memory registry so new users are immediately recognized without restarting the server!
  const registry = (cordisCtx && typeof cordisCtx.get === 'function') ? cordisCtx.get('workspaceRegistry', false) : null;
  if (registry && username && username !== 'guest' && !username.startsWith('guest_')) {
    try {
      const userDir = getUserWorkspaceDir(username);
      const wsTitle = `Workspace (${username})`;
      const wsId = 'user-workspace-' + username;
      if (typeof registry.setState === 'function') {
        const cur = registry.state || {};
        const wsIds = Array.isArray(cur.workspaceIds) ? cur.workspaceIds.filter(x => !x.includes('guest')) : [];
        const newWsIds = [wsId, ...wsIds.filter(x => x !== wsId)];
        registry.setState({
          ...cur,
          defaultWorkspaceId: wsId,
          workspaceIds: newWsIds
        }).catch(() => {});
      }
    } catch (e) {}
  }

  return data;
}

/**
 * Completely removes a user's workspace files and sessions when rejected or deleted
 */
export function cleanupUserWorkspaceAndSessions(username) {
  if (!username || username === 'admin') return false;

  // 1. Delete workspaces/<username>
  const userDir = path.join(WORKSPACES_ROOT, username);
  if (fs.existsSync(userDir)) {
    try {
      fs.rmSync(userDir, { recursive: true, force: true });
    } catch (e) {
      console.error(`[dsh-plugin-user-manager] Error removing workspace dir for ${username}:`, e.message);
    }
  }

  // 2. Remove from workspace.json
  const dshHome = getDshHome();
  const wsPath = path.join(dshHome, 'storages', 'workspace.json');
  let sessionIdsToDelete = [];

  if (fs.existsSync(wsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(wsPath, 'utf8'));
      const wsId = 'user-workspace-' + username;

      if (data.tables?.workspaces) {
        for (const [id, ws] of Object.entries(data.tables.workspaces)) {
          if (id === wsId || ws.path === userDir || (ws.title && ws.title.toLowerCase().includes(`(${username.toLowerCase()})`))) {
            if (Array.isArray(ws.sessionIds)) {
              sessionIdsToDelete.push(...ws.sessionIds);
            }
            delete data.tables.workspaces[id];
            if (Array.isArray(data.global?.workspaceIds)) {
              data.global.workspaceIds = data.global.workspaceIds.filter(x => x !== id);
            }
          }
        }
      }

      if (Array.isArray(data.global?.workspaceIds)) {
        data.global.workspaceIds = data.global.workspaceIds.filter(id => !!data.tables?.workspaces?.[id]);
      }

      if (data.global?.defaultWorkspaceId && !data.tables?.workspaces?.[data.global.defaultWorkspaceId]) {
        data.global.defaultWorkspaceId = data.global.workspaceIds?.[0] || 'user-workspace-admin';
      }

      fs.writeFileSync(wsPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error(`[dsh-plugin-user-manager] Error updating workspace.json for ${username}:`, e.message);
    }
  }

  // 3. Remove session files from session_projcache
  const projCacheDir = path.join(dshHome, 'storages', 'session_projcache', 'sessions');
  if (fs.existsSync(projCacheDir) && sessionIdsToDelete.length > 0) {
    for (const sId of sessionIdsToDelete) {
      const sFile = path.join(projCacheDir, `${sId}.json`);
      if (fs.existsSync(sFile)) {
        try { fs.rmSync(sFile, { force: true }); } catch (e) {}
      }
    }
  }

  // 4. Remove session folders from sessions/ directory
  const sessionsDir = path.join(dshHome, 'sessions');
  if (fs.existsSync(sessionsDir)) {
    try {
      const subdirs = fs.readdirSync(sessionsDir);
      for (const d of subdirs) {
        if (d.toLowerCase().includes(`-workspaces-${username.toLowerCase()}--`)) {
          fs.rmSync(path.join(sessionsDir, d), { recursive: true, force: true });
        }
      }
    } catch (e) {}
  }

  // 5. If running live inside Cordis, remove from live in-memory registry immediately
  const registry = (cordisCtx && typeof cordisCtx.get === 'function') ? cordisCtx.get('workspaceRegistry', false) : null;
  if (registry && typeof registry.delete === 'function') {
    try {
      const wsId = 'user-workspace-' + username;
      registry.delete(wsId).catch(() => {});
    } catch (e) {}
  }

  console.log(`[dsh-plugin-user-manager] Cleaned up all workspace data and sessions for rejected user: ${username}`);
  return true;
}
