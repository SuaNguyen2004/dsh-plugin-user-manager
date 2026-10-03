/**
 * dsh-plugin-user-manager
 * Multi-user authentication, workspace isolation and quota management for DeepSeek Harness (DSH)
 */

import { initDatabase, consumeTokens } from './db.js';
import { registerAuthRoutes, authenticateRequest } from './auth.js';
import {
  registerWorkspaceRoutes,
  getUserWorkspaceDir,
  resolveSafePath,
  listWorkspaceFiles,
  writeWorkspaceFile,
  readWorkspaceFile
} from './workspace.js';
import { registerQuotaRoutes } from './quota.js';

export const name = 'dsh-plugin-user-manager';
export const inject = ['webServer'];

export function apply(ctx) {
  console.log('\n[dsh-plugin-user-manager] ==========================================');
  console.log('[dsh-plugin-user-manager] Initializing dsh-plugin-user-manager...');

  // 1. Initialize SQLite Database (creates tables & default admin user)
  initDatabase();

  // 2. Attach helpers to Context for other plugins / cordis services if needed
  const userManagerService = {
    authenticateRequest,
    consumeTokens,
    getUserWorkspaceDir,
    resolveSafePath,
    listWorkspaceFiles,
    writeWorkspaceFile,
    readWorkspaceFile
  };

  if (typeof ctx.provide === 'function') {
    ctx.provide('userManager', userManagerService);
  } else {
    ctx.userManager = userManagerService;
  }

  // 3. Register Auth, Workspace, and Quota routes when WebServer service is available
  if (ctx.webServer) {
    registerAuthRoutes(ctx.webServer);
    registerWorkspaceRoutes(ctx.webServer);
    registerQuotaRoutes(ctx.webServer);

    // Keep the status endpoint for quick health check
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/user-manager/status',
      handler: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          plugin: 'dsh-plugin-user-manager',
          phase: 4,
          auth: true,
          workspaceIsolation: true,
          quotaMetering: true,
          database: 'users.db (SQLite)'
        }));
      }
    });
  }

  console.log('[dsh-plugin-user-manager] Initialization complete.');
  console.log('[dsh-plugin-user-manager] ==========================================\n');
}

export { authenticateRequest } from './auth.js';
export {
  getUserWorkspaceDir,
  resolveSafePath,
  listWorkspaceFiles,
  writeWorkspaceFile,
  readWorkspaceFile
} from './workspace.js';
export { registerQuotaRoutes } from './quota.js';
export * from './db.js';
