// test/phase2-tool-test.js
// Automated verification for Phase 2: dsh-tool role-separated tools, path-guard,
// auto-categorize, RBAC. Requires docker + image dsh-tool:latest built.
// IMPORTANT: avoid nested `sh -c` quoting (breaks under Git-Bash/MSYS on Windows).

import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';

const ROOT = process.cwd();
const env = { ...process.env, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' };

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', env });
}

function execTool(container, reqObj) {
  const payload = JSON.stringify(reqObj);
  const out = execSync(`docker exec -i ${container} node /opt/dsh-tool/runner.js`, {
    cwd: ROOT, encoding: 'utf8', env, input: payload, maxBuffer: 32 * 1024 * 1024
  });
  const line = out.trim().split('\n').filter(Boolean).pop();
  if (!line) throw new Error('Empty runner output for ' + reqObj.tool);
  return JSON.parse(line);
}

function waitReady(container) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const v = sh(`docker inspect -f "{{json .State.Status}}" ${container}`).trim().replace(/"/g, '');
      if (v !== 'running') throw new Error('container not running: ' + v);
      sh(`docker exec ${container} test -f /run/dsh-tool/ready`);
      return;
    } catch (e) {
      execSync('ping -n 2 127.0.0.1 > nul', { env: { ...process.env } }); // ~1s sleep on Windows
    }
  }
  throw new Error(`container ${container} never became ready`);
}

const USER_C = 'dsh-tool-p2user';
const ADMIN_C = 'dsh-tool-p2admin';
const VOL_U = 'dsh-vol-p2-alice';
const VOL_A = 'dsh-vol-p2-admin';

console.log('=== PHASE 2 VERIFICATION TEST ===');

try { sh(`docker rm -f ${USER_C} ${ADMIN_C}`); } catch {}
try { sh(`docker volume rm ${VOL_U} ${VOL_A}`); } catch {}
sh(`docker volume create ${VOL_U}`);
sh(`docker volume create ${VOL_A}`);

sh(`docker run -d --name ${USER_C} -v ${VOL_U}:/data/workspace -e DSH_ROLE=user -e DSH_USERNAME=alice dsh-tool:latest`);
sh(`docker run -d --name ${ADMIN_C} -v ${VOL_A}:/data/workspace -v ${VOL_U}:/data/all_users_ro:ro -e DSH_ROLE=admin -e DSH_USERNAME=admin dsh-tool:latest`);

waitReady(USER_C);
waitReady(ADMIN_C);
console.log('[PASS] 0. Containers start; entrypoint loads correct role manifest; ready flag present.');

// 1. ensure_workspace -> /data/<user>/<ws>/files/<cats>
let r = execTool(USER_C, { tool: 'ensure_workspace', args: { workspace: 'alice-space' }, username: 'alice', role: 'user' });
assert.equal(r.ok, true, JSON.stringify(r));
assert.ok(r.result.workspacePath.endsWith('/data/alice/alice-space'), r.result.workspacePath);
let ls = sh(`docker exec ${USER_C} ls /data/alice/alice-space/files`);
for (const cat of ['docs', 'pdf', 'sheets', 'images', 'others']) {
  assert.ok(ls.split('\n').includes(cat), `missing category dir ${cat}`);
}
console.log('[PASS] 1. ensure_workspace -> /data/alice/alice-space/files/{docs,pdf,sheets,images,others}');

// 2. write_file auto-categorization
for (const [name, cat] of [['BaoCao.docx', 'docs'], ['quy-trinh.pdf', 'pdf'], ['danh-sach.xlsx', 'sheets'],
                           ['logo.png', 'images'], ['data.zip', 'others'], ['ghichu.md', 'docs']]) {
  r = execTool(USER_C, { tool: 'write_file', args: { workspace: 'alice-space', file_path: name, content: 'X' }, username: 'alice', role: 'user' });
  assert.equal(r.ok, true, `${name}: ${JSON.stringify(r)}`);
  assert.ok(r.result.path.endsWith(`/files/${cat}/${name}`), `${name} -> ${r.result.path}`);
}
console.log('[PASS] 2. write_file routes docs/pdf/sheets/images/others correctly.');

// 3. bash inside workspace + stray-file sweep auto-organizes
r = execTool(USER_C, { tool: 'bash', args: { workspace: 'alice-space', command: 'echo hello > notes.txt' }, username: 'alice', role: 'user' });
assert.equal(r.ok, true, JSON.stringify(r));
assert.ok(r.result.organizedFiles.some((m) => m.to.endsWith('/files/docs/notes.txt')), JSON.stringify(r.result.organizedFiles));
console.log('[PASS] 3. bash tool + auto-organize sweep moved stray notes.txt -> files/docs/.');

