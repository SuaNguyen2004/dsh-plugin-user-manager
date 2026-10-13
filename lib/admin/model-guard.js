import fs from 'node:fs';
import path from 'node:path';
import { authenticateRequest, parseJsonBody, sendJson } from '../common/auth.js';
import { keyPool } from './key-pool.js';

let activeAdminScopes = 0;

/**
 * Execute a callback within an authorized Admin privilege scope
 */
export function runWithAdminPrivileges(fn) {
  activeAdminScopes++;
  try {
    return fn();
  } finally {
    activeAdminScopes = Math.max(0, activeAdminScopes - 1);
  }
}

/**
 * Check if the current execution is within an authorized Admin scope
 */
export function isAuthorizedAdmin() {
  return activeAdminScopes > 0;
}

/**
 * Resolve the path to .credentials.yaml and cordis.patch.yml
 */
export function getDshPaths() {
  const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || 'C:\\Users\\Admin', '.dsh-multiuser');
  const credentialsFile = path.join(dshHome, '.credentials.yaml');
  const patchFile = path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml');
  return { dshHome, credentialsFile, patchFile };
}

/**
 * Mask an API key for safe display (e.g. "sk-or-v1-••••••••49f2")
 */
export function maskApiKey(key) {
  if (!key || typeof key !== 'string') return null;
  if (key.length <= 8) return '••••••••';
  const head = key.slice(0, 8);
  const tail = key.slice(-4);
  return `${head}••••••••${tail}`;
}

/**
 * Read the current credentials from .credentials.yaml (zero dependency)
 */
export function readCredentialsYaml() {
  const { credentialsFile } = getDshPaths();
  const refs = new Map();
  if (!fs.existsSync(credentialsFile)) {
    return { refs, raw: '' };
  }
  try {
    const text = fs.readFileSync(credentialsFile, 'utf8');
    const lines = text.split(/\r?\n/);
    let inRefs = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const indent = line.search(/\S/);

      if (indent === 0) {
        inRefs = trimmed.startsWith('refs:');
        continue;
      }

      if (inRefs && indent >= 2) {
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          const key = trimmed.slice(0, colonIdx).trim();
          let val = trimmed.slice(colonIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          refs.set(key, val);
        }
      }
    }
    return { refs, raw: text };
  } catch (e) {
    console.error('[dsh-plugin-user-manager] Error reading .credentials.yaml:', e.message);
    return { refs, raw: '' };
  }
}

/**
 * Save or delete a credential ref in .credentials.yaml (zero dependency)
 */
export function writeCredentialYaml(ref, value) {
  const { credentialsFile } = getDshPaths();
  let text = '';
  if (fs.existsSync(credentialsFile)) {
    text = fs.readFileSync(credentialsFile, 'utf8');
  } else {
    text = 'version: 1\nrecords: {}\nrefs:\n';
  }

  const lines = text.split(/\r?\n/);
  let refsLineIdx = -1;
  let nextSectionIdx = -1;
  let targetKeyIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.search(/\S/);

    if (indent === 0 && trimmed.startsWith('refs:')) {
      refsLineIdx = i;
      continue;
    }

    if (refsLineIdx !== -1) {
      if (indent === 0 && trimmed.length > 0) {
        nextSectionIdx = i;
        break;
      }
      if (indent >= 2) {
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          const key = trimmed.slice(0, colonIdx).trim();
          if (key === ref) {
            targetKeyIdx = i;
          }
        }
      }
    }
  }

  const hasValue = value !== undefined && value !== null && String(value).trim() !== '';
  const formattedVal = hasValue ? String(value).trim() : '';

  if (refsLineIdx === -1) {
    if (hasValue) {
      lines.push('refs:');
      lines.push(`  ${ref}: ${formattedVal}`);
    }
  } else if (targetKeyIdx !== -1) {
    if (hasValue) {
      lines[targetKeyIdx] = `  ${ref}: ${formattedVal}`;
    } else {
      lines.splice(targetKeyIdx, 1);
    }
  } else {
    if (hasValue) {
      const insertAt = nextSectionIdx !== -1 ? nextSectionIdx : lines.length;
      lines.splice(insertAt, 0, `  ${ref}: ${formattedVal}`);
    }
  }

  fs.writeFileSync(credentialsFile, lines.join('\n'), 'utf8');
}

