// dsh-tool/tools/admin/doc-reader.js
// Admin-role document reader (.docx, .pdf, .txt) — supports admin workspace and /data/all_users_ro

import fs from 'node:fs';
import { ensureWorkspaceStructure, sanitizeSegment, normalizeWorkspaceName } from '../common/auto-categorize.js';
import { guardAdminPath, findFileInWorkspace } from '../common/path-guard.js';
import { extractDocumentText } from '../common/doc-extractor.js';

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/data/workspace';
const RO_ROOT = process.env.ALL_USERS_RO_ROOT || '/data/all_users_ro';

export async function readDocument(args, ctx) {
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

  return await extractDocumentText(targetPath, {
    page: args.page,
    offset: args.offset,
    limit: args.limit
  });
}
