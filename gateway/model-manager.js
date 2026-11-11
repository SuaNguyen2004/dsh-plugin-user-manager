// gateway/model-manager.js
// Centralized AI Model & API Key Scope Management for DSH Lite Enterprise.
// All state lives inside the gateway volume (/data/gateway, derived from SQLITE_PATH) —
// NEVER touches the host `data/` directory (acceptance #11).

import fs from 'node:fs';
import path from 'node:path';
import { load, dump } from 'js-yaml';

function gatewayDataDir() {
  return path.dirname(process.env.SQLITE_PATH || '/data/gateway/users.db');
}

export function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 8)}••••••••${key.slice(-4)}`;
}

export function ensureNodeOwnership(targetPath) {
  try {
    if (!fs.existsSync(targetPath)) return;
    if (typeof fs.chownSync === 'function') {
      try { fs.chownSync(targetPath, 1000, 1000); } catch {}
    }
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      try { fs.chmodSync(targetPath, 0o777); } catch {}
      const entries = fs.readdirSync(targetPath);
      for (const entry of entries) {
        ensureNodeOwnership(path.join(targetPath, entry));
      }
    } else {
      try { fs.chmodSync(targetPath, 0o666); } catch {}
    }
  } catch {}
}

export class ModelManager {
  constructor() {
    this.scopes = {};
    this.models = {};
    this._loaded = false;
  }

  get scopesFile() {
    return process.env.DSH_MODELS_SCOPES_FILE || path.join(gatewayDataDir(), 'models_scope.json');
  }

  get modelsFile() {
    return process.env.DSH_MODELS_CATALOG_FILE || path.join(gatewayDataDir(), 'models_catalog.json');
  }

  get userHomesDir() {
    return process.env.DSH_USER_HOMES_DIR || '/data/dsh_homes';
  }

  get adminDshHome() {
    if (process.env.DSH_ADMIN_HOME_DIR) return process.env.DSH_ADMIN_HOME_DIR;
    const candidate1 = path.join(this.userHomesDir, 'user-1-admin');
    if (fs.existsSync(candidate1)) return candidate1;
    const candidate2 = path.join(this.userHomesDir, 'admin');
    if (fs.existsSync(candidate2)) return candidate2;
    return path.join(gatewayDataDir(), 'admin_dsh_home');
  }

  loadScopes() {
    try {
      if (fs.existsSync(this.scopesFile)) {
        this.scopes = JSON.parse(fs.readFileSync(this.scopesFile, 'utf8'));
      } else {
        this.scopes = {};
      }
      if (fs.existsSync(this.modelsFile)) {
        this.models = JSON.parse(fs.readFileSync(this.modelsFile, 'utf8'));
      } else {
        this.models = {};
      }
      this._loaded = true;
    } catch (e) {
      console.error('[ModelManager] Error loading scopes/models file:', e.message);
      this.scopes = {};
      this.models = {};
    }
  }

  saveScopes() {
    try {
      const dir = path.dirname(this.scopesFile);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.scopesFile, JSON.stringify(this.scopes, null, 2), 'utf8');
      fs.writeFileSync(this.modelsFile, JSON.stringify(this.models, null, 2), 'utf8');
    } catch (e) {
      console.error('[ModelManager] Error saving scopes/models file:', e.message);
    }
  }

  getAdminConfig() {
    const patchFile = path.join(this.adminDshHome, 'profiles/web/cordis.patch.yml');
    const credsFile = path.join(this.adminDshHome, '.credentials.yaml');
    let patch = [];
    let creds = { refs: {} };
    if (fs.existsSync(patchFile)) {
      try {
        patch = load(fs.readFileSync(patchFile, 'utf8').replace(/!!js\s+/g, '')) || [];
      } catch (e) {
        console.error('[ModelManager] Error reading Admin cordis.patch.yml:', e.message);
      }
    }
    if (fs.existsSync(credsFile)) {
      try {
        creds = load(fs.readFileSync(credsFile, 'utf8')) || { refs: {} };
      } catch (e) {
        console.error('[ModelManager] Error reading Admin .credentials.yaml:', e.message);
      }
    }
    return { patch, creds, refs: creds?.refs || {} };
  }

  getAllModels() {
    this.loadScopes();
    const { patch, refs } = this.getAdminConfig();
    const llmPlugin = patch.find((p) => p?.id === 'llm-pi-ai');
    const providers = llmPlugin?.config?.providers || {};

    const list = [];
    const seen = new Set();
    let scopeChanged = false;

    for (const [providerId, pData] of Object.entries(providers)) {
      const keyEnv = pData.apiKeyEnv;
      const rawKey = keyEnv ? refs[keyEnv] : '';
      const pModels = Array.isArray(pData.models) ? pData.models : [];

      for (const m of pModels) {
        const modelId = m.id;
        seen.add(modelId);
        if (!this.scopes[modelId]) {
          this.scopes[modelId] = { scope: 'all_users', enabled: true };
          scopeChanged = true;
        }
        const scopeInfo = this.scopes[modelId];
        list.push({
          id: modelId,
          name: m.name || modelId,
          provider: providerId,
          baseURL: pData.baseURL || '',
          apiKeyEnv: keyEnv || '',
          hasKey: Boolean(rawKey),
          maskedKey: rawKey ? maskApiKey(rawKey) : 'Chưa có Key',
          scope: scopeInfo.scope || 'all_users',
          enabled: scopeInfo.enabled !== false,
          contextWindow: m.contextWindow || null,
          maxTokens: m.maxTokens || null
        });
      }
    }

    for (const [modelId, m] of Object.entries(this.models)) {
      if (seen.has(modelId)) continue;
      const scopeInfo = this.scopes[modelId] || { scope: m.scope || 'all_users', enabled: m.enabled !== false };
      list.push({
        id: modelId,
        name: m.name || modelId,
        provider: m.provider || 'custom',
        baseURL: m.baseURL || '',
        apiKeyEnv: m.apiKeyEnv || '',
        hasKey: Boolean(m.apiKey),
        maskedKey: m.apiKey ? maskApiKey(m.apiKey) : 'Chưa có Key',
        scope: scopeInfo.scope || 'all_users',
        enabled: scopeInfo.enabled !== false,
        contextWindow: m.contextWindow || null,
        maxTokens: m.maxTokens || null
      });
    }

    if (scopeChanged) this.saveScopes();
    return list;
  }

  generateUserPatchContent() {
    this.loadScopes();
    const { patch } = this.getAdminConfig();
    const llmPlugin = patch.find((p) => p?.id === 'llm-pi-ai');
    const providers = llmPlugin?.config?.providers || {};

    const userProviders = {};
    const neededKeyEnvs = new Set();
    let firstAllowedModel = null;

    for (const [providerId, pData] of Object.entries(providers)) {
      const pModels = Array.isArray(pData.models) ? pData.models : [];
      const allowedModels = pModels.filter((m) => {
        const s = this.scopes[m.id];
        return s && s.scope === 'all_users' && s.enabled !== false;
      });

      if (allowedModels.length > 0) {
        if (!firstAllowedModel) {
          firstAllowedModel = { provider: providerId, model: allowedModels[0].id };
        }
        userProviders[providerId] = {
          ...pData,
          models: allowedModels
        };
        if (pData.apiKeyEnv) {
          neededKeyEnvs.add(pData.apiKeyEnv);
        }
      }
    }

    for (const [modelId, m] of Object.entries(this.models)) {
      const s = this.scopes[modelId];
      if (s && s.scope === 'all_users' && s.enabled !== false) {
        const provId = m.provider || 'custom';
        if (!userProviders[provId]) {
          userProviders[provId] = {
            baseURL: m.baseURL || '',
            apiKeyEnv: m.apiKeyEnv || '',
            models: []
          };
        }
        userProviders[provId].models.push({
          id: m.id,
          name: m.name || m.id,
          contextWindow: m.contextWindow || undefined,
          maxTokens: m.maxTokens || undefined
        });
        if (m.apiKeyEnv) neededKeyEnvs.add(m.apiKeyEnv);
      }
    }

    let patchYaml = `- id: webserver
  config:
    host: 127.0.0.1
    port: !!js (ctx.webStartup.port ?? 3090)
