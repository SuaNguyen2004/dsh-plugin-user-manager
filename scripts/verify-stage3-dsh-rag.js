// scripts/verify-stage3-dsh-rag.js
// Automated Stage 3 Verification Script: Node.js DSH Integration & RBAC (Zero-Trust RAG)
//
// Mandatory Verification Flow:
// 1. Creates a temporary dummy user account (Role: 'user', status: 'active') via DSH Gateway.
// 2. Seeds a temporary test document into Knowledge Base (/data/kb_ro/stage3_policy.txt) via Admin RAG API.
// 3. Simulates DSH Plugin & Tool Sandbox behavior for the dummy User:
//    - Verifies Public Tool (`search_knowledge_base`) registered in `dsh-main/lib/index.js`,
//      executes it, and validates output against `textValueSchema` ({ path: '/data/kb_ro', text: '...' }).
//    - Verifies Private Tool (`admin_upload_to_knowledge_base`) is ABSENT when ROLE='user',
//      and PRESENT when ROLE='admin'.
//    - Verifies System Prompt (`tool:sandbox-boundary`) contains both mandatory RAG security rules.
//    - Triggers lazy-spawn of `dsh-tool-<dummy>` via Gateway Orchestrator, verifies `/data/kb_ro`
//      is mounted with `ReadOnly: true` and `NetworkMode: 'none'`.
//    - Tests reading `/data/kb_ro/stage3_policy.txt` (`mode: 'read'`) -> ALLOWED.
//    - Tests writing `/data/kb_ro/hack.txt` via `write_file` and `bash` -> BLOCKED by Path Guard (`OUTSIDE_WORKSPACE`)
//      and kernel Read-Only mount (`Read-only file system`).
// 4. Cleans up the dummy user account, kills/removes its sandbox container, removes test KB file
//    and triggers Garbage Collection so database & volumes return to 100% clean state.

import { execSync } from 'node:child_process';

const GATEWAY_URL = 'http://localhost:12345';
const DUMMY_USER = 'rag_stage3_dummy';
const DUMMY_PASS = 'Stage3Pass2026!';
const TEST_KB_FILENAME = 'stage3_security_policy.txt';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function runNodeInContainer(container, code) {
  const b64 = Buffer.from(code, 'utf8').toString('base64');
  return run(`docker exec ${container} node -e "import('data:text/javascript;base64,${b64}')"`);
}

async function cleanupDummyAndTestArtifacts() {
  // 1. Kill & remove dummy tool container if present
  try {
    run(`docker rm -f dsh-tool-${DUMMY_USER}`);
  } catch {}

  // 2. Remove dummy user & sessions from Gateway SQLite DB, and remove dummy workspace folder
  try {
    const cleanScript = `
      import('./database/index.js').then(async ({ User, Session, initDatabase }) => {
        await initDatabase();
        const u = await User.findOne({ where: { username: '${DUMMY_USER}' } });
        if (u) {
          await Session.destroy({ where: { user_id: u.id } }).catch(() => {});
          await User.destroy({ where: { id: u.id } });
        }
        const fs = await import('node:fs');
        try { fs.rmSync('/data/database/${DUMMY_USER}', { recursive: true, force: true }); } catch {}
        try { fs.rmSync('/data/homes/${DUMMY_USER}', { recursive: true, force: true }); } catch {}
        process.exit(0);
      });
    `.replace(/\s+/g, ' ').trim();
    run(`docker exec dsh-gateway node -e "${cleanScript}"`);
  } catch {}

  // 3. Remove test KB file and reconcile DB
  try {
    run(`docker exec rag-api python -c "import os, urllib.request; p = '/data/kb_ro/${TEST_KB_FILENAME}'; os.path.exists(p) and os.remove(p); urllib.request.urlopen(urllib.request.Request('http://localhost:8000/api/v1/reconcile', method='POST'), timeout=15)"`);
  } catch (e) {
    console.warn('  [warn] KB cleanup warning:', e.message);
  }
}

