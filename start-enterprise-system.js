// start-enterprise-system.js
// Khởi chạy toàn bộ hạ tầng DSH Lite Enterprise (Shared Brain + On-Demand Tool Sandbox):
//   - dsh-gateway (Port 12345 duy nhất ra Host; SQLite WAL trong volume dsh-gateway-data)
//   - dsh-main    (Port 3090 nội bộ; volume dsh-homes)
//   - dsh-tool    (On-demand per-user sandbox container dsh-tool-<username>, volume dsh-vol-*)

import { execSync } from 'node:child_process';

function runCmd(cmd) {
  return execSync(cmd, { stdio: 'inherit', encoding: 'utf8' });
}

async function startSystem() {
  console.log('================================================================');
  console.log('🚀 KHỞI ĐỘNG HỆ THỐNG DSH LITE ENTERPRISE (SHARED BRAIN)');
  console.log('================================================================\n');

  console.log('[1/2] Build 3 Docker images (dsh-gateway, dsh-main, dsh-tool)...');
  runCmd('node scripts/build-images.js');

  console.log('\n[2/2] Khởi chạy Docker Compose (dsh-gateway + dsh-main)...');
  runCmd('docker compose up -d');

  console.log('\n================================================================');
  console.log('✅ HỆ THỐNG DSH LITE ENTERPRISE ĐÃ SẴN SÀNG!');
  console.log('   🌐 Cổng duy nhất (Gateway): http://localhost:12345');
  console.log('   🔑 Trang Đăng nhập:         http://localhost:12345/login');
  console.log('   🧠 DSH Core (Shared Brain): nội bộ dsh-main:3090 (0 port ra Host)');
  console.log('   🧰 Tool Sandbox:            lazy-spawn dsh-tool-<username> khi model gọi tool');
  console.log('================================================================\n');
}

startSystem().catch((err) => {
  console.error('Lỗi khởi động hệ thống:', err.message);
  process.exit(1);
});
