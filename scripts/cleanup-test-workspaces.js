// scripts/cleanup-test-workspaces.js
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

console.log('=== CLEANING UP TEST / VIRTUAL WORKSPACES ===');

// 1. Run cleanup inside dsh-main
const cleanupScript = `
const fs = require('fs');
const path = require('path');

const homesRoot = '/data/dsh_homes';
const entries = fs.readdirSync(homesRoot);

const testUserDirs = [
  'admin',
  'user-6-e2ealice',
  'user-9-e2ealice',
  'user-10-e2ebob',
  'user-11-e2erace',
  'user-12-e2ealice',
  'user-13-e2ebob',
  'user-14-e2erace',
  'user-901-smokealice'
];

for (const d of entries) {
  if (testUserDirs.includes(d) || (d.startsWith('user-') && (d.includes('e2e') || d.includes('smoke') || d.includes('test')))) {
    const fullPath = path.join(homesRoot, d);
    console.log('[CLEANUP] Removing test user home:', fullPath);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

// 2. Clean ro_workspaces in user-1-admin
const roDir = '/data/dsh_homes/user-1-admin/ro_workspaces';
if (fs.existsSync(roDir)) {
  const roEntries = fs.readdirSync(roDir);
  for (const f of roEntries) {
    if (f.includes('e2e') || f.includes('smoke') || f.includes('test') || !f.startsWith('ro-')) {
      const p = path.join(roDir, f);
      console.log('[CLEANUP] Removing stale/test ro_workspace stub:', p);
      fs.rmSync(p, { recursive: true, force: true });
    }
  }
}

// 3. Clean user-1-admin workspace.json
const wsJsonPath = '/data/dsh_homes/user-1-admin/storages/workspace.json';
if (fs.existsSync(wsJsonPath)) {
  const data = JSON.parse(fs.readFileSync(wsJsonPath, 'utf8'));
  const workspaces = data.tables?.workspaces || {};
  let removedCount = 0;

  for (const [wsId, ws] of Object.entries(workspaces)) {
    const title = (ws.title || '').toLowerCase();
    if (wsId.includes('e2e') || wsId.includes('smoke') || title.includes('e2e') || title.includes('smoke')) {
      console.log('[CLEANUP] Removing test workspace entry:', wsId, '->', ws.title);
      delete workspaces[wsId];
      removedCount++;
    }
  }

  if (Array.isArray(data.global?.workspaceIds)) {
    data.global.workspaceIds = data.global.workspaceIds.filter(id => {
      return !id.includes('e2e') && !id.includes('smoke') && workspaces[id] !== undefined;
    });
  }

  fs.writeFileSync(wsJsonPath, JSON.stringify(data, null, 2), 'utf8');
  console.log('[CLEANUP] Updated workspace.json, removed ' + removedCount + ' test workspace entries.');
}
`;

try {
  execSync(`docker exec dsh-main node -e "${cleanupScript.replace(/\r?\n/g, ' ')}"`, { stdio: 'inherit' });
} catch (e) {
  console.error('[ERROR] Failed executing cleanup inside dsh-main:', e.message);
}

// 4. Remove leftover test docker volumes
const testVolumes = ['dsh-vol-p2-admin', 'dsh-vol-p2-alice', 'dsh-vol-verify', 'dsh-vol-verify2'];
for (const vol of testVolumes) {
  try {
    execSync(`docker volume rm ${vol}`, { stdio: 'pipe' });
    console.log('[CLEANUP] Removed test volume:', vol);
  } catch (e) {
    // Volume might not exist or already removed
  }
}

console.log('=== CLEANUP FINISHED ===');

