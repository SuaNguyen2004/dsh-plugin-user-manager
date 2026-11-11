// dsh-tool/tools/admin/audit.js
// Admin-exclusive supervisory tools over /data/all_users_ro (Read-Only)
// Regular users do NOT have this module in manifest.user.json and cannot invoke it.

import fs from 'node:fs';
import path from 'node:path';
import { assertWithinRoot } from '../common/path-guard.js';

const RO_ROOT = process.env.ALL_USERS_RO_ROOT || '/data/all_users_ro';

export async function listUserWorkspaces(_args, _ctx) {
  if (!fs.existsSync(RO_ROOT)) {
    return { ok: true, users: [] };
  }

  const users = [];
  function scanWorkspace(wsPath, username, wsName) {
    const files = [];
    const filesRoot = path.posix.join(wsPath, 'files');
    if (fs.existsSync(filesRoot)) {
      for (const cat of fs.readdirSync(filesRoot, { withFileTypes: true })) {
        if (!cat.isDirectory()) continue;
        const catDir = path.posix.join(filesRoot, cat.name);
        for (const f of fs.readdirSync(catDir, { withFileTypes: true })) {
          if (f.isFile()) {
            const fPath = path.posix.join(catDir, f.name);
            files.push({
              name: f.name,
              category: cat.name,
              size: fs.statSync(fPath).size,
              roPath: fPath
            });
          }
        }
      }
    }
    return {
      username,
      workspace: wsName,
      roPath: wsPath,
      files
    };
  }

  for (const mountEntry of fs.readdirSync(RO_ROOT, { withFileTypes: true })) {
    if (!mountEntry.isDirectory()) continue;
    const mountPath = path.posix.join(RO_ROOT.replace(/\\/g, '/'), mountEntry.name);
    const userWorkspaces = [];

    // Check if mountPath itself directly contains workspace folders (mountPath is /data/all_users_ro/<username>)
    for (const sub of fs.readdirSync(mountPath, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const subPath = path.posix.join(mountPath, sub.name);
      if (fs.existsSync(path.posix.join(subPath, 'files'))) {
        userWorkspaces.push(scanWorkspace(subPath, mountEntry.name, sub.name));
      } else {
        for (const ws of fs.readdirSync(subPath, { withFileTypes: true })) {
          if (!ws.isDirectory()) continue;
          const wsPath = path.posix.join(subPath, ws.name);
          userWorkspaces.push(scanWorkspace(wsPath, sub.name, ws.name));
        }
      }
    }

    if (userWorkspaces.length > 0) {
      users.push({
        mount: mountEntry.name,
        workspaces: userWorkspaces
      });
    }
  }

  return { ok: true, users };
}

export async function readUserFile(args, _ctx) {
  const reqPath = args.file_path || args.path;
  if (!reqPath) throw new Error('Thiếu tham số file_path.');

  const candidate = path.posix.isAbsolute(reqPath)
    ? reqPath
    : path.posix.join(RO_ROOT.replace(/\\/g, '/'), reqPath);

  const safePath = assertWithinRoot(RO_ROOT, candidate, 'read');
  if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
    throw new Error(`Không tìm thấy file của user tại "${reqPath}".`);
  }

  const content = fs.readFileSync(safePath, 'utf8');
  return {
    ok: true,
    path: safePath,
    readOnly: true,
    bytes: Buffer.byteLength(content, 'utf8'),
    content
  };
}

export async function auditStorage(_args, _ctx) {
  const summary = await listUserWorkspaces({}, {});
  let totalFiles = 0;
  let totalBytes = 0;

  for (const u of summary.users) {
    for (const ws of u.workspaces) {
      for (const f of ws.files) {
        totalFiles += 1;
        totalBytes += f.size;
      }
    }
  }

  return {
    ok: true,
    totalUsersMounted: summary.users.length,
    totalFiles,
    totalBytes,
    users: summary.users
  };
}
