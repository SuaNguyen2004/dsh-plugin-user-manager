/**
 * dsh-plugin-user-manager
 * Multi-user authentication, workspace isolation, token quota metering,
 * and Native DSH UI integration (Guest Mode & Admin Approval Flow)
 */

import fs from 'node:fs';
import path from 'node:path';
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
import { getNativeInjectionMarkup } from './ui-injection.js';

export const name = 'dsh-plugin-user-manager';
export const inject = ['webServer'];

export function apply(ctx) {
  console.log('\n[dsh-plugin-user-manager] ==========================================');
  console.log('[dsh-plugin-user-manager] Initializing dsh-plugin-user-manager...');

  // 1. Initialize SQLite Database (creates tables & default active admin user)
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

  // 3. Register Auth, Workspace, Quota routes & UI Injection when WebServer service is available
  if (ctx.webServer) {
    registerAuthRoutes(ctx.webServer);
    registerWorkspaceRoutes(ctx.webServer);
    registerQuotaRoutes(ctx.webServer);

    // Native DSH UI Injection via tapIndex
    if (typeof ctx.webServer.tapIndex === 'function') {
      ctx.webServer.tapIndex((html) => {
        const injection = getNativeInjectionMarkup();
        if (html.includes('</body>')) {
          return html.replace('</body>', `${injection}\n</body>`);
        }
        return html + injection;
      });
      console.log('[dsh-plugin-user-manager] Native DSH UI successfully tapped into index.html (Guest Mode & Admin Panel).');
    }

    // Dashboard Web UI endpoints (standalone fallback)
    const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..');
    const serveDashboard = (req, res) => {
      const htmlPath = path.join(PLUGIN_ROOT, 'public', 'dashboard.html');
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(htmlPath, 'utf8'));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Dashboard UI file not found');
      }
    };

    ctx.webServer.register({
      kind: 'exact',
      path: '/user-manager',
      handler: serveDashboard
    });

    ctx.webServer.register({
      kind: 'exact',
      path: '/user-manager/dashboard',
      handler: serveDashboard
    });

    // Health / Status endpoint
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/user-manager/status',
      handler: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          status: 'ok',
          plugin: 'dsh-plugin-user-manager',
          phase: 5,
          auth: true,
          approvalFlow: true,
          workspaceIsolation: true,
          quotaMetering: true,
          nativeUI: true,
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
