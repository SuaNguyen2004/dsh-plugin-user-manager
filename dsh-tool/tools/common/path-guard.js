// dsh-tool/tools/common/path-guard.js
// Strict path containment and symlink-escape protection for dsh-tool sandboxes.

import fs from 'node:fs';
import path from 'node:path';
import {
  sanitizeSegment,
  extractWorkspaceFromPath,
  getUserWorkspaceDir,
  ALL_CATEGORIES
} from './auto-categorize.js';

export class PathGuardError extends Error {
  constructor(message, code = 'PATH_GUARD_DENIED') {
    super(message);
    this.name = 'PathGuardError';
    this.code = code;
  }
}

/**
 * Resolve the canonical realpath of a target, resolving the deepest existing ancestor
 * with fs.realpathSync so symlinks pointing outside the allowed root are caught even
 * before the final file is created.
 */
export function resolveCanonicalPath(targetPath) {
  let current = path.resolve(targetPath);
  const missingSegments = [];

  while (true) {
    try {
      const real = fs.realpathSync(current);
      if (missingSegments.length === 0) {
        return real.replace(/\\/g, '/');
      }
      return path.posix.join(real.replace(/\\/g, '/'), ...missingSegments.reverse());
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const parent = path.dirname(current);
      if (parent === current) {
        return path.resolve(targetPath).replace(/\\/g, '/');
      }
      missingSegments.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Check if `childPath` is strictly inside or equal to `rootPath` after canonical resolution.
 */
export function isPathInside(rootPath, childPath) {
  const realRoot = resolveCanonicalPath(rootPath).replace(/\/+$/, '');
  const realChild = resolveCanonicalPath(childPath).replace(/\/+$/, '');
  return realChild === realRoot || realChild.startsWith(realRoot + '/');
}

/**
 * Verify that `targetPath` does not contain any symbolic link along its path that points
 * outside `allowedRoot`.
 */
export function assertWithinRoot(allowedRoot, targetPath, mode = 'read') {
  if (!targetPath || typeof targetPath !== 'string' || targetPath.includes('\0')) {
    throw new PathGuardError('Đường dẫn không hợp lệ.', 'INVALID_PATH');
  }

  const absCandidate = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(allowedRoot, targetPath);

  if (!isPathInside(allowedRoot, absCandidate)) {
    throw new PathGuardError(
      `Truy cập bị từ chối (${mode}): Đường dẫn "${targetPath}" nằm ngoài phạm vi cho phép "${allowedRoot}".`,
      'OUTSIDE_WORKSPACE'
    );
  }

  const realRoot = resolveCanonicalPath(allowedRoot);
  if (!isPathInside(realRoot, absCandidate)) {
    throw new PathGuardError(
      `Truy cập bị từ chối (${mode}): Phát hiện symlink trỏ ra ngoài workspace tại "${targetPath}".`,
      'SYMLINK_ESCAPE'
    );
  }

  return resolveCanonicalPath(absCandidate);
}

function normalizeLegacyWorkspacePrefix(rawPath, workspaceRoot) {
  const normRoot = (workspaceRoot || '/data').replace(/\\/g, '/').replace(/\/+$/, '');
  const raw = String(rawPath || '.').replace(/\\/g, '/').trim();
  if (normRoot === '/data' && raw.startsWith('/data/workspace/')) {
    return '/data/' + raw.slice('/data/workspace/'.length);
  }
  if (normRoot === '/data' && raw === '/data/workspace') {
    return '/data';
  }
  return raw;
}

/**
 * Resolve and guard a path for a standard User (`role = user`).
 * Users are strictly confined to `/data/<username>/<workspace>` (and may access any of their own
 * workspaces under `/data/<username>/<ws>` when they pass an explicit `/data/<username>/<ws>/...` path),
 * with READ-ONLY access permitted to the shared Knowledge Base at `/data/kb_ro`.
 */
export function guardUserPath(arg1, arg2) {
  // Support both positional signature guardUserPath(path, mode) and options object signature
  let workspaceRoot = process.env.WORKSPACE_ROOT || '/data';
  let username = process.env.DSH_USERNAME || 'user';
  let workspace;
  let targetPath = '.';
  let mode = 'read';

  if (typeof arg1 === 'string') {
    targetPath = arg1;
    mode = arg2 || 'read';
  } else if (arg1 && typeof arg1 === 'object') {
    workspaceRoot = arg1.workspaceRoot ?? workspaceRoot;
    username = arg1.username ?? username;
    workspace = arg1.workspace;
    targetPath = arg1.targetPath ?? '.';
    mode = arg1.mode ?? 'read';
  }

  const cleanUser = sanitizeSegment(username, 'user');
  const normRoot = (workspaceRoot || '/data').replace(/\\/g, '/').replace(/\/+$/, '');
  const userRoot = path.posix.join(normRoot, cleanUser);
  try { fs.mkdirSync(userRoot, { recursive: true }); } catch {}

  const raw = normalizeLegacyWorkspacePrefix(targetPath, normRoot);

  // Reject any explicit attempt to touch /data/all_users_ro
  if (raw.startsWith('/data/all_users_ro')) {
    throw new PathGuardError('Người dùng thường không có quyền truy cập dữ liệu giám sát (/data/all_users_ro).', 'FORBIDDEN_RO_MOUNT');
  }

  // Knowledge Base exception (/data/kb_ro): allow ONLY in read mode, throw OUTSIDE_WORKSPACE on write/edit/delete
  const kbRoot = '/data/kb_ro';
  if (raw === kbRoot || raw.startsWith(kbRoot + '/')) {
    if (mode === 'read') {
      return assertWithinRoot(kbRoot, raw, 'read');
    }
    throw new PathGuardError(
      `Truy cập bị từ chối (${mode}): Kho tri thức chung ("${kbRoot}") ở chế độ CHỈ ĐỌC (Read-Only). Đường dẫn "${targetPath}" nằm ngoài phạm vi ghi cho phép.`,
      'OUTSIDE_WORKSPACE'
    );
  }

  // If the caller passed an absolute path naming one of this user's workspaces (/data/<user>/<ws>/...),
  // honor that workspace as the target workspace while still enforcing confinement inside it.
  const pathWs = extractWorkspaceFromPath(raw, cleanUser);
  const effectiveWs = pathWs || workspace || 'default-workspace';
  const wsDir = getUserWorkspaceDir(normRoot, cleanUser, effectiveWs);
  try { fs.mkdirSync(wsDir, { recursive: true }); } catch {}

  let candidate;
  if (path.posix.isAbsolute(raw)) {
    candidate = raw;
  } else {
    candidate = path.posix.resolve(wsDir, raw);
  }

  // Allow listing the user's own root `/data/<username>` (or `/data` when it maps to userRoot)
  if (raw === userRoot || (raw === normRoot && mode === 'read')) {
    return assertWithinRoot(userRoot, userRoot, mode);
  }

  const boundary = (mode === 'list-workspaces') ? userRoot : wsDir;
  return assertWithinRoot(boundary, candidate, mode);
}

/**
 * Resolve and guard a path for Admin (`role = admin`).
 * Admin can read/write inside `/data/admin/<ws>` and READ-ONLY inside `/data/all_users_ro`.
 */
export function guardAdminPath({
  workspaceRoot = process.env.WORKSPACE_ROOT || '/data',
  roRoot = process.env.ALL_USERS_RO_ROOT || '/data/all_users_ro',
  username = 'admin',
  workspace = 'default-workspace',
  targetPath = '.',
  mode = 'read'
}) {
  const cleanAdmin = sanitizeSegment(username, 'admin');
  const normRoot = (workspaceRoot || '/data').replace(/\\/g, '/').replace(/\/+$/, '');
  const raw = normalizeLegacyWorkspacePrefix(targetPath, normRoot);

  const normRoRoot = roRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (raw === normRoRoot || raw.startsWith(normRoRoot + '/')) {
    if (mode === 'write' || mode === 'edit' || mode === 'delete') {
      throw new PathGuardError(
        'Khu vực giám sát (/data/all_users_ro) ở chế độ CHỈ ĐỌC (Read-Only). Admin không thể ghi hoặc sửa file của User.',
        'READ_ONLY_VIOLATION'
      );
    }
    return assertWithinRoot(normRoRoot, raw, 'read');
  }

  const kbRoot = '/data/kb_ro';
  if (raw === kbRoot || raw.startsWith(kbRoot + '/')) {
    if (mode === 'read') {
      return assertWithinRoot(kbRoot, raw, 'read');
    }
    throw new PathGuardError(
      `Truy cập bị từ chối (${mode}): Kho tri thức chung ("${kbRoot}") ở chế độ CHỈ ĐỌC (Read-Only) trong sandbox.`,
      'OUTSIDE_WORKSPACE'
    );
  }

  const pathWs = extractWorkspaceFromPath(raw, cleanAdmin);
  const effectiveWs = pathWs || workspace || 'default-workspace';
  const wsDir = getUserWorkspaceDir(normRoot, cleanAdmin, effectiveWs);
  fs.mkdirSync(wsDir, { recursive: true });

  const adminUserRoot = path.posix.join(normRoot, cleanAdmin);
  fs.mkdirSync(adminUserRoot, { recursive: true });

  if (raw === adminUserRoot || (raw === normRoot && mode === 'read')) {
    return assertWithinRoot(adminUserRoot, adminUserRoot, mode);
  }

  const candidate = path.posix.isAbsolute(raw) ? raw : path.posix.resolve(wsDir, raw);
  return assertWithinRoot(mode === 'list-workspaces' ? adminUserRoot : wsDir, candidate, mode);
}

/**
 * Locate an existing file inside `wsDir` first (`files/<cat>/<filename>`), and if not found there,
 * search across all workspaces belonging to the SAME user (`/data/<user>/<any-ws>/files/<cat>/<filename>`).
 */
export function findFileInWorkspace(wsDir, requestedPath) {
  const filename = path.basename(String(requestedPath || '').replace(/\\/g, '/'));
  if (!filename) return null;

  for (const cat of ALL_CATEGORIES) {
    const candidate = path.posix.join(wsDir, 'files', cat, filename);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  // Fallback: check sibling workspaces of the SAME user (e.g. file uploaded into /data/alice/Test/files/pdf/...)
  const userRoot = path.posix.dirname(wsDir.replace(/\\/g, '/'));
  if (fs.existsSync(userRoot)) {
    try {
      for (const wsEntry of fs.readdirSync(userRoot, { withFileTypes: true })) {
        if (!wsEntry.isDirectory()) continue;
        const siblingWs = path.posix.join(userRoot, wsEntry.name);
        for (const cat of ALL_CATEGORIES) {
          const candidate = path.posix.join(siblingWs, 'files', cat, filename);
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
          }
        }
      }
    } catch {}
  }

  return null;
}
