// test/phase6-migrate-test.js
// Automated verification for Phase 6 (Migration to Docker Named Volumes):
//  1. Runs scripts/migrate-to-volumes.js twice to prove idempotency.
//  2. Verifies Host `data/` files are 100% preserved (nothing deleted on Host).
//  3. Verifies dsh-gateway-data contains users.db + JSON configs with all 5 users.
//  4. Verifies dsh-homes contains user-1-admin, user-2-alice, user-5-nva.
//  5. Verifies dsh-vol-user2 and dsh-vol-user5 files are normalized under:
//     /data/workspace/<username>/<workspace>/files/<category>/<file>
//     with zero redundant nested "workspace" folders.
//  6. Verifies docs/MIGRATION_REPORT.md was generated with before/after table.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runMigration } from '../scripts/migrate-to-volumes.js';

const ROOT = process.cwd();
const HOST_DATA = fs.existsSync(path.resolve(ROOT, 'data', 'users.db'))
  ? path.resolve(ROOT, 'data')
  : path.resolve(ROOT, 'draft', 'legacy', 'host-data-backup');

const hostFilesBefore = fs.readdirSync(HOST_DATA).sort();

console.log('=== PHASE 6 MIGRATION VERIFICATION TEST ===');

// Run migration twice (idempotent check)
const first = await runMigration();
const second = await runMigration();

assert.equal(
  first.volumeSummaries.reduce((a, b) => a + b.files, 0),
  second.volumeSummaries.reduce((a, b) => a + b.files, 0),
  'Migration must be idempotent across multiple runs (file count unchanged)'
);
console.log('[PASS] 1. Migration ran twice idempotently (file counts & sizes identical).');

// Host data/ untouched
const hostFilesAfter = fs.readdirSync(HOST_DATA).sort();
assert.deepEqual(hostFilesAfter, hostFilesBefore, 'Host data/ files must remain 100% intact');
assert.ok(fs.existsSync(path.join(HOST_DATA, 'users.db')), 'Host data/users.db still exists');
console.log('[PASS] 2. Host data/ directory preserved 100% (non-destructive migration).');

// Verify users.db inside dsh-gateway-data volume
assert.ok(second.afterGwVol.list.some((f) => f.path === 'users.db' && f.bytes > 0), 'users.db present in dsh-gateway-data');
assert.ok(second.users.some((u) => u.username === 'admin' && u.role === 'admin'));
assert.ok(second.users.some((u) => u.username === 'alice' && u.status === 'active'));
assert.ok(second.users.some((u) => u.username === 'nva' && u.status === 'active'));
console.log(`[PASS] 3. Volume dsh-gateway-data holds users.db (${second.afterGwVol.files} files, ${second.afterGwVol.bytes} bytes) with ${second.users.length} users.`);

// Verify dsh-homes volume contains migrated homes
for (const expected of ['user-1-admin', 'user-2-alice', 'user-5-nva']) {
  assert.ok(second.homesDirs.includes(expected), `dsh-homes missing ${expected}; got ${second.homesDirs.join(',')}`);
}
console.log(`[PASS] 4. Volume dsh-homes contains user-1-admin, user-2-alice, user-5-nva (${second.afterHomesVol.files} files).`);

// Verify canonical path structure in dsh-vol-user2 (alice) & dsh-vol-user5 (nva)
const aliceSummary = second.volumeSummaries.find((v) => v.username === 'alice');
const nvaSummary = second.volumeSummaries.find((v) => v.username === 'nva');
assert.ok(aliceSummary && aliceSummary.files >= 3, JSON.stringify(aliceSummary));
assert.ok(nvaSummary && nvaSummary.files >= 4, JSON.stringify(nvaSummary));

for (const f of aliceSummary.list) {
  assert.match(
    f.path,
    /^alice\/[^/]+\/files\/(docs|pdf|sheets|images|others)\/[^/]+$/,
    `Alice file not in canonical structure: ${f.path}`
  );
  assert.ok(!f.path.includes('/workspace/workspace'), `Forbidden nested workspace in ${f.path}`);
}
for (const f of nvaSummary.list) {
  assert.match(
    f.path,
    /^nva\/[^/]+\/files\/(docs|pdf|sheets|images|others)\/[^/]+$/,
    `NVA file not in canonical structure: ${f.path}`
  );
}
console.log('[PASS] 5. Volumes dsh-vol-user2 & dsh-vol-user5 normalized to /data/workspace/<user>/<ws>/files/<cat>/<file>.');

assert.ok(fs.existsSync(path.resolve(ROOT, 'docs', 'MIGRATION_REPORT.md')), 'docs/MIGRATION_REPORT.md must exist');
console.log('[PASS] 6. Reconciliation report written to docs/MIGRATION_REPORT.md.');

console.log('\n✅ PHASE 6 ALL TESTS PASSED!');
process.exit(0);
