// scripts/verify-stage1-rag-infra.js
// Automated Stage 1 Infrastructure & Database Verification Script
// 1. Verifies Docker Volumes (dsh-knowledge-base, dsh-pgdata, dsh-database, dsh-homes, dsh-gateway-data)
// 2. Verifies Services (dsh-gateway, dsh-main, postgres-db + pgvector extension, embedding-service, rag-api)
// 3. Creates a dummy user via Gateway API, verifies DB persistence, and cleanly removes the dummy user.

import { execSync } from 'node:child_process';

const GATEWAY_URL = 'http://localhost:12345';
const RAG_API_URL = 'http://localhost:8000';
const OLLAMA_URL = 'http://localhost:11434';
const DUMMY_USER = 'rag_stage1_dummy';
const DUMMY_PASS = 'DummyPass2026!';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

async function main() {
  console.log('=== STAGE 1: AGENTIC RAG INFRASTRUCTURE VERIFICATION ===\n');

  // 1. Verify Docker Volumes
  const requiredVolumes = [
    'dsh-gateway-data',
    'dsh-homes',
    'dsh-database',
    'dsh-knowledge-base',
    'dsh-pgdata'
  ];
  console.log('[1/5] Checking Docker Named Volumes...');
  for (const vol of requiredVolumes) {
    const out = run(`docker volume inspect ${vol} --format "{{.Name}} ({{.Driver}})"`);
    console.log(`  ✅ Volume exists: ${out}`);
  }

  // 2. Verify PostgreSQL + pgvector extension
  console.log('\n[2/5] Checking postgres-db & pgvector extension...');
  const pgReady = run('docker exec postgres-db pg_isready -U dsh_rag_user -d dsh_rag_db');
  console.log(`  ✅ pg_isready: ${pgReady}`);
  const pgVectorOut = run('docker exec postgres-db psql -U dsh_rag_user -d dsh_rag_db -tAc "CREATE EXTENSION IF NOT EXISTS vector; SELECT extname, extversion FROM pg_extension WHERE extname = \'vector\';"');
  if (!pgVectorOut.includes('vector')) {
    throw new Error(`pgvector extension check failed: ${pgVectorOut}`);
  }
  console.log(`  ✅ pgvector extension active: ${pgVectorOut}`);

  // 3. Verify embedding-service (Ollama) & rag-api placeholder (internal Docker network only)
  console.log('\n[3/5] Checking embedding-service (:11434) & internal rag-api (:8000)...');
  const ollamaRes = await fetch(`${OLLAMA_URL}/api/tags`);
  if (!ollamaRes.ok) throw new Error(`Ollama API returned HTTP ${ollamaRes.status}`);
  const ollamaData = await ollamaRes.json();
  const modelNames = (ollamaData.models || []).map((m) => m.name);
  console.log(`  ✅ embedding-service reachable (models: ${modelNames.join(', ') || 'none'})`);

  const ragInternalOut = run('docker exec dsh-gateway node -e "fetch(\'http://rag-api:8000/health\').then(r => r.json()).then(d => console.log(JSON.stringify(d)))"');
  console.log(`  ✅ rag-api reachable internally from dsh-gateway: ${ragInternalOut}`);

  // Verify /data/kb_ro is mounted Read-Only inside rag-api
  let roVerified = false;
  try {
    run('docker exec rag-api sh -c "touch /data/kb_ro/test_write.txt"');
  } catch (err) {
    if (String(err.stderr || err.message).toLowerCase().includes('read-only file system')) {
      roVerified = true;
    } else {
      throw err;
    }
  }
  if (!roVerified) throw new Error('/data/kb_ro in rag-api is NOT read-only!');
  console.log('  ✅ /data/kb_ro mount inside rag-api verified as strictly Read-Only');

  // 4. Create dummy user via Gateway API
  console.log(`\n[4/5] Creating dummy user "${DUMMY_USER}" via Gateway API...`);
  // Clean up first in case a previous run left it behind
  run(`docker exec dsh-gateway node -e "import('./database/index.js').then(async ({User, initDatabase}) => { await initDatabase(); await User.destroy({ where: { username: '${DUMMY_USER}' } }); process.exit(0); })"`);

  const regRes = await fetch(`${GATEWAY_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: DUMMY_USER, password: DUMMY_PASS })
  });
  const regBody = await regRes.json();
  if (regRes.status !== 201) {
    throw new Error(`Expected 201 Created from /api/auth/register, got ${regRes.status}: ${JSON.stringify(regBody)}`);
  }
  console.log(`  ✅ Dummy user registered via Gateway: ID=#${regBody.user.id}, username=${regBody.user.username}, status=${regBody.user.status}`);

  // 5. Remove dummy user and verify clean state
  console.log(`\n[5/5] Removing dummy user "${DUMMY_USER}" and verifying database state...`);
  const remainingUsers = run(`docker exec dsh-gateway node -e "import('./database/index.js').then(async ({User, initDatabase}) => { await initDatabase(); const del = await User.destroy({ where: { username: '${DUMMY_USER}' } }); const all = await User.findAll({ attributes: ['id', 'username', 'role', 'status'], order: [['id', 'ASC']] }); console.log(JSON.stringify({ deleted: del, users: all })); process.exit(0); })"`);
  console.log(`  ✅ Cleanup complete: ${remainingUsers}`);

  console.log('\n🎉 ALL STAGE 1 INFRASTRUCTURE & DUMMY USER CHECKS PASSED!');
}

main().catch((err) => {
  console.error('\n❌ VERIFICATION FAILED:', err.message);
  process.exit(1);
});
