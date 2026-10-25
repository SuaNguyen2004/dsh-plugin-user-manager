// test/phase1-structure-test.js
// Automated verification for Phase 1: Repository split, Docker Compose volumes & zero-host-bind-mount validation

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { load } from 'js-yaml';

const ROOT = path.resolve(import.meta.dirname, '..');

function checkExists(relPath) {
  const full = path.join(ROOT, relPath);
  assert.ok(fs.existsSync(full), `Missing required path: ${relPath}`);
}

console.log('=== PHASE 1 VERIFICATION TEST ===');

// 1. Check 3 target image directories exist
const requiredPaths = [
  'gateway/Dockerfile',
  'gateway/server.js',
  'gateway/orchestrator.js',
  'gateway/jwt.js',
  'gateway/index.js',
  'dsh-main/Dockerfile',
  'dsh-main/docker-entrypoint.sh',
  'dsh-main/patch-dsh-host.cjs',
  'dsh-main/inject-ui.cjs',
  'dsh-tool/Dockerfile',
  'dsh-tool/entrypoint.sh',
  'dsh-tool/manifest.user.json',
  'dsh-tool/manifest.admin.json',
  'dsh-tool/tools/common/path-guard.js',
  'dsh-tool/tools/user',
  'dsh-tool/tools/admin',
  'docker-compose.yml',
  'scripts/build-images.js'
];

for (const p of requiredPaths) {
  checkExists(p);
}
console.log('[PASS] 1. All required directories & files for gateway/, dsh-main/, dsh-tool/ exist.');

// 2. Check legacy code preserved in draft/legacy/
const legacyPaths = [
  'draft/legacy/master-backend/server.js',
  'draft/legacy/master-backend/orchestrator.js',
  'draft/legacy/dsh-container-base/Dockerfile',
  'draft/legacy/dsh-container-base/patch-dsh-host.cjs'
];
for (const p of legacyPaths) {
  checkExists(p);
}
assert.ok(!fs.existsSync(path.join(ROOT, 'master-backend')), 'master-backend/ should be moved to gateway/');
assert.ok(!fs.existsSync(path.join(ROOT, 'dsh-container-base')), 'dsh-container-base/ should be moved to dsh-main/');
console.log('[PASS] 2. Legacy code safely archived under draft/legacy/ without deletion.');

// 3. Validate docker-compose.yml structure & volumes (Zero Windows host bind mounts)
const composeRaw = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
const compose = load(composeRaw);

assert.ok(compose.services['dsh-gateway'], 'docker-compose must define dsh-gateway');
assert.ok(compose.services['dsh-main'], 'docker-compose must define dsh-main');
assert.deepEqual(compose.services['dsh-gateway'].ports, ['12345:12345'], 'Only dsh-gateway exposes port 12345');
assert.equal(compose.services['dsh-main'].ports, undefined, 'dsh-main must NOT publish any port to host');

// Check volumes declaration
assert.ok(compose.volumes['dsh-gateway-data'], 'Named volume dsh-gateway-data must be defined');
assert.ok(compose.volumes['dsh-homes'], 'Named volume dsh-homes must be defined');
assert.ok(compose.volumes['dsh-vol-admin'], 'Named volume dsh-vol-admin must be defined');

// Ensure no host directory bind-mounts (only /var/run/docker.sock allowed on dsh-gateway)
for (const [svcName, svc] of Object.entries(compose.services)) {
  for (const v of svc.volumes || []) {
    if (svcName === 'dsh-gateway' && v === '/var/run/docker.sock:/var/run/docker.sock') continue;
    assert.ok(
      !v.startsWith('./') && !v.startsWith('/') && !/^[A-Za-z]:/.test(v),
      `Service ${svcName} has forbidden host bind mount: ${v}`
    );
  }
}
console.log('[PASS] 3. docker-compose.yml verified: only 12345 exposed, docker.sock only in dsh-gateway, 100% Named Volumes.');

// 4. Validate `docker compose config` syntax via Docker CLI
const composeCheck = execSync('docker compose config --quiet', { cwd: ROOT, encoding: 'utf8' });
console.log('[PASS] 4. `docker compose config --quiet` passed with 0 errors.');

console.log('\n✅ PHASE 1 ALL TESTS PASSED!');
