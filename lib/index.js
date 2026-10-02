/**
 * dsh-plugin-user-manager
 * Phase 1: Minimal Cordis plugin entrypoint for DeepSeek Harness
 */

export const name = 'dsh-plugin-user-manager';

export function apply(ctx) {
  console.log('\n[dsh-plugin-user-manager] ==========================================');
  console.log('[dsh-plugin-user-manager] Plugin successfully loaded into Cordis!');
  console.log('[dsh-plugin-user-manager] Target: Multi-User, Auth, Quota & Sandbox');
  console.log('[dsh-plugin-user-manager] ==========================================\n');

  // Register an HTTP route or index tap on webServer if available
  if (ctx.webServer) {
    console.log('[dsh-plugin-user-manager] WebServer service detected.');
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/user-manager/status',
      handler: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          plugin: 'dsh-plugin-user-manager',
          phase: 1,
          message: 'Hello World from dsh-plugin-user-manager!'
        }));
      }
    });
    console.log('[dsh-plugin-user-manager] Registered test route: GET /api/user-manager/status');
  }
}
