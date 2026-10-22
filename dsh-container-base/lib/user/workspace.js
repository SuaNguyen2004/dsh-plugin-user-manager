import fs from 'node:fs';
import path from 'node:path';

export function getWorkspaceDir() {
  const dir = process.env.USER_WORKSPACE_DIR || '/data/workspace';
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function findUserHomeDir(friendly, dirname) {
  const dshHomesRo = '/data/all_dsh_homes_ro';
  if (!fs.existsSync(dshHomesRo)) return null;

  try {
    const list = fs.readdirSync(dshHomesRo);
    for (const h of list) {
      const lower = h.toLowerCase();
      if (lower.endsWith('-' + friendly.toLowerCase()) || lower.includes(friendly.toLowerCase())) {
        return path.join(dshHomesRo, h);
      }
    }
  } catch {}
  return null;
}

function registerRoWorkspaces(wsData, username) {
  const roDir = '/data/all_users_ro';
  if (!fs.existsSync(roDir)) return;

  const dshHome = process.env.DSH_HOME || '/data/dsh_home';
  const adminSessionsDir = path.join(dshHome, 'storages', 'session_projcache', 'sessions');
  if (!fs.existsSync(adminSessionsDir)) {
    try { fs.mkdirSync(adminSessionsDir, { recursive: true }); } catch {}
  }

  try {
    const entries = fs.readdirSync(roDir, { withFileTypes: true });
    const currentAdminId = process.env.DSH_USER_ID || '1';

    if (!wsData.tables) wsData.tables = {};
    if (!wsData.tables.workspaces) wsData.tables.workspaces = {};
    if (!wsData.global) wsData.global = { initialized: true, workspaceIds: [] };
    if (!Array.isArray(wsData.global.workspaceIds)) wsData.global.workspaceIds = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirname = entry.name;
      if (dirname === `${currentAdminId}_${username}` || dirname.toLowerCase().includes('admin')) {
        continue;
      }
      const friendly = dirname.replace(/^[0-9]+_/, '');
      const roWsId = `ro-workspace-${friendly}`;
      const roPath = `/data/workspace/[View] ${friendly}`;

      // 1. Discover sessions from user's dsh_home
      const userSessionIds = [];
      const userHomeDir = findUserHomeDir(friendly, dirname);
      if (userHomeDir) {
        // Read user's workspace.json for their exact sessionIds
        const uWsPath = path.join(userHomeDir, 'storages', 'workspace.json');
        if (fs.existsSync(uWsPath)) {
          try {
            const uData = JSON.parse(fs.readFileSync(uWsPath, 'utf8'));
            if (uData.tables?.workspaces) {
              for (const ws of Object.values(uData.tables.workspaces)) {
                if (Array.isArray(ws.sessionIds)) {
                  for (const sid of ws.sessionIds) {
                    if (!userSessionIds.includes(sid)) userSessionIds.push(sid);
                  }
                }
              }
            }
          } catch {}
        }

        // Link user's session files into Admin's session_projcache
        const uSessionsDir = path.join(userHomeDir, 'storages', 'session_projcache', 'sessions');
        if (fs.existsSync(uSessionsDir)) {
          try {
            const sFiles = fs.readdirSync(uSessionsDir);
            for (const sf of sFiles) {
              if (!sf.endsWith('.json')) continue;
              const sourceFile = path.join(uSessionsDir, sf);
              const targetSymlink = path.join(adminSessionsDir, sf);
              if (!fs.existsSync(targetSymlink)) {
                try { fs.symlinkSync(sourceFile, targetSymlink); } catch {}
              }
              const sid = sf.replace('.json', '');
              if (!userSessionIds.includes(sid)) userSessionIds.push(sid);
            }
          } catch {}
        }
      }

      // 2. Register RO Workspace with discovered sessions
      wsData.tables.workspaces[roWsId] = {
        path: roPath,
        title: `[View] ${friendly}`,
        sessionIds: userSessionIds,
        createdAt: wsData.tables.workspaces[roWsId]?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (!wsData.global.workspaceIds.includes(roWsId)) {
        wsData.global.workspaceIds.push(roWsId);
      }
    }
  } catch (err) {
    console.warn('[dsh-user-plugin] Could not register RO workspaces:', err.message);
  }
}

export function syncContainerWorkspace(username = 'user') {
  const dshHome = process.env.DSH_HOME || '/data/dsh_home';
  const wsPath = path.join(dshHome, 'storages', 'workspace.json');

  if (!fs.existsSync(path.dirname(wsPath))) {
    fs.mkdirSync(path.dirname(wsPath), { recursive: true });
  }

  const userDir = getWorkspaceDir();
  const wsId = 'user-workspace-' + username;
  const title = `Workspace (${username})`;

  if (fs.existsSync(wsPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(wsPath, 'utf8'));
      if (existing && existing.tables && existing.tables.workspaces) {
        if (!existing.tables.workspaces[wsId]) {
          existing.tables.workspaces[wsId] = {
            path: userDir,
            title: title,
            sessionIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
        }
        if (!Array.isArray(existing.global?.workspaceIds)) {
          if (!existing.global) existing.global = {};
          existing.global.workspaceIds = [wsId];
        } else if (!existing.global.workspaceIds.includes(wsId)) {
          existing.global.workspaceIds.unshift(wsId);
        }
        registerRoWorkspaces(existing, username);
        fs.writeFileSync(wsPath, JSON.stringify(existing, null, 2), 'utf8');
        console.log(`[dsh-user-plugin] Preserved existing user workspaces and verified primary "${wsId}".`);
        return;
      }
    } catch (e) {
      console.warn('[dsh-user-plugin] Could not parse existing workspace.json, resetting:', e.message);
    }
  }

  const data = {
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      workspaceIds: [wsId],
      archivedSessionIds: [],
      pinnedSessionIds: []
    },
    tables: {
      workspaces: {
        [wsId]: {
          path: userDir,
          title: title,
          sessionIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }
    }
  };

  registerRoWorkspaces(data, username);
  fs.writeFileSync(wsPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[dsh-user-plugin] Synchronized workspace "${wsId}" at path "${userDir}".`);
}

