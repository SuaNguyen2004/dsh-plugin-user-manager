// test/step3-base-image-test.js
// Automated verification script for Step 3: Base Image (Container Lõi)

import { execSync } from 'child_process';
import http from 'http';

function runCmd(cmd) {
  try {
    return execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' });
  } catch (err) {
    return (err.stdout || '') + (err.stderr || '') + (err.message || '');
  }
}

function httpGet(url, headers = {}, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.get({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        data
      }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Timeout'));
    });
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passCount++;
  } else {
    console.error(`[FAIL] ${message}`);
    failCount++;
  }
}

async function runStep3Test() {
  console.log('=== Step 3: Testing dsh-user-base-image ===\n');

  const containerName = 'dsh-test-sandbox';
  const testPort = 3095;

  // 1. Check docker image exists
  console.log('1. Checking image existence...');
  const images = runCmd('docker images dsh-user-base-image:latest --format "{{.Repository}}:{{.Tag}}"');
  assert(images.includes('dsh-user-base-image:latest'), 'Image dsh-user-base-image:latest exists');

  // 2. Clean previous test container if any
  runCmd(`docker rm -f ${containerName}`);

  // 3. Start test container
  console.log('\n2. Starting test container with resource limits & user env...');
  const runOutput = runCmd(
    `docker run -d --name ${containerName} -p ${testPort}:3090 -e DSH_USER_NAME=test_user_alice -e DSH_PORT=3090 --memory=256m --cpus=0.5 dsh-user-base-image:latest`
  );
  assert(runOutput.trim().length >= 12, `Container started with ID: ${runOutput.trim().slice(0, 12)}`);

  // 4. Inspect container specs
  console.log('\n3. Verifying hardware isolation limits (256MB RAM, 0.5 CPU)...');
  const inspectJson = runCmd(`docker inspect ${containerName}`);
  try {
    const inspectData = JSON.parse(inspectJson)[0];
    const memoryLimit = inspectData.HostConfig.Memory;
    const nanoCpus = inspectData.HostConfig.NanoCpus;
    assert(memoryLimit === 256 * 1024 * 1024, `Memory limit is exactly 256MB (${memoryLimit} bytes)`);
    assert(nanoCpus === 500000000, `CPU limit is exactly 0.5 CPU (${nanoCpus} nanoCPUs)`);
  } catch (e) {
    assert(false, `Failed to inspect container config: ${e.message}`);
  }

  // 5. Wait for DSH web server to start & capture launch token
  console.log('\n4. Waiting for DSH container startup and extracting launch token...');
  let launchToken = null;
  let ready = false;
  const startTime = Date.now();

  for (let attempt = 1; attempt <= 20; attempt++) {
    await sleep(1500);
    const logs = runCmd(`docker logs ${containerName}`);
    const tokenMatch = logs.match(/token=([a-zA-Z0-9_\-]+)/);
    if (tokenMatch) {
      launchToken = tokenMatch[1];
      ready = true;
      console.log(`DSH Server ready in ${((Date.now() - startTime) / 1000).toFixed(1)}s (launch token: ${launchToken.slice(0, 8)}...)`);
      break;
    }
  }

  assert(ready && !!launchToken, 'Container successfully printed launch URL with security token');

  // 6. Test Security: Unauthenticated request should be 401 Unauthorized
  console.log('\n5. Testing Security Boundary...');
  try {
    const unauthRes = await httpGet(`http://127.0.0.1:${testPort}/`);
    assert(unauthRes.statusCode === 401, `Unauthenticated request correctly rejected with HTTP 401 (${unauthRes.statusCode})`);
  } catch (e) {
    assert(false, `Unauthenticated check error: ${e.message}`);
  }

  // 7. Test Authentication handshake with launch token
  console.log('\n6. Authenticating via launch token...');
  let sessionCookie = '';
  try {
    const authRes = await httpGet(`http://127.0.0.1:${testPort}/?token=${launchToken}`);
    assert(
      authRes.statusCode === 303 || authRes.statusCode === 302 || authRes.statusCode === 200,
      `Token handshake redirected / accepted with HTTP ${authRes.statusCode}`
    );
    
    if (authRes.headers['set-cookie']) {
      const rawCookies = authRes.headers['set-cookie'];
      sessionCookie = Array.isArray(rawCookies) ? rawCookies.map(c => c.split(';')[0]).join('; ') : rawCookies.split(';')[0];
      assert(sessionCookie.length > 0, `Received session cookie from DSH container: ${sessionCookie.slice(0, 20)}...`);
    } else {
      assert(true, 'Direct session authorized');
    }
  } catch (e) {
    assert(false, `Auth token handshake failed: ${e.message}`);
  }

  // 8. Test Authenticated access to DSH Web UI
  console.log('\n7. Verifying authenticated Web UI access...');
  try {
    const uiRes = await httpGet(`http://127.0.0.1:${testPort}/`, sessionCookie ? { Cookie: sessionCookie } : {});
    assert(uiRes.statusCode === 200, `Authenticated request returned HTTP 200 OK`);
    assert(
      uiRes.data.includes('html') || uiRes.data.includes('DeepSeek') || uiRes.data.includes('script'),
      'Web UI response contains HTML / DOM bootstrap elements'
    );
  } catch (e) {
    assert(false, `Authenticated Web UI access failed: ${e.message}`);
  }

  // 9. Verify container logs
  console.log('\n8. Inspecting container logs for sandbox plugin initialization...');
  const logs = runCmd(`docker logs ${containerName}`);
  
  assert(
    logs.includes('dsh-user-plugin') && logs.includes('Sandbox initialized'),
    'Container logs confirm cordis / dsh-user-plugin initialized'
  );
  assert(
    logs.includes('test_user_alice'),
    'Container initialized sandbox with DSH_USER_NAME=test_user_alice'
  );

  // 10. Verify workspace inside container
  console.log('\n9. Checking inside container environment...');
  const execLs = runCmd(`docker exec ${containerName} ls -ld /data/workspace`);
  assert(execLs.includes('/data/workspace'), '/data/workspace directory exists inside container');

  const execWhoami = runCmd(`docker exec ${containerName} whoami`);
  assert(execWhoami.trim() === 'node', `Container runs as unprivileged user: ${execWhoami.trim()}`);

  // 11. Clean up test container
  console.log('\n10. Cleaning up test container...');
  runCmd(`docker rm -f ${containerName}`);
  const checkRemoved = runCmd(`docker ps -a -q -f name=${containerName}`);
  assert(!checkRemoved.trim(), 'Test container cleaned up successfully');

  console.log(`\n========================================`);
  console.log(`TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log(`========================================`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runStep3Test().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

