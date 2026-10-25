// scripts/build-images.js
// Builds all 3 Docker images: dsh-gateway:latest, dsh-main:latest, dsh-tool:latest

import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function run(cmd, label) {
  console.log(`\n========================================`);
  console.log(`[build:images] ${label}`);
  console.log(`> ${cmd}`);
  console.log(`========================================`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

try {
  run('docker build -t dsh-gateway:latest -f gateway/Dockerfile .', '1/3 Building dsh-gateway:latest');
  run('docker build -t dsh-main:latest -f dsh-main/Dockerfile ./dsh-main', '2/3 Building dsh-main:latest');
  run('docker build -t dsh-tool:latest -f dsh-tool/Dockerfile ./dsh-tool', '3/3 Building dsh-tool:latest');
  console.log('\n✅ Built all 3 images successfully: dsh-gateway:latest, dsh-main:latest, dsh-tool:latest');
} catch (err) {
  console.error('\n❌ Failed to build images:', err.message);
  process.exit(1);
}
