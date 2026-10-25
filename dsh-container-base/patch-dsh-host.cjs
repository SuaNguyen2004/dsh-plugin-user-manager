// dsh-container-base/patch-dsh-host.cjs
// 1. Unlocks 0.0.0.0 bind host for containerized environment
// 2. Patches isTrustedApiRequest to permit dynamic reverse proxy routing (Nginx)

const fs = require('fs');

// Patch 1: Unblock 0.0.0.0
const targetFile = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/lib/startup.js';
if (fs.existsSync(targetFile)) {
  let content = fs.readFileSync(targetFile, 'utf8');
  if (content.includes('options.host === "0.0.0.0"')) {
    content = content.replace('options.host === "0.0.0.0"', 'false /* 0.0.0.0 allowed in container */');
    fs.writeFileSync(targetFile, content, 'utf8');
    console.log('[patch-dsh-host] Successfully unblocked 0.0.0.0 host for DSH container.');
  }
}

// Patch 2: Allow reverse proxy Host/Origin through isTrustedApiRequest
const clientConnFiles = [
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js'
];

for (const clientConnFile of clientConnFiles) {
  if (fs.existsSync(clientConnFile)) {
    let connContent = fs.readFileSync(clientConnFile, 'utf8');
    if (connContent.includes('function isTrustedApiRequest(')) {
      connContent = connContent.replace(
        /function isTrustedApiRequest\([^)]*\)\s*\{[\s\S]*?\n\}/,
        'function isTrustedApiRequest(request, trustedHosts) {\n\treturn true; /* Allowed for multi-tenant reverse proxy */\n}'
      );
      fs.writeFileSync(clientConnFile, connContent, 'utf8');
      console.log('[patch-dsh-host] Successfully patched isTrustedApiRequest in:', clientConnFile);
    }
  }
}

// Patch 3: Allow reverse proxy Host/Origin in dshmarket http security checks
const marketHttpFiles = [
  '/usr/local/lib/node_modules/dshmarket/lib/http.js',
  '/app/node_modules/dshmarket/lib/http.js'
];

for (const marketHttpFile of marketHttpFiles) {
  if (fs.existsSync(marketHttpFile)) {
    let content = fs.readFileSync(marketHttpFile, 'utf8');
    if (content.includes('export function sameOrigin(')) {
      content = content.replace(
        /export function sameOrigin\([^)]*\)\s*\{[\s\S]*?\n\}/,
        'export function sameOrigin(request) {\n    return true;\n}'
      );
      content = content.replace(
        /export function trustedAuthority\([^)]*\)\s*\{[\s\S]*?\n\}/,
        'export function trustedAuthority(host, trustedHosts) {\n    return true;\n}'
      );
      fs.writeFileSync(marketHttpFile, content, 'utf8');
      console.log('[patch-dsh-host] Successfully patched dshmarket http security checks in:', marketHttpFile);
    }
  }
}

// Patch 4: Allow mounted volumes in assertOwnerOnly for credentials-local
const credsLocalFiles = [
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-credentials-local/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh-credentials-local/lib/index.js'
];

for (const credsFile of credsLocalFiles) {
  if (fs.existsSync(credsFile)) {
    let content = fs.readFileSync(credsFile, 'utf8');
    if (content.includes('async function assertOwnerOnly(')) {
      content = content.replace(
        /async function assertOwnerOnly\([^)]*\)\s*\{[\s\S]*?\n\}/,
        'async function assertOwnerOnly(filename) {\n\treturn; /* Allowed for container volume mount */\n}'
      );
      fs.writeFileSync(credsFile, content, 'utf8');
      console.log('[patch-dsh-host] Successfully patched assertOwnerOnly in:', credsFile);
    }
  }
}

// Patch 5: Allow Read-Only workspaces (<workspace> (<user>)) to retain their sessionIds & map session cwd for Admin
const workspaceLibFiles = [
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-workspace/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh-workspace/lib/index.js'
];

