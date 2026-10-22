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
