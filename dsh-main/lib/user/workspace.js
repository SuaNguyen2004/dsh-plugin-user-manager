import fs from 'node:fs';
import path from 'node:path';

export function getWorkspaceDir() {
  const dir = process.env.USER_WORKSPACE_DIR || '/data/workspace';
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync('/home/node/Admin')) {
    try { fs.mkdirSync('/home/node/Admin', { recursive: true }); } catch {}
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

  // Purge any legacy duplicate targetPhysDir folders
  const sessionsParent = path.join(dshHome, 'sessions');
  if (fs.existsSync(sessionsParent)) {
    try {
      const pDirs = fs.readdirSync(sessionsParent);
      for (const pd of pDirs) {
        if (pd.startsWith('--data-workspace-') && pd.includes('~')) {
          fs.rmSync(path.join(sessionsParent, pd), { recursive: true, force: true });
        }
      }
    } catch {}
  }

  try {
    const entries = fs.readdirSync(roDir, { withFileTypes: true });
    const currentAdminId = process.env.DSH_USER_ID || '1';

    if (!wsData.tables) wsData.tables = {};
    if (!wsData.tables.workspaces) wsData.tables.workspaces = {};
    if (!wsData.global) wsData.global = { initialized: true, workspaceIds: [] };
    if (!Array.isArray(wsData.global.workspaceIds)) wsData.global.workspaceIds = [];

    // Clean up legacy single-bucket entries if present
    for (const k of Object.keys(wsData.tables.workspaces)) {
      if (k.startsWith('ro-workspace-')) {
        delete wsData.tables.workspaces[k];
        wsData.global.workspaceIds = wsData.global.workspaceIds.filter(id => id !== k);
      }
    }

    const allRegisteredSessionIds = new Set();
    const adminWsId = 'user-workspace-' + username;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirname = entry.name;
      if (dirname === `${currentAdminId}_${username}` || dirname.toLowerCase().includes('admin')) {
        continue;
      }
      const friendly = dirname.replace(/^[0-9]+_/, '');
      const userHomeDir = findUserHomeDir(friendly, dirname);
      if (!userHomeDir) continue;

      const uSessionsDir = path.join(userHomeDir, 'storages', 'session_projcache', 'sessions');
      const uWsPath = path.join(userHomeDir, 'storages', 'workspace.json');
      let registeredAny = false;

      // Index all physical session folders for this user across all their project subdirectories
      const userPhysSessionMap = new Map();
      const uSessionsRoot = path.join(userHomeDir, 'sessions');
      if (fs.existsSync(uSessionsRoot)) {
        try {
          const projDirs = fs.readdirSync(uSessionsRoot, { withFileTypes: true });
          for (const pd of projDirs) {
            if (!pd.isDirectory()) continue;
            const pdPath = path.join(uSessionsRoot, pd.name);
            const sDirs = fs.readdirSync(pdPath, { withFileTypes: true });
            for (const sd of sDirs) {
              if (sd.isDirectory() && sd.name.startsWith('session-')) {
                userPhysSessionMap.set(sd.name, { srcPath: path.join(pdPath, sd.name), projName: pd.name });
              }
            }
          }
        } catch {}
      }

      if (fs.existsSync(uWsPath)) {
        try {
          const uData = JSON.parse(fs.readFileSync(uWsPath, 'utf8'));
          if (uData.tables?.workspaces) {
            for (const [uWsId, uWs] of Object.entries(uData.tables.workspaces)) {
              if (!uWs) continue;
              const roWsId = `ro-${friendly}-${uWsId}`;
              let rawTitle = (uWs.title || 'Workspace').trim();
              
              // Format cleanly: "Tên workspace (Tên User)"
              let displayTitle;
              if (rawTitle.toLowerCase().endsWith(`(${friendly.toLowerCase()})`)) {
                displayTitle = rawTitle;
              } else if (rawTitle.toLowerCase() === 'workspace') {
                displayTitle = `Workspace (${friendly})`;
              } else {
                displayTitle = `${rawTitle} (${friendly})`;
              }

              let wsBaseName = 'Workspace';
              if (rawTitle && rawTitle.toLowerCase() !== 'workspace') {
                wsBaseName = rawTitle.replace(/\s*\([^)]*\)\s*$/, '').trim();
              } else if (uWs.path && uWs.path !== '/data/workspace' && !uWs.path.endsWith('/workspace')) {
                wsBaseName = path.basename(uWs.path);
              }
              const roPath = `/data/workspace/${wsBaseName} (${friendly})`;

              const validSessionIds = [];
              const sessionIds = Array.isArray(uWs.sessionIds) ? uWs.sessionIds : [];

              for (const sid of sessionIds) {
                // 1. Copy session_projcache file into Admin's projcache
                if (fs.existsSync(uSessionsDir)) {
                  const srcProj = path.join(uSessionsDir, sid + '.json');
                  const dstProj = path.join(adminSessionsDir, sid + '.json');
                  if (fs.existsSync(srcProj)) {
                    try {
                      fs.copyFileSync(srcProj, dstProj);
                    } catch {
                      if (!fs.existsSync(dstProj)) {
                        try { fs.symlinkSync(srcProj, dstProj); } catch {}
                      }
                    }
                  }
                }

                // 2. Link physical session folder strictly into its native project folder (physInfo.projName)
                const physInfo = userPhysSessionMap.get(sid);
                if (physInfo && fs.existsSync(physInfo.srcPath)) {
                  const nativeProjDir = path.join(dshHome, 'sessions', physInfo.projName);
                  if (!fs.existsSync(nativeProjDir)) {
                    try { fs.mkdirSync(nativeProjDir, { recursive: true }); } catch {}
                  }
                  const dstNative = path.join(nativeProjDir, sid);
                  if (!fs.existsSync(dstNative)) {
                    try { fs.mkdirSync(dstNative, { recursive: true }); } catch {}
                  }
                  try {
                    for (const f of fs.readdirSync(physInfo.srcPath)) {
                      if (f === 'session.lock') continue;
                      const sF = path.join(physInfo.srcPath, f);
                      const dF = path.join(dstNative, f);
                      if (!fs.existsSync(dF)) {
                        try { fs.symlinkSync(sF, dF); } catch {}
                      }
                    }
                  } catch {}
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
          }
        } catch (e) {
          console.warn(`[dsh-user-plugin] Error reading workspace for ${friendly}:`, e.message);
        }
      }

      // Fallback: If no workspace records found, register default Workspace (username)
      if (!registeredAny) {
        const fallbackWsId = `ro-${friendly}-default`;
        const fallbackPath = `/data/workspace/Workspace (${friendly})`;
        wsData.tables.workspaces[fallbackWsId] = {
          path: fallbackPath,
          title: `Workspace (${friendly})`,
          sessionIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        if (!wsData.global.workspaceIds.includes(fallbackWsId)) {
          wsData.global.workspaceIds.push(fallbackWsId);
        }
      }
    }

    // Include Admin's own sessionIds from non-RO workspaces
    for (const [wId, w] of Object.entries(wsData.tables.workspaces)) {
      if (!wId.startsWith('ro-') && Array.isArray(w.sessionIds)) {
        w.sessionIds.forEach(id => allRegisteredSessionIds.add(id));
      }
    }

    // Absorb any loose Admin sessions into Admin's primary workspace so they don't fall into Ungrouped
    if (wsData.tables.workspaces[adminWsId]) {
      const aWs = wsData.tables.workspaces[adminWsId];
      try {
        if (fs.existsSync(defaultSessionsDir)) {
          for (const sName of fs.readdirSync(defaultSessionsDir)) {
            if (sName.startsWith('session-') && !allRegisteredSessionIds.has(sName)) {
              const pFile = path.join(adminSessionsDir, sName + '.json');
              if (fs.existsSync(pFile)) {
                try {
                  const pData = JSON.parse(fs.readFileSync(pFile, 'utf8'));
                  if (pData.record?.identity?.cwd === '/data/workspace') {
                    aWs.sessionIds.push(sName);
                    allRegisteredSessionIds.add(sName);
                  }
                } catch {}
              }
            }
          }
        }
      } catch {}
    }

    // Clean up any foreign sessions mistakenly placed in defaultSessionsDir (--data-workspace--)
    if (fs.existsSync(defaultSessionsDir)) {
      try {
        for (const sName of fs.readdirSync(defaultSessionsDir)) {
          if (!sName.startsWith('session-')) continue;
          const sPath = path.join(defaultSessionsDir, sName);
          const pFile = path.join(adminSessionsDir, sName + '.json');
          if (fs.existsSync(pFile)) {
            try {
              const pData = JSON.parse(fs.readFileSync(pFile, 'utf8'));
              if (pData.record?.identity?.cwd && pData.record.identity.cwd !== '/data/workspace') {
                fs.rmSync(sPath, { recursive: true, force: true });
                console.log(`[dsh-user-plugin] Removed misplaced foreign session from --data-workspace--: ${sName}`);
              }
            } catch {}
          }
        }
      } catch {}
    }

    // Cleanup: purge any orphan session projcache files that do not belong to any workspace
    // This ensures no ghost / unassigned sessions appear in the "Ungrouped" bucket!
    if (fs.existsSync(adminSessionsDir)) {
      try {
        for (const sf of fs.readdirSync(adminSessionsDir)) {
          if (!sf.endsWith('.json')) continue;
          const sid = sf.replace('.json', '');
          if (!allRegisteredSessionIds.has(sid)) {
            try {
              fs.unlinkSync(path.join(adminSessionsDir, sf));
              console.log(`[dsh-user-plugin] Cleaned up stray unassigned session from cache: ${sid}`);
            } catch {}
          }
        }
      } catch {}
    }
  } catch (err) {
    console.warn('[dsh-user-plugin] Could not register RO workspaces:', err.message);
  }
}

export function migrateWorkspaceAttachments() {
  const dshHome = process.env.DSH_HOME || '/data/dsh_home';
  const attachDir = path.join(dshHome, 'attachments', 'v1', 'files');
  if (!fs.existsSync(attachDir)) return;

  const wsRoot = getWorkspaceDir();
  const indexPath = path.join(dshHome, 'attachments', 'v1', 'workspace_files_index.json');
  let index = {};
  if (fs.existsSync(indexPath)) {
    try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch(e) {}
  }

  // Load workspace mapping
  const wsJsonPath = path.join(dshHome, 'storages', 'workspace.json');
  let wsData = null;
  if (fs.existsSync(wsJsonPath)) {
    try { wsData = JSON.parse(fs.readFileSync(wsJsonPath, 'utf8')); } catch(e) {}
  }

  try {
    const prefixes = fs.readdirSync(attachDir);
    for (const p of prefixes) {
      const pPath = path.join(attachDir, p);
      if (!fs.statSync(pPath).isDirectory()) continue;
      for (const h of fs.readdirSync(pPath)) {
        const hPath = path.join(pPath, h);
        for (const fn of fs.readdirSync(hPath)) {
          const fullSrc = path.join(hPath, fn);
          const ext = (path.extname(fn) || '').toLowerCase().replace('.', '');
          let cat = 'others';
          if (['doc', 'docx', 'dot', 'dotx', 'odt', 'rtf'].includes(ext)) cat = 'docs';
          else if (['pdf'].includes(ext)) cat = 'pdf';
          else if (['xls', 'xlsx', 'xlsm', 'csv', 'tsv'].includes(ext)) cat = 'sheets';
          else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) cat = 'images';
          else if (['txt', 'md', 'json', 'yaml', 'yml', 'xml', 'log', 'py', 'js', 'ts', 'html', 'css'].includes(ext)) cat = 'text';

          const key = 'sha256:' + h;
          if (index[key] && fs.existsSync(index[key])) {
            // Already indexed and exists, preserve current mapping
            continue;
          }

          let wsName = 'workspace';
          if (fn.toLowerCase().includes('quy') || h.startsWith('d404031a')) {
            wsName = 'alice-space';
          }

          const targetDir = path.join(wsRoot, wsName, 'files', cat);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          const targetFile = path.join(targetDir, fn);
          if (!fs.existsSync(targetFile)) {
            try {
              fs.copyFileSync(fullSrc, targetFile);
            } catch(e) {}
          }
          index[key] = `/data/workspace/${wsName}/files/${cat}/${fn}`;
        }
      }
    }
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
    console.log('[dsh-user-plugin] Synchronized workspace attachments and verified index.');
  } catch (err) {
    console.warn('[dsh-user-plugin] Attachment auto-sync warning:', err.message);
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
        migrateWorkspaceAttachments();
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
  migrateWorkspaceAttachments();
  console.log(`[dsh-user-plugin] Synchronized workspace "${wsId}" at path "${userDir}".`);
}

