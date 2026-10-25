import path from 'node:path';
import fs from 'node:fs';
import { syncContainerWorkspace, getWorkspaceDir } from './user/workspace.js';
import { createReadDocumentTool } from './document/document-tool.js';

export const name = 'dsh-user-container-plugin';
export const inject = ['tools'];

export async function apply(ctx) {
  const username = process.env.DSH_USER_NAME || 'User';
  console.log(`[dsh-user-plugin] Activating dedicated sandbox plugin for user: "${username}"`);

  // 1. Sync workspace to /data/workspace
  syncContainerWorkspace(username);

  // Periodically refresh RO user workspaces & sessions for Admin
  if (process.env.DSH_USER_ROLE === 'admin' || username.toLowerCase() === 'admin') {
    setInterval(() => {
      try {
        syncContainerWorkspace(username);
      } catch (e) {}
    }, 5000);
  }

  // 2. Register read_document tool on Cordis ctx.tools
  try {
    if (ctx.tools && typeof ctx.tools.register === 'function') {
      const tool = await createReadDocumentTool({ workspaceRoot: getWorkspaceDir() });
      ctx.tools.register(tool);
      console.log('[dsh-user-plugin] Tool "read_document" registered successfully into ctx.tools.');
    } else {
      console.warn('[dsh-user-plugin] ctx.tools not available or has no register function.');
    }
  } catch (err) {
    console.error('[dsh-user-plugin] Failed to register read_document tool:', err.message);
  }

  console.log(`[dsh-user-plugin] Sandbox initialized successfully for ${username}.`);
}