for (const wsFile of workspaceLibFiles) {
  if (fs.existsSync(wsFile)) {
    let content = fs.readFileSync(wsFile, 'utf8');
    let patched = false;

    // 5.1 Patch get sessionIds() to retain sessions in monitored workspaces
    if (content.includes('this.host.sessionPath(id) === this.record.path);')) {
      content = content.replace(
        'this.host.sessionPath(id) === this.record.path);',
        'this.host.sessionPath(id) === this.record.path || (this.record.path && (this.record.path.includes("[View]") || /\\([^)]+\\)/.test(this.record.path))));'
      );
      patched = true;
    } else if (content.includes('this.host.sessionPath(id) === this.record.path || (this.record.path && this.record.path.includes("[View]")));')) {
      content = content.replace(
        'this.host.sessionPath(id) === this.record.path || (this.record.path && this.record.path.includes("[View]")));',
        'this.host.sessionPath(id) === this.record.path || (this.record.path && (this.record.path.includes("[View]") || /\\([^)]+\\)/.test(this.record.path))));'
      );
      patched = true;
    }

    // 5.2 Patch mutate sessionIds filter
    if (content.includes('this.host.sessionPath(id) === changed.path);')) {
      content = content.replace(
        'this.host.sessionPath(id) === changed.path);',
        'this.host.sessionPath(id) === changed.path || (changed.path && (changed.path.includes("[View]") || /\\([^)]+\\)/.test(changed.path))));'
      );
      patched = true;
    } else if (content.includes('this.host.sessionPath(id) === changed.path || (changed.path && changed.path.includes("[View]")));')) {
      content = content.replace(
        'this.host.sessionPath(id) === changed.path || (changed.path && changed.path.includes("[View]")));',
        'this.host.sessionPath(id) === changed.path || (changed.path && (changed.path.includes("[View]") || /\\([^)]+\\)/.test(changed.path))));'
      );
      patched = true;
    }

    // 5.3 Patch sessionPath lookup to recognize sessions registered in workspace tables
    if (content.includes('sessionPath: (id) => this.sessionPaths.get(id),')) {
      content = content.replace(
        'sessionPath: (id) => this.sessionPaths.get(id),',
        `sessionPath: (id) => {
\t\ttry {
\t\t\tif (this.table) {
\t\t\t\tconst recs = this.table.records ? this.table.records.values() : (typeof this.table.entries === 'function' ? Array.from(this.table.entries()).map(e => e[1]) : []);
\t\t\t\tfor (const rec of recs) {
\t\t\t\t\tif (rec && rec.sessionIds && rec.sessionIds.includes(id)) return rec.path;
\t\t\t\t}
\t\t\t}
\t\t} catch (e) {}
\t\treturn this.sessionPaths.get(id);
\t},`
      );
      patched = true;
    }

    // 5.4 Patch indexHeader to dynamically map session cwd for Admin to matching (username) workspace path
    const targetIndexHeader = 'async indexHeader(header) {';
    if (content.includes(targetIndexHeader) && !content.includes('/* admin-session-cwd-mapped */')) {
      content = content.replace(
        targetIndexHeader,
        `async indexHeader(header) {
\t\t/* admin-session-cwd-mapped */
\t\tconst isAdmin = process.env.DSH_USER_ROLE === 'admin' || process.env.DSH_USER_NAME === 'admin';
\t\tif (isAdmin && header && header.id) {
\t\t\ttry {
\t\t\t\tif (this.table) {
\t\t\t\t\tconst recs = this.table.records ? this.table.records.values() : (typeof this.table.entries === 'function' ? Array.from(this.table.entries()).map(e => e[1]) : []);
\t\t\t\t\tfor (const rec of recs) {
\t\t\t\t\t\tif (rec && rec.sessionIds && rec.sessionIds.includes(header.id)) {
\t\t\t\t\t\t\theader.cwd = rec.path;
\t\t\t\t\t\t\tthis.headers.set(header.id, header);
\t\t\t\t\t\t\tthis.sessionPaths.set(header.id, rec.path);
\t\t\t\t\t\t\tthis.invalidSessionPaths.delete(header.id);
\t\t\t\t\t\t\treturn;
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\tif (header.cwd && !header.cwd.includes('(')) {
\t\t\t\t\tconst __fs = await import('node:fs');
\t\t\t\t\tconst __path = await import('node:path');
\t\t\t\t\tconst base = __path.basename(header.cwd);
\t\t\t\t\tif (__fs.existsSync('/data/workspace')) {
\t\t\t\t\t\tconst wsLinks = __fs.readdirSync('/data/workspace');
\t\t\t\t\t\tfor (const link of wsLinks) {
\t\t\t\t\t\t\tif (link.startsWith(base + ' (') || (base.toLowerCase() === 'workspace' && link.startsWith('Workspace ('))) {
\t\t\t\t\t\t\t\theader.cwd = '/data/workspace/' + link;
\t\t\t\t\t\t\t\tthis.headers.set(header.id, header);
\t\t\t\t\t\t\t\tthis.sessionPaths.set(header.id, header.cwd);
\t\t\t\t\t\t\t\tthis.invalidSessionPaths.delete(header.id);
\t\t\t\t\t\t\t\treturn;
\t\t\t\t\t\t\t}
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t}
\t\t\t} catch (e) {}
\t\t}`
      );
      patched = true;
    }

    if (patched) {
      fs.writeFileSync(wsFile, content, 'utf8');
      console.log('[patch-dsh-host] Successfully patched workspace grouping in:', wsFile);
    }
  }
}

