// dsh-tool/tools/common/auto-categorize.js
// Enforces the mandatory directory layout:
//   /data/workspace/<username>/<workspace-name>/files/<category>/<filename>
// Categories:
//   - docs:   .doc, .docx, .txt, .md
//   - pdf:    .pdf
//   - sheets: .xls, .xlsx, .csv
//   - images: .png, .jpg, .jpeg, .gif, .webp
//   - others: everything else

import fs from 'node:fs';
import path from 'node:path';

export const CATEGORY_MAP = {
  docs: new Set(['.doc', '.docx', '.txt', '.md']),
  pdf: new Set(['.pdf']),
  sheets: new Set(['.xls', '.xlsx', '.csv']),
  images: new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
};

export const ALL_CATEGORIES = ['docs', 'pdf', 'sheets', 'images', 'others'];

/**
 * Sanitize a username or workspace name into a single safe directory segment.
 * Prevents path traversal and redundant nesting.
 */
export function sanitizeSegment(raw, fallback = 'default-workspace') {
  if (!raw || typeof raw !== 'string') return fallback;
  let cleaned = raw
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, '') // strip trailing "(username)" if passed from UI
    .replace(/[\\/:*?"<>|\0]/g, '_')
    .replace(/^\.+/, '')
    .trim();

  if (!cleaned || cleaned === '.' || cleaned === '..') return fallback;
  // Forbidden redundant nested names like "workspace" if a real workspace name exists
  return cleaned;
}

/**
 * Normalize workspace name so redundant nesting like
 * `/data/workspace/alice/alice-space/workspace` never occurs.
 */
export function normalizeWorkspaceName(rawWorkspace, username = 'user') {
  const cleanUser = sanitizeSegment(username, 'user');
  if (!rawWorkspace || typeof rawWorkspace !== 'string') {
    return 'default-workspace';
  }

  // Strip leading /data/workspace/<user>/ or /data/workspace/ if caller passed a full path
  let rel = rawWorkspace.replace(/\\/g, '/').trim();
  rel = rel.replace(/^\/+data\/+workspace\/+/i, '');
  if (rel.toLowerCase().startsWith(cleanUser.toLowerCase() + '/')) {
    rel = rel.slice(cleanUser.length + 1);
  }

  const parts = rel.split('/').filter(Boolean);
  if (parts.length === 0) return 'default-workspace';

  const first = sanitizeSegment(parts[0], 'default-workspace');
  if (first.toLowerCase() === 'workspace' || first.toLowerCase() === 'files') {
    return 'default-workspace';
  }
  return first;
}

/**
 * Determine file category folder from filename extension.
 */
export function categorizeFile(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  for (const [category, extSet] of Object.entries(CATEGORY_MAP)) {
    if (extSet.has(ext)) return category;
  }
  return 'others';
}

/**
 * Compute the canonical workspace root directory for a user:
 *   /data/workspace/<username>/<workspace-name>
 */
export function getUserWorkspaceDir(workspaceRoot, username, workspaceName) {
  const cleanUser = sanitizeSegment(username, 'user');
  const cleanWs = normalizeWorkspaceName(workspaceName, cleanUser);
  return path.posix.join(workspaceRoot.replace(/\\/g, '/'), cleanUser, cleanWs);
}

/**
 * Ensure the workspace directory and all 5 category subdirectories exist.
 */
export function ensureWorkspaceStructure(workspaceRoot, username, workspaceName) {
  const wsDir = getUserWorkspaceDir(workspaceRoot, username, workspaceName);
  for (const cat of ALL_CATEGORIES) {
    const dir = path.posix.join(wsDir, 'files', cat);
    fs.mkdirSync(dir, { recursive: true });
  }
  return wsDir;
}

/**
 * Resolve any requested file path for creation/writing into the canonical structure:
 *   /data/workspace/<username>/<workspace-name>/files/<category>/<filename>
 */
export function resolveCategorizedFilePath(workspaceRoot, username, workspaceName, requestedFilePath) {
  const wsDir = ensureWorkspaceStructure(workspaceRoot, username, workspaceName);
  const rawName = path.basename(String(requestedFilePath || '').replace(/\\/g, '/'));
  const safeFilename = sanitizeSegment(rawName, 'unnamed-file');
  const category = categorizeFile(safeFilename);
  return path.posix.join(wsDir, 'files', category, safeFilename);
}

/**
 * Sweep a workspace directory after a shell command or tool run:
 * Any stray files created directly in `/data/workspace/<user>/<ws>` or in a nested `workspace/`
 * subfolder are automatically moved into `/data/workspace/<user>/<ws>/files/<category>/<file>`.
 */
export function autoOrganizeWorkspaceStrayFiles(workspaceRoot, username, workspaceName) {
  const wsDir = ensureWorkspaceStructure(workspaceRoot, username, workspaceName);
  const moved = [];

  function relocateFile(fullPath) {
    const base = path.basename(fullPath);
    if (base.startsWith('.')) return;
    const dest = resolveCategorizedFilePath(workspaceRoot, username, workspaceName, base);
    if (path.resolve(fullPath) === path.resolve(dest)) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(fullPath, dest);
    fs.unlinkSync(fullPath);
    moved.push({ from: fullPath, to: dest });
  }

  function scanDir(dir, depth = 0) {
    if (depth > 3 || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (depth === 0 && entry.isDirectory() && entry.name === 'files') {
        // Inside files/, check if files were placed directly under files/ without category
        for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
          const subFull = path.join(full, sub.name);
          if (sub.isFile()) {
            relocateFile(subFull);
          } else if (sub.isDirectory() && !ALL_CATEGORIES.includes(sub.name)) {
            scanDir(subFull, depth + 2);
            try { fs.rmSync(subFull, { recursive: true, force: true }); } catch {}
          }
        }
        continue;
      }

      if (entry.isFile()) {
        relocateFile(full);
      } else if (entry.isDirectory()) {
        // Unwrap redundant nested directories (e.g. /data/workspace/alice/alice-space/workspace)
        scanDir(full, depth + 1);
        try {
          const remaining = fs.readdirSync(full);
          if (remaining.length === 0) fs.rmdirSync(full);
        } catch {}
      }
    }
  }

  scanDir(wsDir, 0);
  return moved;
}
