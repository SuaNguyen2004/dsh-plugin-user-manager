import fs from 'node:fs';
import path from 'node:path';
import { authenticateRequest, parseJsonBody, sendJson } from './auth.js';

const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..');
const WORKSPACES_ROOT = path.join(PLUGIN_ROOT, 'workspaces');

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

  console.log('[dsh-plugin-user-manager] Workspace routes registered:');
  console.log('  - GET  /api/workspace/files');
  console.log('  - GET  /api/workspace/file?path=...');
  console.log('  - POST /api/workspace/file');
}