// Patch 6: Handle read-only sessions gracefully without internal crash in dsh-api-session-controller
const apiSessionFiles = [
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js'
];

for (const apiFile of apiSessionFiles) {
  if (fs.existsSync(apiFile)) {
    let content = fs.readFileSync(apiFile, 'utf8');
    let patched = false;

    // 6.1 Handle EROFS in resolve
    const targetCatch = 'if (error instanceof Error && error.name === "SessionAlreadyOwnedError") return { error: new RemoteError("session/writer-held", error.message, { sessionId }) };';
    if (content.includes(targetCatch) && !content.includes('session/read-only')) {
      content = content.replace(
        targetCatch,
        `${targetCatch}
\t\t\tif (error && (error.code === 'EROFS' || String(error).includes('EROFS'))) {
\t\t\t\treturn { error: new RemoteError("session/read-only", "Phiên làm việc này thuộc về User khác (Chỉ đọc). Bạn không thể gửi tin nhắn vào phiên này. Vui lòng quay lại Workspace của Admin để chat bình thường.", { sessionId }) };
\t\t\t}`
      );
      patched = true;
    }

    // 6.2 Reject prompt on read-only sessions
    const targetPrompt = 'async prompt(request) {';
    if (content.includes(targetPrompt) && !content.includes('all_dsh_homes_ro')) {
      content = content.replace(
        targetPrompt,
        `async prompt(request) {
\t\ttry {
\t\t\tconst fs = await import('node:fs');
\t\t\tconst sPath = \`/data/dsh_home/sessions/--data-workspace--/\${request.sessionId}\`;
\t\t\tif (fs.existsSync(sPath)) {
\t\t\t\tfor (const f of fs.readdirSync(sPath)) {
\t\t\t\t\tconst fp = \`\${sPath}/\${f}\`;
\t\t\t\t\ttry {
\t\t\t\t\t\tif (fs.lstatSync(fp).isSymbolicLink() && fs.readlinkSync(fp).includes('all_dsh_homes_ro')) {
\t\t\t\t\t\t\tthrow new RemoteError("session/read-only", "Phiên làm việc này thuộc về User khác (Chỉ đọc). Bạn không thể gửi tin nhắn vào phiên này. Vui lòng quay lại Workspace của Admin để chat bình thường.", {});
\t\t\t\t\t\t}
\t\t\t\t\t} catch (e) {
\t\t\t\t\t\tif (e instanceof RemoteError) throw e;
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
\t\t} catch (e) {
\t\t\tif (e instanceof RemoteError) throw e;
\t\t}`
      );
      patched = true;
    }

    if (patched) {
      fs.writeFileSync(apiFile, content, 'utf8');
      console.log('[patch-dsh-host] Successfully patched session-controller read-only protection in:', apiFile);
    }
  }
}

// Patch 7: Disable Cordis internal token authentication (Main Gateway handles 100% of Auth & RBAC)
const dshClientConnFiles = [
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js'
];

for (const clientConnFile of dshClientConnFiles) {
  if (fs.existsSync(clientConnFile)) {
    let connContent = fs.readFileSync(clientConnFile, 'utf8');
    let patched = false;

    // 7.1 Bypass isAuthenticated -> always true
    if (connContent.includes('isAuthenticated(request) {')) {
      connContent = connContent.replace(
        /isAuthenticated\([^)]*\)\s*\{[\s\S]*?\n\t\}/,
        'isAuthenticated(request) {\n\t\treturn true; /* Authenticated by Main Gateway */\n\t}'
      );
      patched = true;
    }

    // 7.2 Bypass authorizeIndex -> always true
    if (connContent.includes('authorizeIndex(req, res) {')) {
      connContent = connContent.replace(
        /authorizeIndex\([^)]*\)\s*\{[\s\S]*?\n\t\}/,
        'authorizeIndex(req, res) {\n\t\treturn true; /* Authenticated by Main Gateway */\n\t}'
      );
      patched = true;
    }

    if (patched) {
      fs.writeFileSync(clientConnFile, connContent, 'utf8');
      console.log('[patch-dsh-host] Successfully disabled Cordis internal token auth in:', clientConnFile);
    }
  }
}

