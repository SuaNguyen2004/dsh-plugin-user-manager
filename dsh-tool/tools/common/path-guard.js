// dsh-tool/tools/common/path-guard.js
// Strict path containment and symlink-escape protection for dsh-tool sandboxes.

import fs from 'node:fs';
import path from 'node:path';
import { sanitizeSegment, normalizeWorkspaceName, getUserWorkspaceDir, ALL_CATEGORIES } from './auto-categorize.js';

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

  // Check raw lstat if the target itself exists and is a symlink
  const absCandidate = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(allowedRoot, targetPath);

  if (!isPathInside(allowedRoot, absCandidate)) {
    throw new PathGuardError(
      `Truy cập bị từ chối (${mode}): Đường dẫn "${targetPath}" nằm ngoài phạm vi cho phép "${allowedRoot}".`,
      'OUTSIDE_WORKSPACE'
    );
  }

  // Also walk existing segments from allowedRoot down to absCandidate to ensure no symlink escapes
  const realRoot = resolveCanonicalPath(allowedRoot);
  if (!isPathInside(realRoot, absCandidate)) {
    throw new PathGuardError(
      `Truy cập bị từ chối (${mode}): Phát hiện symlink trỏ ra ngoài workspace tại "${targetPath}".`,
      'SYMLINK_ESCAPE'
    );
  }

  return resolveCanonicalPath(absCandidate);
}

/**
 * Resolve and guard a path for a standard User (`role = user`).
 * Users are strictly confined to `/data/workspace/<username>/<workspace>`.
 */
export function guardUserPath({
  workspaceRoot = process.env.WORKSPACE_ROOT || '/data/workspace',
  username,
  workspace,
  targetPath = '.',
  mode = 'read'
}) {
  const cleanUser = sanitizeSegment(username, 'user');
  const userRoot = path.posix.join(workspaceRoot.replace(/\\/g, '/'), cleanUser);
  fs.mkdirSync(userRoot, { recursive: true });

  const wsDir = getUserWorkspaceDir(workspaceRoot, cleanUser, workspace || 'default-workspace');
  fs.mkdirSync(wsDir, { recursive: true });

  const raw = String(targetPath || '.').replace(/\\/g, '/').trim();

  // Reject any explicit attempt to touch /data/all_users_ro
  if (raw.startsWith('/data/all_users_ro')) {
    throw new PathGuardError('Người dùng thường không có quyền truy cập dữ liệu giám sát (/data/all_users_ro).', 'FORBIDDEN_RO_MOUNT');
  }

  let candidate;
  if (path.posix.isAbsolute(raw)) {
    candidate = raw;
  } else {
    candidate = path.posix.resolve(wsDir, raw);
  }

  // Check against the specific workspace directory (or userRoot if listing workspaces)
  const boundary = (mode === 'list-workspaces') ? userRoot : wsDir;
  return assertWithinRoot(boundary, candidate, mode);
}

/**
 * Resolve and guard a path for Admin (`role = admin`).
 * Admin can read/write inside `/data/workspace/admin/<ws>` and READ-ONLY inside `/data/all_users_ro`.
 */
export function guardAdminPath({
  workspaceRoot = process.env.WORKSPACE_ROOT || '/data/workspace',
  roRoot = process.env.ALL_USERS_RO_ROOT || '/data/all_users_ro',
  username = 'admin',
  workspace = 'default-workspace',
  targetPath = '.',
  mode = 'read'
}) {
  const cleanAdmin = sanitizeSegment(username, 'admin');
  const wsDir = getUserWorkspaceDir(workspaceRoot, cleanAdmin, workspace);
  fs.mkdirSync(wsDir, { recursive: true });

  const raw = String(targetPath || '.').replace(/\\/g, '/').trim();

  // Check if path targets /data/all_users_ro
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

  const candidate = path.posix.isAbsolute(raw) ? raw : path.posix.resolve(wsDir, raw);
  const adminUserRoot = path.posix.join(workspaceRoot.replace(/\\/g, '/'), cleanAdmin);
  fs.mkdirSync(adminUserRoot, { recursive: true });
  return assertWithinRoot(mode === 'list-workspaces' ? adminUserRoot : wsDir, candidate, mode);
}

/**
 * Helper to locate an existing file inside a workspace (either by direct path or by searching `files/<cat>/<filename>`).
 */
export function findFileInWorkspace(wsDir, requestedPath) {
  const filename = path.basename(String(requestedPath || '').replace(/\\/g, '/'));
  for (const cat of ALL_CATEGORIES) {
    const candidate = path.posix.join(wsDir, 'files', cat, filename);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}
