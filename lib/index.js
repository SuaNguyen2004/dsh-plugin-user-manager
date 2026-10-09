/**
 * dsh-plugin-user-manager
 * Multi-user authentication, workspace isolation, token quota metering,
 * and Native DSH UI integration (Dedicated Login & Admin Approval Flow)
 */

import fs from 'node:fs';
import path from 'node:path';
import { initDatabase, listActiveUsers } from './db.js';
import { registerAuthRoutes, authenticateRequest } from './auth.js';
import {
  registerWorkspaceRoutes,
  getUserWorkspaceDir,
  resolveSafePath,
  listWorkspaceFiles,
  writeWorkspaceFile,
  readWorkspaceFile,
  syncDshUserWorkspaces,
  cleanupStraySessionsAndWorkspaces
} from './workspace.js';
import { getNativeInjectionMarkup } from './ui-injection.js';
import { setCordisContext } from './workspace.js';
import {
  setDocumentServiceContext,
  registerDocumentRoutes,
  registerCordisDocumentTool,
  hookFileUploadsService,
  toolRegistrationStatus
} from './document-service.js';

export const name = 'dsh-plugin-user-manager';
export const inject = ['webServer'];

export function apply(ctx) {
  // Check if running on default personal port 3080
  const currentPort = ctx.webServer?.config?.port || ctx.webServer?.port;
  const isExplicitPersonal = currentPort === 3080;

  if (isExplicitPersonal) {
    console.log('\n[dsh-plugin-user-manager] Port 3080 (Personal Workspace) detected: Plugin completely bypassed.');
    return;
  }

  console.log('\n[dsh-plugin-user-manager] ==========================================');
  console.log(`[dsh-plugin-user-manager] Multi-user port ${currentPort || 3088} detected: Activating User Management...`);

  process.env.DSH_HOME = path.join(process.env.USERPROFILE || 'C:\\Users\\Admin', '.dsh-multiuser');
  setCordisContext(ctx);
  setDocumentServiceContext(ctx);

  // Register document reading tool (read_document) for AI models
  registerCordisDocumentTool(ctx);

  // Hook fileUploads service to track attachment ownership
  if (typeof ctx.inject === 'function') {
    ctx.inject(['fileUploads', 'attachments'], (uploadCtx) => {
      hookFileUploadsService(uploadCtx.fileUploads, uploadCtx.attachments);
    });
  }

  // 1. Initialize SQLite Database (creates tables & default active admin user)
  initDatabase();
  try {
    // Sync all active users from database at startup so all workspaces exist in storage before DSH reads it
    const activeUsers = listActiveUsers();
    for (const u of activeUsers) {
      syncDshUserWorkspaces(u);
    }
    cleanupStraySessionsAndWorkspaces();
  } catch (e) {
    console.error('[dsh-plugin-user-manager] Error syncing initial workspaces:', e.message);
  }

  // Hook DSH connection browser authentication so unauthenticated visitors are redirected to /login,
  // and authenticated users seamlessly access their workspaces without single-user token errors
  const hookBrowserAuth = (connection) => {
    try {
      const browserAuth = connection?.browserAuth;
      if (browserAuth && !browserAuth.__dshMultiUserHooked) {
        browserAuth.__dshMultiUserHooked = true;

        const handleAuthorizeIndex = (req, res) => {
          const user = authenticateRequest(req);
          if (!user) {
            if (res && typeof res.writeHead === 'function') {
              res.writeHead(302, { Location: '/login' });
              res.end();
            }
            return false;
          }
          return true;
        };

        browserAuth.isAuthenticated = function(req) {
          return !!authenticateRequest(req);
        };
        browserAuth.authorizeIndex = function(req, res) {
          return handleAuthorizeIndex(req, res);
        };

        if (typeof connection.authorizeIndex === 'function') {
          connection.authorizeIndex = function(req, res) {
            return handleAuthorizeIndex(req, res);
          };
        }
        if (typeof connection.requestRejection === 'function') {
          connection.requestRejection = function(req) {
            const rawUrl = req?.url || '';
            if (rawUrl.startsWith('/login') || rawUrl.startsWith('/api/auth/') || rawUrl.startsWith('/user-manager')) {
              return undefined;
            }
            const user = authenticateRequest(req);
            return user ? undefined : 401;
          };
        }

        if (typeof browserAuth.authenticatedUrl === 'function') {
          browserAuth.authenticatedUrl = function(baseUrl) {
            return baseUrl || 'http://127.0.0.1:3088/';
          };
        }
        if (typeof connection.authenticatedUrl === 'function') {
          connection.authenticatedUrl = function(baseUrl) {
            return baseUrl || 'http://127.0.0.1:3088/';
          };
        }

        console.log('[dsh-plugin-user-manager] Authentication gatekeeper active: Unauthenticated visits redirect to /login.');
      }
    } catch (e) {
      console.error('[dsh-plugin-user-manager] Error hooking connection browserAuth:', e.message);
    }
  };

  if (typeof ctx.get === 'function') {
    hookBrowserAuth(ctx.get('connection', false));
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], (connCtx) => {
      hookBrowserAuth(connCtx.connection);
    });
  }

  // 2. Attach helpers to Context for other plugins / cordis services if needed
  const userManagerService = {
    authenticateRequest,
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

  // 3. Register Auth, Workspace & Document routes & UI Injection when WebServer service is available
  if (ctx.webServer) {
    registerAuthRoutes(ctx.webServer);
    registerWorkspaceRoutes(ctx.webServer);
    registerDocumentRoutes(ctx.webServer);

    // Native DSH UI Injection via tapIndex
    if (typeof ctx.webServer.tapIndex === 'function') {
      ctx.webServer.tapIndex((html) => {
        const injection = getNativeInjectionMarkup();
        if (html.includes('</body>')) {
          return html.replace('</body>', `${injection}\n</body>`);
        }
        return html + injection;
      });
      console.log('[dsh-plugin-user-manager] Native DSH UI successfully tapped into index.html (User Session & Admin Panel).');
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
          phase: 6,
          auth: true,
          approvalFlow: true,
          workspaceIsolation: true,
          nativeUI: true,
          database: 'users.db (SQLite)',
          documentExtraction: true,
          documentTool: 'read_document',
          supportedFormats: ['.pdf', '.docx', '.txt'],
          toolRegistration: toolRegistrationStatus
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
  readWorkspaceFile,
  checkDocumentAccess,
  getOwnerOfSession
} from './workspace.js';
export * from './db.js';
export * from './document-extractor.js';
export * from './document-service.js';
export * from './document-tool.js';

