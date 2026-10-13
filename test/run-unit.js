import { spawnSync } from 'node:child_process';
import path from 'node:path';

const unitTests = [
  'test/unit/test-auth.js',
  'test/unit/test-workspace.js',
  'test/unit/test-model-guard.js',
  'test/unit/test-key-pool-rotation.js',
  'test/unit/test-native-approval.js',
  'test/unit/test-security-isolation.js',
  'test/unit/test-document-v2.js'
];

console.log('====================================================');
console.log('   RUNNING UNIT TESTS FOR DSH USER MANAGER          ');
console.log('====================================================\n');

let allPassed = true;

for (const testFile of unitTests) {
  console.log(`\n▶ [RUNNING] ${testFile}...`);
  const result = spawnSync('node', [testFile], {
    stdio: 'inherit',
    shell: true
  });

  if (result.status !== 0) {
    console.error(`❌ [FAILED] ${testFile} (Exit code: ${result.status})`);
    allPassed = false;
    process.exit(result.status);
  } else {
    console.log(`✅ [PASSED] ${testFile}`);
  }
}

console.log('\n====================================================');
console.log('🎉 ALL UNIT TESTS PASSED SUCCESSFULLY!             ');
console.log('====================================================\n');

