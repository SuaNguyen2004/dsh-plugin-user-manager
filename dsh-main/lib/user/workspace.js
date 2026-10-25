// dsh-main/lib/user/workspace.js
// Synchronizes a tenant's workspace.json inside their private DSH_HOME
// (/data/dsh_homes/user-<id>-<username>) and, when the tenant is Admin,
// mirrors every other user's workspaces & session logs from /data/dsh_homes/user-*
// into Admin's workspace table as Read-Only entries ("<ws> (<username>)").
//
// Works entirely inside the `dsh-homes` volume mounted at /data/dsh_homes —
// NO workspace volume is mounted on dsh-main, and NO entrypoint symlinks are required.

import fs from 'node:fs';
import path from 'node:path';

function getHomesRoot() {
  return process.env.DSH_HOMES_ROOT || '/data/dsh_homes';
}

export function getWorkspaceDir() {
  const dshHome = process.env.DSH_HOME || '/data/dsh_home';
  const dir = path.posix.join(dshHome, 'workspaces', 'default-workspace');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Return an array of { userId, username, homeDir } for all non-admin tenant homes in /data/dsh_homes. */
export function listOtherUserHomes(currentUserId, currentUsername) {
  const homesRoot = getHomesRoot();
  if (!fs.existsSync(homesRoot)) return [];
  const out = [];
  for (const entry of fs.readdirSync(homesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const m = /^user-([^-]+)-(.+)$/.exec(entry.name);
    if (!m) continue;
    const [, uid, uname] = m;
    if (String(uid) === String(currentUserId) || uname.toLowerCase() === String(currentUsername).toLowerCase() || uname.toLowerCase() === 'admin') {
      continue;
    }
    out.push({ userId: uid, username: uname, homeDir: path.posix.join(homesRoot, entry.name) });
  }
  return out;
}

/** Check whether a sessionId belongs to another user (read-only for Admin). */
export function isReadOnlyUserSession(sessionId, dshHome = process.env.DSH_HOME || '/data/dsh_home') {
  if (!sessionId) return false;
  try {
    const wsPath = path.posix.join(dshHome, 'storages', 'workspace.json');
    if (fs.existsSync(wsPath)) {
      const wsData = JSON.parse(fs.readFileSync(wsPath, 'utf8'));
      const workspaces = wsData?.tables?.workspaces || {};
      for (const [wsId, ws] of Object.entries(workspaces)) {
        if (wsId.startsWith('ro-') && Array.isArray(ws?.sessionIds) && ws.sessionIds.includes(sessionId)) {
          return true;
        }
      }
    }
    // Also check if any file inside the session directory is a symlink pointing into another user's home
    const sessionsRoot = path.posix.join(dshHome, 'sessions');
    if (fs.existsSync(sessionsRoot)) {
      for (const proj of fs.readdirSync(sessionsRoot)) {
        const sDir = path.posix.join(sessionsRoot, proj, sessionId);
        if (!fs.existsSync(sDir)) continue;
        for (const f of fs.readdirSync(sDir)) {
          const fp = path.posix.join(sDir, f);
          const st = fs.lstatSync(fp);
          if (st.isSymbolicLink()) {
            const target = fs.readlinkSync(fp);
            if (!target.startsWith(dshHome)) return true;
          }
        }
      }
    }
  } catch {}
  return false;
}

function registerRoWorkspacesFromHomes(wsData, adminUsername) {
  const dshHome = process.env.DSH_HOME || '/data/dsh_home';
  const adminUserId = process.env.DSH_USER_ID || '1';
  const adminSessionsDir = path.posix.join(dshHome, 'storages', 'session_projcache', 'sessions');
  const roStubRoot = path.posix.join(dshHome, 'ro_workspaces');
  fs.mkdirSync(adminSessionsDir, { recursive: true });
  fs.mkdirSync(roStubRoot, { recursive: true });

  if (!wsData.tables) wsData.tables = {};
  if (!wsData.tables.workspaces) wsData.tables.workspaces = {};
  if (!wsData.global) wsData.global = { initialized: true, workspaceIds: [] };
  if (!Array.isArray(wsData.global.workspaceIds)) wsData.global.workspaceIds = [];

  const allRegisteredSessionIds = new Set();
  const otherHomes = listOtherUserHomes(adminUserId, adminUsername);

  for (const { username: friendly, homeDir: userHomeDir } of otherHomes) {
    const uSessionsDir = path.posix.join(userHomeDir, 'storages', 'session_projcache', 'sessions');
    const uWsPath = path.posix.join(userHomeDir, 'storages', 'workspace.json');

    // Index all physical session folders for this user across their project subdirectories
    const userPhysSessionMap = new Map();
    const uSessionsRoot = path.posix.join(userHomeDir, 'sessions');
    if (fs.existsSync(uSessionsRoot)) {
      try {
        for (const pd of fs.readdirSync(uSessionsRoot, { withFileTypes: true })) {
          if (!pd.isDirectory()) continue;
          const pdPath = path.posix.join(uSessionsRoot, pd.name);
          for (const sd of fs.readdirSync(pdPath, { withFileTypes: true })) {
            if (sd.isDirectory() && sd.name.startsWith('session-')) {
              userPhysSessionMap.set(sd.name, { srcPath: path.posix.join(pdPath, sd.name), projName: pd.name });
            }
          }
        }
      } catch {}
    }

    let registeredAny = false;
    if (fs.existsSync(uWsPath)) {
      try {
        const uData = JSON.parse(fs.readFileSync(uWsPath, 'utf8'));
        const uWorkspaces = uData?.tables?.workspaces || {};
        for (const [uWsId, uWs] of Object.entries(uWorkspaces)) {
          if (!uWs || uWsId.startsWith('ro-')) continue;
          const roWsId = `ro-${friendly}-${uWsId}`;
          const rawTitle = String(uWs.title || 'Workspace').replace(/\s*\([^)]*\)\s*$/, '').trim() || 'Workspace';
          const displayTitle = `${rawTitle} (${friendly})`;

          // Create an existing directory stub so DSH's realpathNormalize(ws.path) succeeds without mounting workspace volumes
          const roPath = path.posix.join(roStubRoot, `${rawTitle} (${friendly})`);
          fs.mkdirSync(roPath, { recursive: true });

          const validSessionIds = [];
          const sessionIds = Array.isArray(uWs.sessionIds) ? uWs.sessionIds : [];
          for (const sid of sessionIds) {
            if (fs.existsSync(uSessionsDir)) {
              const srcProj = path.posix.join(uSessionsDir, `${sid}.json`);
              const dstProj = path.posix.join(adminSessionsDir, `${sid}.json`);
              if (fs.existsSync(srcProj)) {
                try { fs.copyFileSync(srcProj, dstProj); } catch {}
              }
            }
            const physInfo = userPhysSessionMap.get(sid);
            if (physInfo && fs.existsSync(physInfo.srcPath)) {
              const dstNative = path.posix.join(dshHome, 'sessions', physInfo.projName, sid);
              fs.mkdirSync(dstNative, { recursive: true });
              for (const f of fs.readdirSync(physInfo.srcPath)) {
                if (f === 'session.lock') continue;
                const sF = path.posix.join(physInfo.srcPath, f);
                const dF = path.posix.join(dstNative, f);
                if (!fs.existsSync(dF)) {
                  try { fs.symlinkSync(sF, dF); } catch {}
                }
              }
            }
            validSessionIds.push(sid);
            allRegisteredSessionIds.add(sid);
          }

          wsData.tables.workspaces[roWsId] = {
            path: roPath,
            title: displayTitle,
            sessionIds: validSessionIds,
            createdAt: uWs.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          if (!wsData.global.workspaceIds.includes(roWsId)) {
            wsData.global.workspaceIds.push(roWsId);
          }
          registeredAny = true;
        }
      } catch {}
    }

    if (!registeredAny) {
      const roWsId = `ro-${friendly}-default`;
      const roPath = path.posix.join(roStubRoot, `default-workspace (${friendly})`);
      fs.mkdirSync(roPath, { recursive: true });
      const validSessionIds = [...userPhysSessionMap.keys()];
      for (const [sid, physInfo] of userPhysSessionMap.entries()) {
        const dstNative = path.posix.join(dshHome, 'sessions', physInfo.projName, sid);
        fs.mkdirSync(dstNative, { recursive: true });
        for (const f of fs.readdirSync(physInfo.srcPath)) {
          if (f === 'session.lock') continue;
          const sF = path.posix.join(physInfo.srcPath, f);
          const dF = path.posix.join(dstNative, f);
          if (!fs.existsSync(dF)) {
            try { fs.symlinkSync(sF, dF); } catch {}
          }
        }
        allRegisteredSessionIds.add(sid);
      }
      wsData.tables.workspaces[roWsId] = {
        path: roPath,
        title: `default-workspace (${friendly})`,
        sessionIds: validSessionIds,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      if (!wsData.global.workspaceIds.includes(roWsId)) {
        wsData.global.workspaceIds.push(roWsId);
      }
    }
  }
}

export function syncContainerWorkspace(username = 'user', role = process.env.DSH_USER_ROLE || 'user') {
  const dshHome = process.env.DSH_HOME || '/data/dsh_home';
  const wsPath = path.posix.join(dshHome, 'storages', 'workspace.json');
  fs.mkdirSync(path.posix.dirname(wsPath), { recursive: true });

  const userDir = getWorkspaceDir();
  const wsId = `user-workspace-${username}`;
  const title = `default-workspace (${username})`;
  const isAdmin = String(role).toLowerCase() === 'admin' || username.toLowerCase() === 'admin';

  let data = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [wsId], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: {
      workspaces: {
        [wsId]: {
          path: userDir,
          title,
          sessionIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }
    }
  };

  if (fs.existsSync(wsPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(wsPath, 'utf8'));
      if (existing?.tables?.workspaces) {
        data = existing;
        if (!data.tables.workspaces[wsId]) {
          data.tables.workspaces[wsId] = {
            path: userDir,
            title,
            sessionIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
        }
        if (!Array.isArray(data.global?.workspaceIds)) {
          data.global = { ...(data.global || {}), initialized: true, workspaceIds: [wsId] };
        } else if (!data.global.workspaceIds.includes(wsId)) {
          data.global.workspaceIds.unshift(wsId);
        }
      }
    } catch {}
  }

  if (isAdmin) {
    registerRoWorkspacesFromHomes(data, username);
  }
  fs.writeFileSync(wsPath, JSON.stringify(data, null, 2), 'utf8');
  return data;
}