// Patch 8: Auto-organize uploaded files into workspace/files/<category>/<fileName>
const uploadLibFiles = [
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-file-upload/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh-client-file-upload/lib/index.js'
];

for (const uploadFile of uploadLibFiles) {
  if (fs.existsSync(uploadFile)) {
    let content = fs.readFileSync(uploadFile, 'utf8');
    let patched = false;

    // 8.1 Ensure fs and path imports exist
    if (!content.includes('import * as __nodeFs from "node:fs";')) {
      content = 'import * as __nodeFs from "node:fs";\nimport * as __nodePath from "node:path";\n' + content;
      patched = true;
    }

    // 8.2 In commit(agent, save): right after file = await save();
    const saveTarget = 'file = await save();';
    const organizeBlock = `file = await save();
\t\t\ttry {
\t\t\t\tconst sha256 = String(file?.attachmentId || '').replace(/^sha256:/, '');
\t\t\t\tif (sha256) {
\t\t\t\t\tconst prefix = sha256.slice(0, 2);
\t\t\t\t\tconst dshHome = process.env.DSH_HOME || '/data/dsh_home';
\t\t\t\t\tconst origPath = __nodePath.join(dshHome, 'attachments', 'v1', 'files', prefix, sha256, file.name);
\t\t\t\t\tlet wsName = 'workspace';
\t\t\t\t\tconst wsJsonPath = __nodePath.join(dshHome, 'storages', 'workspace.json');
\t\t\t\t\tif (__nodeFs.existsSync(wsJsonPath)) {
\t\t\t\t\t\ttry {
\t\t\t\t\t\t\tconst wsData = JSON.parse(__nodeFs.readFileSync(wsJsonPath, 'utf8'));
\t\t\t\t\t\t\tif (wsData && wsData.tables && wsData.tables.workspaces) {
\t\t\t\t\t\t\t\tfor (const ws of Object.values(wsData.tables.workspaces)) {
\t\t\t\t\t\t\t\t\tif (ws && Array.isArray(ws.sessionIds) && (ws.sessionIds.includes(agent.id) || ws.sessionIds.includes('session-' + agent.id))) {
\t\t\t\t\t\t\t\t\t\tlet title = (ws.title || '').replace(/\\s*\\([^)]*\\)$/, '').trim();
\t\t\t\t\t\t\t\t\t\tif (title && title.toLowerCase() !== 'workspace') {
\t\t\t\t\t\t\t\t\t\t\twsName = title;
\t\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t\t\tbreak;
\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t}
\t\t\t\t\t\t} catch (e) {}
\t\t\t\t\t}
\t\t\t\t\twsName = wsName.replace(/[\\\\/:*?"<>|]/g, '_');
\t\t\t\t\tconst ext = (__nodePath.extname(file.name) || '').toLowerCase().replace('.', '');
\t\t\t\t\tlet cat = 'others';
\t\t\t\t\tif (['doc', 'docx', 'dot', 'dotx', 'odt', 'rtf'].includes(ext)) cat = 'docs';
\t\t\t\t\telse if (['pdf'].includes(ext)) cat = 'pdf';
\t\t\t\t\telse if (['xls', 'xlsx', 'xlsm', 'csv', 'tsv'].includes(ext)) cat = 'sheets';
\t\t\t\t\telse if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) cat = 'images';
\t\t\t\t\telse if (['txt', 'md', 'json', 'yaml', 'yml', 'xml', 'log', 'py', 'js', 'ts', 'html', 'css'].includes(ext)) cat = 'text';

\t\t\t\t\tconst targetDir = __nodePath.join('/data/workspace', wsName, 'files', cat);
\t\t\t\t\tif (!__nodeFs.existsSync(targetDir)) {
\t\t\t\t\t\t__nodeFs.mkdirSync(targetDir, { recursive: true });
\t\t\t\t\t}
\t\t\t\t\tconst cleanFilePath = __nodePath.join(targetDir, file.name);
\t\t\t\t\tif (__nodeFs.existsSync(origPath)) {
\t\t\t\t\t\t__nodeFs.copyFileSync(origPath, cleanFilePath);
\t\t\t\t\t}
\t\t\t\t\tconst indexPath = __nodePath.join(dshHome, 'attachments', 'v1', 'workspace_files_index.json');
\t\t\t\t\tlet index = {};
\t\t\t\t\tif (__nodeFs.existsSync(indexPath)) {
\t\t\t\t\t\ttry { index = JSON.parse(__nodeFs.readFileSync(indexPath, 'utf8')); } catch (e) {}
\t\t\t\t\t}
\t\t\t\t\tindex[String(file.attachmentId)] = cleanFilePath;
\t\t\t\t\t__nodeFs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
\t\t\t\t\tconsole.log('[WorkspaceFile] Auto-organized file upload:', file.name, '->', cleanFilePath);
\t\t\t\t}
\t\t\t} catch (err) {
\t\t\t\tconsole.warn('[WorkspaceFile] Warning organizing upload:', err.message);
\t\t\t}`;

    if (content.includes(saveTarget) && !content.includes('workspace_files_index.json')) {
      content = content.replace(saveTarget, organizeBlock);
      patched = true;
    }

    if (patched) {
      fs.writeFileSync(uploadFile, content, 'utf8');
      console.log('[patch-dsh-host] Successfully patched file upload auto-organizer in:', uploadFile);
    }
  }
}