- id: user-container-plugin
  name: "dsh-user-container-plugin"
  disabled: false
- id: dsh-market
  name: "dshmarket"
  disabled: false
`;

    if (Object.keys(userProviders).length > 0) {
      const llmObj = [
        {
          id: 'llm-pi-ai',
          name: '@deepseek-ai/dsh-llm-pi-ai',
          config: {
            providers: userProviders
          }
        }
      ];
      patchYaml += dump(llmObj) + '\n';
    }

    if (firstAllowedModel) {
      patchYaml += dump([
        {
          id: 'agent-default-model',
          name: '@deepseek-ai/dsh-agent-default-model',
          config: firstAllowedModel
        }
      ]) + '\n';
    }

    patchYaml += `- id: tool-fs
  disabled: true
- id: tool-fs-search
  disabled: true
- id: tool-bash
  disabled: true
- id: tool-pwsh
  disabled: true
`;

    return { patchYaml, neededKeyEnvs };
  }

  generateUserCredentialsContent(neededKeyEnvs) {
    const { creds, refs } = this.getAdminConfig();
    const userRefs = {};

    for (const keyEnv of neededKeyEnvs) {
      if (refs[keyEnv]) {
        userRefs[keyEnv] = refs[keyEnv];
      }
    }

    const userCreds = {
      version: 1,
      refs: userRefs
    };

    return dump(userCreds);
  }

  syncAllUserHomes() {
    try {
      if (!fs.existsSync(this.userHomesDir)) return;
      const { patchYaml, neededKeyEnvs } = this.generateUserPatchContent();
      const credsYaml = this.generateUserCredentialsContent(neededKeyEnvs);

      const entries = fs.readdirSync(this.userHomesDir);
      for (const entry of entries) {
        if (!entry.startsWith('user-')) continue;
        if (entry === 'user-1-admin' || entry === 'admin') continue;

        const userHome = path.join(this.userHomesDir, entry);
        const profileDir = path.join(userHome, 'profiles', 'web');
        const patchFile = path.join(profileDir, 'cordis.patch.yml');
        const credsFile = path.join(userHome, '.credentials.yaml');

        if (fs.existsSync(profileDir)) {
          fs.writeFileSync(patchFile, patchYaml, 'utf8');
          try { fs.chmodSync(patchFile, 0o666); } catch {}
        }
        fs.writeFileSync(credsFile, credsYaml, 'utf8');
        try { fs.chmodSync(credsFile, 0o666); } catch {}
        ensureNodeOwnership(userHome);
        console.log(`[ModelManager] Synced models & credentials to ${entry}`);
      }
      this.reloadTenantChildren().catch(() => {});
    } catch (e) {
      console.error('[ModelManager] Error syncing user homes:', e.message);
    }
  }

  syncUserHome(userId, username, role = 'user') {
    const isAdmin = (role === 'admin' || String(username).toLowerCase() === 'admin' || String(userId) === '1');
    if (isAdmin) return;

    try {
      const cleanUsername = String(username).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const userHome = path.join(this.userHomesDir, `user-${userId}-${cleanUsername}`);
      const profileDir = path.join(userHome, 'profiles', 'web');
      const patchFile = path.join(profileDir, 'cordis.patch.yml');
      const credsFile = path.join(userHome, '.credentials.yaml');

      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }

      const { patchYaml, neededKeyEnvs } = this.generateUserPatchContent();
      const credsYaml = this.generateUserCredentialsContent(neededKeyEnvs);

      fs.writeFileSync(patchFile, patchYaml, 'utf8');
      fs.writeFileSync(credsFile, credsYaml, 'utf8');
      try {
        fs.chmodSync(patchFile, 0o666);
        fs.chmodSync(credsFile, 0o666);
      } catch {}
      ensureNodeOwnership(userHome);
      console.log(`[ModelManager] Synced single user home for ${userHome}`);
    } catch (e) {
      console.error('[ModelManager] Error syncing single user home:', e.message);
    }
  }

  async reloadTenantChildren() {
    try {
      const dshMainUrl = process.env.DSH_MAIN_URL || 'http://dsh-main:3090';
      await fetch(`${dshMainUrl}/internal/reload-user-children`, { method: 'POST' });
    } catch {}
  }

  addOrUpdateModel(body) {
    this.loadScopes();
    const id = String(body.id).trim();
    const scope = body.scope === 'admin_only' ? 'admin_only' : 'all_users';
    const enabled = body.enabled !== false;
    this.models[id] = {
      id,
      name: String(body.name || id).trim(),
      provider: body.provider || 'custom',
      baseURL: body.baseURL || '',
      apiKeyEnv: body.apiKeyEnv || '',
      apiKey: body.apiKey || '',
      scope,
      enabled,
      contextWindow: body.contextWindow || null,
      maxTokens: body.maxTokens || null
    };
    this.scopes[id] = { scope, enabled };
    this.saveScopes();
    this.syncAllUserHomes();
    return this.models[id];
  }

  deleteModel(modelId) {
    this.loadScopes();
    const existed = Boolean(this.models[modelId] || this.scopes[modelId]);
    delete this.models[modelId];
    delete this.scopes[modelId];
    if (existed) {
      this.saveScopes();
      this.syncAllUserHomes();
    }
    return existed;
  }

  setModelScope(modelId, scope) {
    this.loadScopes();
    if (!this.scopes[modelId]) {
      this.scopes[modelId] = { scope: 'all_users', enabled: true };
    }
    this.scopes[modelId].scope = scope === 'admin_only' ? 'admin_only' : 'all_users';
    this.saveScopes();
    this.syncAllUserHomes();
    return {
      id: modelId,
      scope: this.scopes[modelId].scope,
      enabled: this.scopes[modelId].enabled !== false
    };
  }

  toggleModelStatus(modelId, enabled) {
    this.loadScopes();
    if (!this.scopes[modelId]) {
      this.scopes[modelId] = { scope: 'all_users', enabled: true };
    }
    this.scopes[modelId].enabled = typeof enabled === 'boolean' ? enabled : !this.scopes[modelId].enabled;
    this.saveScopes();
    this.syncAllUserHomes();
    return {
      id: modelId,
      scope: this.scopes[modelId].scope,
      enabled: this.scopes[modelId].enabled
    };
  }
}

export const masterModelManager = new ModelManager();