/**
 * Read configured providers and models from cordis.patch.yml (zero dependency)
 */
export function readProvidersFromPatch() {
  const { patchFile } = getDshPaths();
  if (!fs.existsSync(patchFile)) return [];

  try {
    const text = fs.readFileSync(patchFile, 'utf8');
    const lines = text.split(/\r?\n/);
    let inLlm = false;
    let inProviders = false;
    let currentProvider = null;
    let inModels = false;
    let currentModel = null;
    const providers = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const indent = line.search(/\S/);

      if (indent === 0 && trimmed.startsWith('- id:')) {
        inLlm = trimmed.includes('llm-pi-ai');
        inProviders = false;
        continue;
      }

      if (!inLlm) continue;

      if (indent === 4 && trimmed === 'providers:') {
        inProviders = true;
        continue;
      }

      if (!inProviders) continue;

      if (indent === 6 && trimmed.endsWith(':')) {
        const pid = trimmed.slice(0, -1);
        currentProvider = {
          id: pid,
          displayName: pid,
          apiKeyEnv: pid.toUpperCase() + '_API_KEY',
          api: 'native',
          baseURL: null,
          models: []
        };
        providers.push(currentProvider);
        inModels = false;
        currentModel = null;
        continue;
      }

      if (currentProvider && indent === 8) {
        if (trimmed === 'models:') {
          inModels = true;
          continue;
        }
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          const key = trimmed.slice(0, colonIdx).trim();
          let val = trimmed.slice(colonIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (key === 'displayName') currentProvider.displayName = val;
          if (key === 'apiKeyEnv') currentProvider.apiKeyEnv = val;
          if (key === 'baseURL') currentProvider.baseURL = val;
          if (key === 'api') currentProvider.api = val;
        }
        inModels = false;
        continue;
      }

      if (inModels && currentProvider) {
        if (indent === 10 && trimmed.startsWith('- id:')) {
          let idVal = trimmed.replace(/^- id:\s*/, '').trim();
          if ((idVal.startsWith('"') && idVal.endsWith('"')) || (idVal.startsWith("'") && idVal.endsWith("'"))) {
            idVal = idVal.slice(1, -1);
          }
          currentModel = { id: idVal, name: idVal };
          currentProvider.models.push(currentModel);
        } else if (indent >= 12 && currentModel) {
          const colonIdx = trimmed.indexOf(':');
          if (colonIdx > 0) {
            const key = trimmed.slice(0, colonIdx).trim();
            let val = trimmed.slice(colonIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (key === 'name') currentModel.name = val;
            if (key === 'contextWindow') currentModel.contextWindow = Number(val);
            if (key === 'maxTokens') currentModel.maxTokens = Number(val);
          }
        }
      }
    }

    const { refs } = readCredentialsYaml();
    for (const p of providers) {
      const rawKey = refs.get(p.apiKeyEnv);
      if (rawKey) {
        keyPool.seedFromCredentials(p.apiKeyEnv, rawKey);
      }
      const summary = keyPool.getPoolSummary(p.apiKeyEnv);
      p.isConfigured = summary.total > 0;
      p.maskedKey = summary.total > 0 ? (summary.keys[0]?.masked || null) : null;
      p.poolSummary = summary;
    }

    return providers;
  } catch (e) {
    console.error('[dsh-plugin-user-manager] Error reading cordis.patch.yml:', e.message);
    return [];
  }
}

/**
 * Safely obtain credentials service without triggering Cordis un-injected property proxy error
 */
function getCredentialsService(ctx) {
  if (!ctx) return null;
  if (typeof ctx.get === 'function') {
    try {
      return ctx.get('credentials', false);
    } catch (_) {
      return null;
    }
  }
  try {
    return ctx.credentials || null;
  } catch (_) {
    return null;
  }
}

/**
 * Setup backend security guard on ctx.credentials and ctx.settings
 */