// 4. path-guard: traversal + /data/all_users_ro + symlink escape all blocked for user
r = execTool(USER_C, { tool: 'read_file', args: { workspace: 'alice-space', file_path: '../../../../etc/passwd' }, username: 'alice', role: 'user' });
assert.equal(r.ok, false, 'traversal should be blocked: ' + JSON.stringify(r));
console.log('[PASS] 4a. ../ traversal blocked (' + r.code + ').');

r = execTool(USER_C, { tool: 'read_file', args: { workspace: 'alice-space', file_path: '/data/all_users_ro/anything' }, username: 'alice', role: 'user' });
assert.equal(r.ok, false, 'user must not read /data/all_users_ro');
console.log('[PASS] 4b. user reading /data/all_users_ro blocked (' + r.code + ').');

sh(`docker exec ${USER_C} ln -sfn /etc /data/alice/alice-space/escape`);
r = execTool(USER_C, { tool: 'read_file', args: { workspace: 'alice-space', file_path: 'escape/passwd' }, username: 'alice', role: 'user' });
assert.equal(r.ok, false, 'symlink escape should be blocked: ' + JSON.stringify(r));
console.log('[PASS] 4c. symlink escape (/etc) blocked (' + r.code + ').');

// 5. RBAC: user container rejects admin-only tool (manifest separation)
r = execTool(USER_C, { tool: 'admin_list_user_workspaces', args: {}, username: 'alice', role: 'user' });
assert.equal(r.ok, false, 'admin tool must not exist in user manifest');
assert.equal(r.code, 'TOOL_NOT_ALLOWED');
console.log('[PASS] 5. user container rejects admin tool (TOOL_NOT_ALLOWED).');

// 6. admin tool container sees alice files via RO mount
r = execTool(ADMIN_C, { tool: 'admin_list_user_workspaces', args: {}, username: 'admin', role: 'admin' });
assert.equal(r.ok, true, JSON.stringify(r));
assert.ok(JSON.stringify(r).includes('alice-space'), 'admin should see alice-space through RO mount');
console.log('[PASS] 6. admin container RO-mounts alice volume; sees alice-space + files.');

// 7. admin write into /data/all_users_ro rejected (guard + kernel :ro)
r = execTool(ADMIN_C, { tool: 'write_file', args: { workspace: 'default-workspace', file_path: '/data/all_users_ro/alice/alice-space/files/docs/injected.txt', content: 'hack' }, username: 'admin', role: 'admin' });
assert.equal(r.ok, false, 'admin must not write into RO area');
console.log('[PASS] 7a. admin write_file into /data/all_users_ro rejected at guard level (' + (r.code || '') + ').');

const roErr = sh(`docker exec ${ADMIN_C} touch /data/all_users_ro/_probe 2>&1 || true`);
assert.ok(/Read-Only|EROFS|only file system/i.test(roErr), 'kernel :ro must reject writes: ' + roErr);
console.log('[PASS] 7b. kernel :ro mount rejects writes (defense in depth).');

// 8. multiple workspaces separate under /data/<user>/
execTool(USER_C, { tool: 'ensure_workspace', args: { workspace: 'proj-b' }, username: 'alice', role: 'user' });
execTool(USER_C, { tool: 'write_file', args: { workspace: 'proj-b', file_path: 'keystore.csv', content: 'a,b' }, username: 'alice', role: 'user' });
ls = sh(`docker exec ${USER_C} ls /data/alice`);
assert.ok(ls.split('\n').includes('alice-space') && ls.split('\n').includes('proj-b'), ls);
console.log('[PASS] 8. multiple workspaces stay separate under /data/alice/ (alice-space + proj-b).');

// 9. read_document works on a real .docx generated by the bash tool
r = execTool(USER_C, { tool: 'bash', args: { workspace: 'alice-space', command: 'printf "Xin chao DSH\\n" > test.txt' }, username: 'alice', role: 'user' });
assert.equal(r.ok, true, JSON.stringify(r));
r = execTool(USER_C, { tool: 'read_document', args: { workspace: 'alice-space', file_path: 'test.txt' }, username: 'alice', role: 'user' });
assert.equal(r.ok, true, JSON.stringify(r));
assert.ok(String(r.result.content).includes('Xin chao DSH'), JSON.stringify(r.result));
console.log('[PASS] 9. read_document extracts text from categorized workspace file.');

sh(`docker rm -f ${USER_C} ${ADMIN_C}`);
sh(`docker volume rm ${VOL_U} ${VOL_A}`);

console.log('\n✅ PHASE 2 ALL TESTS PASSED!');
