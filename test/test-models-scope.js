import { execSync } from 'child_process';

async function run() {
  console.log('--- 1. Login Admin ---');
  const adminLogin = await fetch('http://127.0.0.1:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'AdminPassword123!' })
  });
  const adminData = await adminLogin.json();
  console.log('Admin login status:', adminLogin.status, 'Container:', adminData.container?.name);

  console.log('\n--- 2. Fetch Models from Dashboard API ---');
  const modelsRes = await fetch('http://127.0.0.1:4000/api/admin/models', {
    headers: { 'Authorization': 'Bearer ' + adminData.token }
  });
  const modelsData = await modelsRes.json();
  console.log('Total models:', modelsData.total);
  for (const m of modelsData.models) {
    console.log(`  * [${m.provider}] ${m.name} (${m.id}) | Scope: ${m.scope} | Key: ${m.maskedKey}`);
  }

  console.log('\n--- 3. Toggle Scope of Model 0 to admin_only ---');
  const targetModelId = modelsData.models[0].id;
  const scopeRes = await fetch('http://127.0.0.1:4000/api/admin/models/' + encodeURIComponent(targetModelId) + '/scope', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminData.token },
    body: JSON.stringify({ scope: 'admin_only' })
  });
  const scopeData = await scopeRes.json();
  console.log(`Updated model "${targetModelId}" scope:`, scopeData.model?.scope);

  console.log('\n--- 4. Login Alice (regular user) ---');
  const aliceLogin = await fetch('http://127.0.0.1:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'AlicePassword123!' })
  });
  const aliceData = await aliceLogin.json();
  console.log('Alice login status:', aliceLogin.status, 'Container:', aliceData.container?.name);

  console.log('\n--- 5. Verify Alice Container Models ---');
  const alicePatch = execSync('docker exec dsh-user-2-alice cat /data/dsh_home/profiles/web/cordis.patch.yml', { encoding: 'utf-8' });
  const hasAdminOnly = alicePatch.includes(targetModelId);
  const otherModel = modelsData.models[1].id;
  const hasAllUsers = alicePatch.includes(otherModel);

  console.log(`  * Model "${targetModelId}" (admin_only) in Alice container? ${hasAdminOnly} (Expected: false)`);
  console.log(`  * Model "${otherModel}" (all_users) in Alice container? ${hasAllUsers} (Expected: true)`);

  if (!hasAdminOnly && hasAllUsers) {
    console.log('\n✅ VERIFICATION SUCCESSFUL: Scope management and model isolation work perfectly!');
  } else {
    console.error('\n❌ VERIFICATION FAILED: Model scope not matching expectations');
  }

  process.exit(0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

