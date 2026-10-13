import { getDb } from '../../lib/common/db.js';
import { cleanupStraySessionsAndWorkspaces } from '../../lib/user/workspace.js';
import fs from 'node:fs';
import path from 'node:path';

const db = getDb();
const testUsers = db.prepare("SELECT * FROM users WHERE username LIKE 'user_model_test_%' OR username LIKE 'test_flow_%' OR username LIKE 'user_%' OR username LIKE 'dev_%'").all();
console.log('Found test users in DB:', testUsers.map(u => u.username));

for (const u of testUsers) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
  db.prepare("DELETE FROM user_sessions WHERE username = ?").run(u.username);
  db.prepare("DELETE FROM attachments WHERE username = ?").run(u.username);
  db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
  
  const wsDir = path.join('workspaces', u.username);
  if (fs.existsSync(wsDir)) {
    fs.rmSync(wsDir, { recursive: true, force: true });
    console.log('Removed directory:', wsDir);
  }
}

// Clean up storages/workspace.json
const dshHome = process.env.DSH_HOME || 'C:\\Users\\Admin\\.dsh-multiuser';
const wsJsonPath = path.join(dshHome, 'storages', 'workspace.json');
if (fs.existsSync(wsJsonPath)) {
  const wsData = JSON.parse(fs.readFileSync(wsJsonPath, 'utf8'));
  const validUsernames = new Set(['admin', 'nvs', 'nva', 'nta']);
  const validIds = new Set(Array.from(validUsernames).map(u => `user-workspace-${u}`));

  if (wsData.global) {
    wsData.global.defaultWorkspaceId = 'user-workspace-admin';
    if (Array.isArray(wsData.global.workspaceIds)) {
      wsData.global.workspaceIds = wsData.global.workspaceIds.filter(id => validIds.has(id));
    }
  }

  if (wsData.tables && wsData.tables.workspaces) {
    const newWs = {};
    for (const [id, val] of Object.entries(wsData.tables.workspaces)) {
      if (validIds.has(id)) {
        newWs[id] = val;
      }
    }
    wsData.tables.workspaces = newWs;
  }

  fs.writeFileSync(wsJsonPath, JSON.stringify(wsData, null, 2), 'utf8');
  console.log('Cleaned storages/workspace.json. Remaining workspaces:', Object.keys(wsData.tables?.workspaces || {}));
}

// Call cleanupStraySessionsAndWorkspaces
cleanupStraySessionsAndWorkspaces();
console.log('Cleanup complete!');
