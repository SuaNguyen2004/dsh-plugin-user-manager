import path from 'node:path';
import fs from 'node:fs';
import { syncContainerWorkspace, getWorkspaceDir } from './user/workspace.js';
import { createReadDocumentTool } from './document/document-tool.js';
import { getNativeInjectionMarkup } from './ui/ui-injection.js';

export const name = 'dsh-user-container-plugin';
export const inject = ['webServer'];

export function apply(ctx) {
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

  // 2. Register read_document tool on Cordis agents
  const registerTool = async () => {
    try {
      const agents = ctx.get ? ctx.get('agents', false) : null;
      if (agents && typeof agents.registerTool === 'function') {
        const tool = await createReadDocumentTool({ workspaceRoot: getWorkspaceDir() });
        agents.registerTool(tool);
        console.log('[dsh-user-plugin] Tool "read_document" registered into sandbox agent.');
      }
    } catch (e) {
      console.warn('[dsh-user-plugin] Could not register read_document tool:', e.message);
    }
  };

  registerTool();
  if (typeof ctx.inject === 'function') {
    ctx.inject(['agents'], () => {
      registerTool();
    });
  }

  // 3. Inject UI markup into DSH index.html
  if (ctx.webServer && typeof ctx.webServer.register === 'function') {
    // Intercept index.html to inject user pill
    const origRegister = ctx.webServer.register.bind(ctx.webServer);
    // Hook webServer response or static index
  }

  console.log(`[dsh-user-plugin] Sandbox initialized successfully for ${username}.`);
}

