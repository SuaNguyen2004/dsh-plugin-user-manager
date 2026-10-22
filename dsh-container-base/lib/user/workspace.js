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

export function projectKey(cwd) {
  if (!cwd || cwd.length === 0) return '--root--';
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0');
      separatorRun = false;
    }
  }
  return '--' + (readable.replace(/^-+/, '') || 'root').slice(0, 251) + '--';
}

function registerRoWorkspaces(wsData, username) {
  const roDir = '/data/all_users_ro';
  if (!fs.existsSync(roDir)) return;

  const dshHome = process.env.DSH_HOME || '/data/dsh_home';
  const adminSessionsDir = path.join(dshHome, 'storages', 'session_projcache', 'sessions');
  const defaultSessionsDir = path.join(dshHome, 'sessions', '--data-workspace--');
  if (!fs.existsSync(adminSessionsDir)) {
    try { fs.mkdirSync(adminSessionsDir, { recursive: true }); } catch {}
  }
  if (!fs.existsSync(defaultSessionsDir)) {
    try { fs.mkdirSync(defaultSessionsDir, { recursive: true }); } catch {}
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
      const roProjKey = projectKey(roPath);
      const roSessionsDir = path.join(dshHome, 'sessions', roProjKey);
      if (!fs.existsSync(roSessionsDir)) {
        try { fs.mkdirSync(roSessionsDir, { recursive: true }); } catch {}
      }

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

        // Link and patch user's session files into Admin's session_projcache
        const uSessionsDir = path.join(userHomeDir, 'storages', 'session_projcache', 'sessions');
        if (fs.existsSync(uSessionsDir)) {
          try {
            const sFiles = fs.readdirSync(uSessionsDir);
            for (const sf of sFiles) {
              if (!sf.endsWith('.json')) continue;
              const sourceFile = path.join(uSessionsDir, sf);
              const targetJson = path.join(adminSessionsDir, sf);
              const sid = sf.replace('.json', '');

              try {
                // Copy and associate session's cwd to Admin's [View] workspace path
                const orig = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
                if (orig && orig.record && orig.record.identity) {
                  orig.record.identity.cwd = roPath;
                }
                if (fs.existsSync(targetJson)) {
                  try { fs.unlinkSync(targetJson); } catch {}
                }
                fs.writeFileSync(targetJson, JSON.stringify(orig, null, 2), 'utf8');
              } catch {
                if (!fs.existsSync(targetJson)) {
                  try { fs.symlinkSync(sourceFile, targetJson); } catch {}
                }
              }

              if (!userSessionIds.includes(sid)) userSessionIds.push(sid);

              // 2. Discover physical session directories and link into Admin's sessions/
              const possibleSessionDirs = [
                path.join(userHomeDir, 'sessions', '--data-workspace--', sid),
                path.join(userHomeDir, 'sessions', projectKey('/data/workspace'), sid)
              ];
              for (const pDir of possibleSessionDirs) {
                if (fs.existsSync(pDir)) {
                  const targetSubDirs = [
                    path.join(roSessionsDir, sid),
                    path.join(defaultSessionsDir, sid)
                  ];
                  for (const tSub of targetSubDirs) {
                    if (!fs.existsSync(tSub)) {
                      try { fs.mkdirSync(tSub, { recursive: true }); } catch {}
                    }
                    try {
                      for (const f of fs.readdirSync(pDir)) {
                        const sFile = path.join(pDir, f);
                        const dFile = path.join(tSub, f);
                        if (!fs.existsSync(dFile)) {
                          try { fs.symlinkSync(sFile, dFile); } catch {}
                        }
                      }
                    } catch {}
                  }
                  break;
                }
              }
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

