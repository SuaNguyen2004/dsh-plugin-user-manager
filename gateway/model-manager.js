// gateway/model-manager.js
// Centralized AI Model & API Key Scope Management for DSH Lite Enterprise.
// All state lives inside the gateway volume (/data/gateway, derived from SQLITE_PATH) —
// NEVER touches the host `data/` directory (acceptance #11).

import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';

function gatewayDataDir() {
  return path.dirname(process.env.SQLITE_PATH || '/data/gateway/users.db');
}

export function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 8)}••••••••${key.slice(-4)}`;
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

  get adminDshHome() {
    return process.env.DSH_ADMIN_HOME_DIR || path.join(gatewayDataDir(), 'admin_dsh_home');
  }

  get userHomesDir() {
    return process.env.DSH_USER_HOMES_DIR || '/data/dsh_homes';
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
      } catch {}
    }
    if (fs.existsSync(credsFile)) {
      try {
        creds = load(fs.readFileSync(credsFile, 'utf8')) || { refs: {} };
      } catch {}
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
    return this.models[id];
  }

  deleteModel(modelId) {
    this.loadScopes();
    const existed = Boolean(this.models[modelId] || this.scopes[modelId]);
    delete this.models[modelId];
    delete this.scopes[modelId];
    if (existed) this.saveScopes();
    return existed;
  }

  setModelScope(modelId, scope) {
    this.loadScopes();
    if (!this.scopes[modelId]) {
      this.scopes[modelId] = { scope: 'all_users', enabled: true };
    }
    this.scopes[modelId].scope = scope === 'admin_only' ? 'admin_only' : 'all_users';
    this.saveScopes();
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
    return {
      id: modelId,
      scope: this.scopes[modelId].scope,
      enabled: this.scopes[modelId].enabled
    };
  }
}

export const masterModelManager = new ModelManager();
