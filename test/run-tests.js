// test/run-tests.js
// Master test runner executing Phase 1 -> Phase 7 verification suites sequentially.

import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SUITES = [
  'test/phase1-structure-test.js',
  'test/phase2-tool-test.js',
  'test/phase3-orchestrator-test.js',
  'test/phase4-dsh-main-test.js',
  'test/phase5-gateway-test.js',
  'test/phase6-migrate-test.js',
  'test/phase7-acceptance-test.js'
];

for (const suite of SUITES) {
  console.log(`\n========================================================`);
  console.log(`▶ RUNNING ${suite}`);
  console.log(`========================================================`);
  execSync(`node ${suite}`, { cwd: ROOT, stdio: 'inherit' });
}

console.log('\n🎉 ALL 7 PHASE TEST SUITES PASSED!');