export function setupModelCredentialsGuard(ctx) {
  if (!ctx) return;

  const hookCredentials = (credentials) => {
    if (!credentials || credentials.__dshModelGuardInstalled) return;
    credentials.__dshModelGuardInstalled = true;

    const originalSet = credentials.set?.bind(credentials);
    const originalUnset = credentials.unset?.bind(credentials);
    const originalResolve = credentials.resolve?.bind(credentials);

    if (originalSet) {
      credentials.set = async function(ref, value) {
        if (!isAuthorizedAdmin()) {
          console.warn(`[dsh-plugin-user-manager] BLOCKED unauthorized attempt to update credential "${ref}"`);
          throw new Error('Forbidden: Chỉ Quản trị viên (Admin) mới có quyền thêm hoặc cập nhật API Key và cấu hình Model.');
        }
        return originalSet(ref, value);
      };
    }

    if (originalUnset) {
      credentials.unset = async function(ref) {
        if (!isAuthorizedAdmin()) {
          console.warn(`[dsh-plugin-user-manager] BLOCKED unauthorized attempt to delete credential "${ref}"`);
          throw new Error('Forbidden: Chỉ Quản trị viên (Admin) mới có quyền xóa cấu hình Model hoặc API Key.');
        }
        return originalUnset(ref);
      };
    }

    if (originalResolve) {
      credentials.resolve = async function(ref) {
        const pooledKey = keyPool.getActiveKey(ref);
        if (pooledKey) {
          return { value: pooledKey, source: 'key-pool' };
        }
        return originalResolve(ref);
      };
    }

    console.log('[dsh-plugin-user-manager] Model & Credentials Guard successfully attached to ctx.credentials.');
  };

  const initialCredentials = getCredentialsService(ctx);
  if (initialCredentials) {
    hookCredentials(initialCredentials);
  }

  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['credentials'], (innerCtx) => {
        const innerCreds = getCredentialsService(innerCtx);
        if (innerCreds) hookCredentials(innerCreds);
      });
    } catch (_) {}
  }

  // Hook into DSH agent loop waterfall for 429 Rate Limit recovery
  if (typeof ctx.on === 'function') {
    ctx.on('agent/request-error', async (payload, next) => {
      const { provider, failure } = payload || {};
      const is429 = failure && (
        failure.code === 'RATE_LIMIT' ||
        failure.code === 'QUOTA_EXCEEDED' ||
        /\b429\b|rate.?limit|quota.?exceeded|resource.?exhausted|too.?many.?requests/i.test(failure.message || '')
      );

      if (is429 && provider) {
        const providers = readProvidersFromPatch();
        const found = providers.find(p => p.id === provider || p.name === provider);
        const apiKeyEnv = found?.apiKeyEnv;

        if (apiKeyEnv) {
          const retryAfterMs = (failure.providerRetryAfterMs && failure.providerRetryAfterMs > 0)
            ? failure.providerRetryAfterMs
            : 60000;

          const rotation = keyPool.markKey429(apiKeyEnv, null, retryAfterMs);

          if (rotation.rotated && rotation.nextKey) {
            console.warn(`[dsh-plugin-user-manager] 🔄 RATE LIMIT (429) detected for provider "${provider}". Automatically rotated to next healthy key in pool (${rotation.availableCount}/${rotation.totalCount} active). Retrying step immediately...`);
            
            // Sync to credentials.yaml so any direct readers pick up current key
            try {
              writeCredentialYaml(apiKeyEnv, rotation.nextKey);
            } catch (_) {}

            return { kind: 'retry' };
          } else {
            console.warn(`[dsh-plugin-user-manager] ⚠️ All ${rotation.totalCount} keys for provider "${provider}" are currently in cooldown (${Math.ceil(retryAfterMs / 1000)}s).`);
          }
        }
      }

      return next();
    });
  }
}

/**
 * Register Admin REST routes for managing models and API keys
 */