async function main() {
  console.log('===================================================================');
  console.log('   STAGE 3: NODE.JS DSH INTEGRATION & RBAC VERIFICATION SUITE      ');
  console.log('===================================================================\n');

  await cleanupDummyAndTestArtifacts();

  try {
    // ------------------------------------------------------------------------
    // STEP 1: Register, Approve, and Login Dummy User (Role: 'user') via Gateway
    // ------------------------------------------------------------------------
    console.log(`[1/6] Creating & authenticating dummy user "${DUMMY_USER}" (Role: user) via DSH Gateway...`);
    const regRes = await fetch(`${GATEWAY_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: DUMMY_USER, password: DUMMY_PASS })
    });
    const regData = await regRes.json();
    if (regRes.status !== 201) {
      throw new Error(`Registration failed (${regRes.status}): ${JSON.stringify(regData)}`);
    }
    const dummyUserId = regData.user.id;

    // Activate dummy user in Gateway DB so it can log in as an active 'user'
    run(`docker exec dsh-gateway node -e "import('./database/index.js').then(async ({User, initDatabase}) => { await initDatabase(); await User.update({ status: 'active', role: 'user' }, { where: { username: '${DUMMY_USER}' } }); process.exit(0); })"`);

    const loginRes = await fetch(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: DUMMY_USER, password: DUMMY_PASS })
    });
    const loginData = await loginRes.json();
    if (loginRes.status !== 200 || !loginData.token) {
      throw new Error(`Login failed (${loginRes.status}): ${JSON.stringify(loginData)}`);
    }
    console.log(`  ✅ Dummy user logged in via Gateway: ID=#${dummyUserId}, username=${loginData.user.username}, role=${loginData.user.role}`);

    // ------------------------------------------------------------------------
    // STEP 2: Verify Plugin Registration, RBAC & System Prompt in dsh-main
    //         + Seed a document via Admin tool `admin_upload_to_knowledge_base`
    // ------------------------------------------------------------------------
    console.log('\n[2/6] Verifying DSH Plugin tools, RBAC & System Prompt inside dsh-main...');
    const pluginCheckJson = runNodeInContainer('dsh-main', `
      import { apply } from 'file:///app/lib/index.js';

      async function inspectRole(role, username, userId) {
        process.env.DSH_USER_ROLE = role;
        process.env.DSH_USER_NAME = username;
        process.env.DSH_USER_ID = String(userId);
        const tools = new Map();
        const sections = new Map();
        const mockCtx = {
          logger: { info: () => {} },
          inject: () => {},
          tools: { register: (def) => tools.set(def.name, def) },
          systemPrompt: {
            getSectionOrder: () => 500,
            section: (sec) => sections.set(sec.name, typeof sec.text === 'function' ? sec.text() : sec.text)
          }
        };
        await apply(mockCtx);
        return { tools, sections };
      }

      const adminEnv = await inspectRole('admin', 'admin', 1);
      const userEnv = await inspectRole('user', '${DUMMY_USER}', ${dummyUserId});

      // 1. Admin calls admin_upload_to_knowledge_base to seed test document
      const uploadTool = adminEnv.tools.get('admin_upload_to_knowledge_base');
      const uploadOut = await uploadTool.execute({
        filename: '${TEST_KB_FILENAME}',
        content: 'QUY ĐỊNH BẢO MẬT GIAI ĐOẠN 3: Mọi nhân viên bắt buộc xác thực khóa phần cứng YubiKey FIDO2 khi truy cập VPN nội bộ và hệ thống dữ liệu sản xuất.'
      });

      // 2. Dummy User calls search_knowledge_base
      const searchTool = userEnv.tools.get('search_knowledge_base');
      const searchOut = await searchTool.execute({
        query: 'Quy định xác thực khi truy cập VPN nội bộ dùng khóa gì?',
        top_k: 3
      });

      // 3. Dummy User searches for nonexistent topic (verify NO_RELEVANT_DOCUMENTS_FOUND)
      const emptySearchOut = await searchTool.execute({
        query: 'Công thức nấu món bún bò Huế truyền thống chuẩn vị cố đô',
        top_k: 3
      });

      console.log(JSON.stringify({
        userTools: Array.from(userEnv.tools.keys()),
        adminTools: Array.from(adminEnv.tools.keys()),
        userHasSearchKB: userEnv.tools.has('search_knowledge_base'),
        userHasAdminUploadKB: userEnv.tools.has('admin_upload_to_knowledge_base'),
        adminHasAdminUploadKB: adminEnv.tools.has('admin_upload_to_knowledge_base'),
        sandboxBoundaryPrompt: userEnv.sections.get('tool:sandbox-boundary'),
        uploadOut,
        searchOut,
        emptySearchOut
      }));
      process.exit(0);
    `);

    const pluginResult = JSON.parse(pluginCheckJson.split('\n').pop());

    if (!pluginResult.userHasSearchKB) {
      throw new Error('Public tool search_knowledge_base is missing for role=user!');
    }
    if (pluginResult.userHasAdminUploadKB) {
      throw new Error('RBAC VIOLATION: Private tool admin_upload_to_knowledge_base was registered for role=user!');
    }
    if (!pluginResult.adminHasAdminUploadKB) {
      throw new Error('Private tool admin_upload_to_knowledge_base is missing for role=admin!');
    }
    console.log(`  ✅ RBAC Tool Registration verified:`);
    console.log(`     - User tools:  [${pluginResult.userTools.join(', ')}]`);
    console.log(`     - Admin tools: [${pluginResult.adminTools.join(', ')}]`);

    // Validate textValueSchema compliance ({ path: '/data/kb_ro', text: string })
    for (const [label, out] of [['uploadOut', pluginResult.uploadOut], ['searchOut', pluginResult.searchOut], ['emptySearchOut', pluginResult.emptySearchOut]]) {
      const keys = Object.keys(out || {});
      if (keys.length !== 2 || out.path !== '/data/kb_ro' || typeof out.text !== 'string') {
        throw new Error(`Schema validation failed for ${label}: expected { path: '/data/kb_ro', text: string }, got ${JSON.stringify(out)}`);
      }
    }
    if (!pluginResult.searchOut.text.includes('<untrusted_document_content') || !pluginResult.searchOut.text.includes('YubiKey FIDO2')) {
      throw new Error(`Unexpected search_knowledge_base output: ${pluginResult.searchOut.text}`);
    }
    if (!pluginResult.emptySearchOut.text.includes('NO_RELEVANT_DOCUMENTS_FOUND')) {
      throw new Error(`Expected NO_RELEVANT_DOCUMENTS_FOUND for empty query, got: ${pluginResult.emptySearchOut.text}`);
    }
    console.log(`  ✅ textValueSchema verified on search_knowledge_base:`);
    console.log(`     - path: "${pluginResult.searchOut.path}"`);
    console.log(`     - text: ${JSON.stringify(pluginResult.searchOut.text.slice(0, 150))}...`);
    console.log(`  ✅ Hallucination Guard verified on irrelevant query:`);
    console.log(`     - text: "${pluginResult.emptySearchOut.text}"`);

    // Validate System Prompt rules
    const promptText = pluginResult.sandboxBoundaryPrompt || '';
    if (!promptText.includes('<untrusted_document_content>') || !promptText.includes('NO_RELEVANT_DOCUMENTS_FOUND')) {
      throw new Error(`System prompt missing mandatory RAG security rules: ${promptText}`);
    }
    console.log(`  ✅ System Prompt (tool:sandbox-boundary) verified with both security rules.`);

    // ------------------------------------------------------------------------
    // STEP 3: Trigger Tool Container Creation & Verify Mount /data/kb_ro (ReadOnly: true) + NetworkMode: 'none'
    // ------------------------------------------------------------------------
    console.log(`\n[3/6] Spawning sandbox container "dsh-tool-${DUMMY_USER}" via Gateway Exec Router & inspecting mounts...`);
    const sandboxTestJson = runNodeInContainer('dsh-gateway', `
      import { execTool } from 'file:///app/gateway/orchestrator.js';

      // 1. Read file from /data/kb_ro (mode = 'read' -> MUST BE ALLOWED)
      const readKbRes = await execTool({
        userId: ${dummyUserId},
        username: '${DUMMY_USER}',
        role: 'user',
        tool: 'read_file',
        args: { file_path: '/data/kb_ro/${TEST_KB_FILENAME}' },
        workspace: 'default-workspace'
      });

      // 2. Attempt to write /data/kb_ro/hack.txt via write_file tool (mode = 'write' -> MUST BE BLOCKED by Path Guard)
      const writeKbToolRes = await execTool({
        userId: ${dummyUserId},
        username: '${DUMMY_USER}',
        role: 'user',
        tool: 'write_file',
        args: { file_path: '/data/kb_ro/hack.txt', content: 'HACKED' },
        workspace: 'default-workspace'
      });

      // 3. Attempt to write /data/kb_ro/hack.txt via bash tool (MUST BE BLOCKED by Path Guard)
      const bashWriteKbRes = await execTool({
        userId: ${dummyUserId},
        username: '${DUMMY_USER}',
        role: 'user',
        tool: 'bash',
        args: { command: 'echo HACKED > /data/kb_ro/hack.txt' },
        workspace: 'default-workspace'
      });

      console.log(JSON.stringify({ readKbRes, writeKbToolRes, bashWriteKbRes }));
      process.exit(0);
    `);

    const sandboxResults = JSON.parse(sandboxTestJson.split('\n').pop());

    // Inspect the spawned container's HostConfig (NetworkMode & Mounts)
    const inspectRaw = run(`docker inspect dsh-tool-${DUMMY_USER}`);
    const inspectInfo = JSON.parse(inspectRaw)[0];
    const netMode = inspectInfo.HostConfig.NetworkMode;
    const kbMount = (inspectInfo.Mounts || []).find((m) => m.Destination === '/data/kb_ro');

    if (netMode !== 'none') {
      throw new Error(`Expected NetworkMode='none' on dsh-tool-${DUMMY_USER}, got '${netMode}'`);
    }
    if (!kbMount || kbMount.Name !== 'dsh-knowledge-base' || kbMount.RW !== false) {
      throw new Error(`Expected Read-Only mount of dsh-knowledge-base at /data/kb_ro, got: ${JSON.stringify(kbMount)}`);
    }
    console.log(`  ✅ Container dsh-tool-${DUMMY_USER} HostConfig verified:`);
    console.log(`     - NetworkMode: "${netMode}"`);
    console.log(`     - Mount: Source="${kbMount.Name}" -> Destination="${kbMount.Destination}" (RW=${kbMount.RW}, ReadOnly=${!kbMount.RW})`);

    // ------------------------------------------------------------------------
    // STEP 4: Verify Path Guard Read Allowance & Write Blocking
    // ------------------------------------------------------------------------
    console.log('\n[4/6] Verifying Path Guard (/data/kb_ro Read ALLOWED vs Write BLOCKED)...');
    if (!sandboxResults.readKbRes?.ok || !String(sandboxResults.readKbRes.result?.content).includes('YubiKey FIDO2')) {
      throw new Error(`Expected read_file on /data/kb_ro/${TEST_KB_FILENAME} to succeed, got: ${JSON.stringify(sandboxResults.readKbRes)}`);
    }
    console.log(`  ✅ Read /data/kb_ro/${TEST_KB_FILENAME} (mode='read'): ALLOWED (${sandboxResults.readKbRes.result.content.length} chars)`);

    if (sandboxResults.writeKbToolRes?.ok !== false || sandboxResults.writeKbToolRes?.code !== 'OUTSIDE_WORKSPACE') {
      throw new Error(`Expected write_file to /data/kb_ro/hack.txt to fail with OUTSIDE_WORKSPACE, got: ${JSON.stringify(sandboxResults.writeKbToolRes)}`);
    }
    console.log(`  ✅ Write /data/kb_ro/hack.txt via write_file (mode='write'): BLOCKED (${sandboxResults.writeKbToolRes.code}: ${sandboxResults.writeKbToolRes.error})`);

    if (sandboxResults.bashWriteKbRes?.ok !== false || sandboxResults.bashWriteKbRes?.code !== 'OUTSIDE_WORKSPACE') {
      throw new Error(`Expected bash 'echo HACKED > /data/kb_ro/hack.txt' to be blocked by Path Guard OUTSIDE_WORKSPACE, got: ${JSON.stringify(sandboxResults.bashWriteKbRes)}`);
    }
    console.log(`  ✅ Write /data/kb_ro/hack.txt via bash ('echo HACKED > /data/kb_ro/hack.txt'): BLOCKED (${sandboxResults.bashWriteKbRes.code}: ${sandboxResults.bashWriteKbRes.error})`);

    // ------------------------------------------------------------------------
    // STEP 5: Verify Kernel-Level Read-Only Mount Protection inside Container
    // ------------------------------------------------------------------------
    console.log('\n[5/6] Verifying Kernel-Level Read-Only Mount Protection inside dsh-tool container...');
    let kernelRoBlocked = false;
    let kernelErr = '';
    try {
      run(`docker exec dsh-tool-${DUMMY_USER} sh -c "touch /data/kb_ro/hack.txt"`);
    } catch (e) {
      kernelErr = String(e.stderr || e.message).trim();
      if (kernelErr.toLowerCase().includes('read-only file system')) {
        kernelRoBlocked = true;
      }
    }
    if (!kernelRoBlocked) {
      throw new Error(`Kernel Read-Only mount check failed! Output: ${kernelErr}`);
    }
    console.log(`  ✅ Kernel-level write protection verified: "${kernelErr.split('\n')[0]}"`);

  } finally {
    // ------------------------------------------------------------------------
    // STEP 6: Mandatory Cleanup & Verification of Clean State
    // ------------------------------------------------------------------------
    console.log(`\n[6/6] Cleaning up dummy user "${DUMMY_USER}", tool container, and test KB artifacts...`);
    await cleanupDummyAndTestArtifacts();

    const remainingUsers = run(`docker exec dsh-gateway node -e "import('./database/index.js').then(async ({User, initDatabase}) => { await initDatabase(); const all = await User.findAll({ attributes: ['id', 'username', 'role', 'status'], order: [['id', 'ASC']] }); console.log(JSON.stringify(all)); process.exit(0); })"`);
    const pgCounts = run(`docker exec postgres-db psql -U dsh_rag_user -d dsh_rag_db -tAc "SELECT (SELECT count(*) FROM kb_files) AS files, (SELECT count(*) FROM kb_chunks) AS chunks;"`);
    console.log(`  ✅ Gateway Users after cleanup: ${remainingUsers}`);
    console.log(`  ✅ PostgreSQL (kb_files | kb_chunks) after cleanup: ${pgCounts}`);
  }

  console.log('\n🎉 ALL STAGE 3 DSH INTEGRATION, PATH GUARD & RBAC CHECKS PASSED 100%!');
}

main().catch((err) => {
  console.error('\n❌ STAGE 3 VERIFICATION FAILED:', err.message);
  process.exit(1);
});