// Patch 9: Serve clean workspace path to LLM from fileHostPath
const attachmentLocalFiles = [
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js'
];

for (const attachFile of attachmentLocalFiles) {
  if (fs.existsSync(attachFile)) {
    let content = fs.readFileSync(attachFile, 'utf8');
    let patched = false;

    // 9.1 Ensure fs and path imports exist
    if (!content.includes('import * as __fsLocal from "node:fs";')) {
      content = 'import * as __fsLocal from "node:fs";\nimport * as __pathLocal from "node:path";\n' + content;
      patched = true;
    }

    // 9.2 Patch fileHostPath
    const targetMethod = 'fileHostPath(ref) {\n\t\treturn storedFilePath(this.root, ref);\n\t}';
    const cleanMethod = `fileHostPath(ref) {
\t\ttry {
\t\t\tconst indexPath = __pathLocal.join(this.root, 'workspace_files_index.json');
\t\t\tif (__fsLocal.existsSync(indexPath)) {
\t\t\t\tconst index = JSON.parse(__fsLocal.readFileSync(indexPath, 'utf8'));
\t\t\t\tconst customPath = index[String(ref.attachmentId)];
\t\t\t\tif (customPath && __fsLocal.existsSync(customPath)) {
\t\t\t\t\treturn customPath;
\t\t\t\t}
\t\t\t}
\t\t} catch (e) {}
\t\treturn storedFilePath(this.root, ref);
\t}`;

    if (content.includes(targetMethod)) {
      content = content.replace(targetMethod, cleanMethod);
      patched = true;
    }

    if (patched) {
      fs.writeFileSync(attachFile, content, 'utf8');
      console.log('[patch-dsh-host] Successfully patched fileHostPath for workspace in:', attachFile);
    }
  }
}

// Patch 7: Prevent assertStoredIdentity and duplicate session checks from throwing fatal errors
const jsonlPersistenceFiles = [
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js'
];

for (const pFile of jsonlPersistenceFiles) {
  if (fs.existsSync(pFile)) {
    let pContent = fs.readFileSync(pFile, 'utf8');
    let patched = false;
    const throwTarget = 'throw new Error(`corrupt session log "${path}": header id "${meta.id}" and cwd identify "${expectedPath}"`);';
    if (pContent.includes(throwTarget)) {
      pContent = pContent.replace(
        throwTarget,
        'return; /* Tolerated for multi-tenant mapped sessions */'
      );
      patched = true;
    }
    const dupListTarget = 'if (ids.has(header.id)) throw new Error(`duplicate JSONL session id "${header.id}" appears in multiple project directories`);';
    if (pContent.includes(dupListTarget)) {
      pContent = pContent.replace(
        dupListTarget,
        'if (ids.has(header.id)) continue; /* Tolerated for multi-tenant mapped sessions */'
      );
      patched = true;
    }
    const dupFindTarget = 'if (matches.length > 1) throw new Error(`duplicate JSONL session id "${id}" appears in multiple project directories`);';
    if (pContent.includes(dupFindTarget)) {
      pContent = pContent.replace(
        dupFindTarget,
        '/* Tolerated duplicate session across directories */'
      );
      patched = true;
    }
    if (patched) {
      fs.writeFileSync(pFile, pContent, 'utf8');
      console.log('[patch-dsh-host] Successfully patched session persistence resilience in:', pFile);
    }
  }
}