export function registerModelManagementRoutes(webServer, ctx) {
  // 1. GET /api/admin/models/config
  webServer.register({
    kind: 'exact',
    path: '/api/admin/models/config',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      const session = authenticateRequest(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Unauthorized: Vui lòng đăng nhập' });
      }

      if (session.role !== 'admin') {
        return sendJson(res, 403, { error: 'Forbidden: Yêu cầu quyền Quản trị viên (Admin)' });
      }

      try {
        const providers = readProvidersFromPatch();
        return sendJson(res, 200, {
          success: true,
          providers,
          sharedMode: true,
          managedByAdmin: true
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  });

  // 2. POST /api/admin/models/key
  webServer.register({
    kind: 'exact',
    path: '/api/admin/models/key',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      const session = authenticateRequest(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Unauthorized: Vui lòng đăng nhập' });
      }

      if (session.role !== 'admin') {
        return sendJson(res, 403, { error: 'Forbidden: Chỉ Quản trị viên mới được cấu hình API Key.' });
      }

      try {
        const body = await parseJsonBody(req);
        const { ref, value } = body;

        if (!ref || typeof ref !== 'string') {
          return sendJson(res, 400, { error: 'Trường "ref" là bắt buộc (ví dụ: GEMINI_API_KEY)' });
        }

        if (!value || typeof value !== 'string') {
          return sendJson(res, 400, { error: 'Trường "value" là bắt buộc và phải là chuỗi ký tự API key' });
        }

        // Update Key Pool (supports multiple keys split by newline or comma)
        const newPool = keyPool.setKeys(ref, value);
        const primaryKey = keyPool.getActiveKey(ref) || (newPool[0]?.key || '');

        // Execute write in authorized admin scope
        await runWithAdminPrivileges(async () => {
          const creds = getCredentialsService(ctx);
          if (creds && typeof creds.set === 'function') {
            await creds.set(ref, primaryKey);
          } else {
            writeCredentialYaml(ref, primaryKey);
          }
        });

        console.log(`[dsh-plugin-user-manager] Admin "${session.username}" successfully updated API Key pool for "${ref}" (${newPool.length} keys).`);
        return sendJson(res, 200, {
          success: true,
          message: `Đã cập nhật ${newPool.length} API Key cho "${ref}" thành công!`,
          ref,
          maskedKey: maskApiKey(primaryKey),
          poolSummary: keyPool.getPoolSummary(ref)
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  });

  // 3. POST /api/admin/models/delete-key
  webServer.register({
    kind: 'exact',
    path: '/api/admin/models/delete-key',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      const session = authenticateRequest(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Unauthorized: Vui lòng đăng nhập' });
      }

      if (session.role !== 'admin') {
        return sendJson(res, 403, { error: 'Forbidden: Chỉ Quản trị viên mới được xóa API Key.' });
      }

      try {
        const body = await parseJsonBody(req);
        const { ref } = body;

        if (!ref || typeof ref !== 'string') {
          return sendJson(res, 400, { error: 'Trường "ref" là bắt buộc.' });
        }

        // Clear key pool
        keyPool.setKeys(ref, []);

        await runWithAdminPrivileges(async () => {
          const creds = getCredentialsService(ctx);
          if (creds && typeof creds.unset === 'function') {
            await creds.unset(ref);
          } else {
            writeCredentialYaml(ref, '');
          }
        });

        console.log(`[dsh-plugin-user-manager] Admin "${session.username}" removed API Key for "${ref}".`);
        return sendJson(res, 200, {
          success: true,
          message: `Đã gỡ bỏ API Key cho "${ref}".`,
          poolSummary: keyPool.getPoolSummary(ref)
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  });

  // 4. POST /api/admin/models/reset-cooldown
  webServer.register({
    kind: 'exact',
    path: '/api/admin/models/reset-cooldown',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      const session = authenticateRequest(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Unauthorized: Vui lòng đăng nhập' });
      }

      if (session.role !== 'admin') {
        return sendJson(res, 403, { error: 'Forbidden: Chỉ Quản trị viên mới được thao tác.' });
      }

      try {
        const body = await parseJsonBody(req).catch(() => ({}));
        keyPool.resetCooldown(body.ref || null);
        console.log(`[dsh-plugin-user-manager] Admin "${session.username}" reset cooldown for ${body.ref || 'all providers'}.`);
        return sendJson(res, 200, {
          success: true,
          message: 'Đã hoàn tất thiết lập lại trạng thái (reset cooldown) cho API keys!',
          poolSummary: body.ref ? keyPool.getPoolSummary(body.ref) : null
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  });

  console.log('[dsh-plugin-user-manager] Admin Model & API Key routes registered (/api/admin/models/*).');
}

