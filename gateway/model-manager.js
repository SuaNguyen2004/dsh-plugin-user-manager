// master-backend/model-manager.js
// Centralized AI Model & API Key Scope Management for Multi-tenant Enterprise SaaS
// Reads models configured by Admin in DSH UI and manages permissions (Admin Only vs All Users)

import fs from 'node:fs';
import path from 'node:path';
import { load, dump } from 'js-yaml';

const ADMIN_DSH_HOME = process.env.DSH_ADMIN_HOME_DIR || path.resolve(process.cwd(), 'data/admin_dsh_home');
const SCOPES_FILE = process.env.DSH_MODELS_SCOPES_FILE || path.resolve(process.cwd(), 'data/models_scope.json');
const DSH_HOMES_DIR = process.env.DSH_USER_HOMES_DIR || path.resolve(process.cwd(), 'data/dsh_homes');

export function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 8)}••••••••${key.slice(-4)}`;
}

export class ModelManager {
  constructor() {
    this.adminDshHome = ADMIN_DSH_HOME;
    this.scopesFile = SCOPES_FILE;
    this.userHomesDir = DSH_HOMES_DIR;
    this.scopes = {};
    this.loadScopes();
    this.ensureAdminDshHome();
  }

  ensureAdminDshHome() {
    try {
      const webDir = path.join(this.adminDshHome, 'profiles/web');
      const marketDir = path.join(webDir, '.dsh-market');
      if (!fs.existsSync(marketDir)) fs.mkdirSync(marketDir, { recursive: true });

      const pkgFile = path.join(webDir, 'package.json');
      if (!fs.existsSync(pkgFile)) {
        fs.writeFileSync(pkgFile, JSON.stringify({
          name: 'dsh-profile-web',
          private: true,
          dependencies: {
            dshmarket: '1.66.45',
            'dsh-user-container-plugin': 'link:/app'
          },
          dsh: {
            profile: {
              bundles: [
                '@deepseek-ai/dsh-base',
                '@deepseek-ai/dsh-web-app',
                'dshmarket',
                'dsh-user-container-plugin'
              ]
            }
          }
        }, null, 2), 'utf8');
      }

      const marketStateFile = path.join(marketDir, 'state.json');
      if (!fs.existsSync(marketStateFile)) {
        fs.writeFileSync(marketStateFile, JSON.stringify({
          disabled: [],
          groups: {},
          groupOrder: [],
          region: 'global',
          regionAuto: true,
          sidebarEntry: true
        }, null, 2), 'utf8');
      }
    } catch (e) {
      console.error('[ModelManager] Error initializing admin DSH home:', e.message);
    }
  }

  loadScopes() {
    try {
      if (fs.existsSync(this.scopesFile)) {
        const raw = fs.readFileSync(this.scopesFile, 'utf8');
        this.scopes = JSON.parse(raw);
      } else {
        this.scopes = {};
      }
    } catch (e) {
      console.error('[ModelManager] Error loading scopes file:', e.message);
      this.scopes = {};
    }
  }

  saveScopes() {
    try {
      const dir = path.dirname(this.scopesFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.scopesFile, JSON.stringify(this.scopes, null, 2), 'utf8');
    } catch (e) {
      console.error('[ModelManager] Error saving scopes file:', e.message);
    }
  }

  /**
   * Read raw cordis patch and credentials from Admin's DSH Home
   */
  getAdminConfig() {
    const patchFile = path.join(this.adminDshHome, 'profiles/web/cordis.patch.yml');
    const credsFile = path.join(this.adminDshHome, '.credentials.yaml');

    let patch = [];
    let creds = { refs: {} };

    if (fs.existsSync(patchFile)) {
      try {
        const raw = fs.readFileSync(patchFile, 'utf8').replace(/!!js\s+/g, '');
        patch = load(raw) || [];
      } catch (e) {
        console.error('[ModelManager] Error reading Admin cordis.patch.yml:', e.message);
      }
    }

    if (fs.existsSync(credsFile)) {
      try {
        const raw = fs.readFileSync(credsFile, 'utf8');
        creds = load(raw) || { refs: {} };
      } catch (e) {
        console.error('[ModelManager] Error reading Admin .credentials.yaml:', e.message);
      }
    }

    return { patch, creds, refs: creds?.refs || {} };
  }

  /**
   * Return all models configured by Admin in DSH UI, merged with Scope permissions
   */
  getAllModels() {
    this.loadScopes();
    const { patch, refs } = this.getAdminConfig();
    const llmPlugin = patch.find((p) => p?.id === 'llm-pi-ai');
    const providers = llmPlugin?.config?.providers || {};

    const list = [];
    let scopeChanged = false;

    for (const [providerId, pData] of Object.entries(providers)) {
      const keyEnv = pData.apiKeyEnv;
      const rawKey = keyEnv ? refs[keyEnv] : '';
      const pModels = Array.isArray(pData.models) ? pData.models : [];

      for (const m of pModels) {
        const modelId = m.id;
        if (!this.scopes[modelId]) {
          // Default to all_users so newly added models can be shared easily
          this.scopes[modelId] = {
            scope: 'all_users',
            enabled: true
          };
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

    if (scopeChanged) {
      this.saveScopes();
    }

    return list;
  }

  /**
   * Update scope for a model ('all_users' vs 'admin_only')
   */
  setModelScope(modelId, scope) {
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

  /**
   * Toggle model enabled/disabled status
   */
  toggleModelStatus(modelId, enabled) {
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

  /**
   * Generate sanitized cordis.patch.yml content for regular users
   * containing ONLY models with scope === 'all_users' and enabled === true
   */
  generateUserPatchContent() {
    const { patch } = this.getAdminConfig();
    const llmPlugin = patch.find((p) => p?.id === 'llm-pi-ai');
    const adminProviders = llmPlugin?.config?.providers || {};

    const userProviders = {};
    const neededKeyEnvs = new Set();

    for (const [providerId, pData] of Object.entries(adminProviders)) {
      const allowedModels = (pData.models || []).filter((m) => {
        const sc = this.scopes[m.id];
        return sc && sc.scope === 'all_users' && sc.enabled !== false;
      });

      if (allowedModels.length > 0) {
        userProviders[providerId] = {
          ...pData,
          models: allowedModels
        };
        if (pData.apiKeyEnv) {
          neededKeyEnvs.add(pData.apiKeyEnv);
        }
      }
    }

    let patchYaml = `- id: webserver
  config:
    host: 0.0.0.0
    port: !!js ctx.webStartup.port ?? 3090
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
      const llmYaml = dump(llmObj);
      patchYaml += llmYaml;
    }

    return { patchYaml, neededKeyEnvs };
  }

  /**
   * Generate sanitized .credentials.yaml content for regular users
   */
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

  /**
   * Prepare and return persistent DSH home directory on host for any user
   */
  prepareUserDshHome(userId, username, role = 'user') {
    const isAdmin = (role === 'admin' || String(username).toLowerCase() === 'admin' || String(userId) === '1');
    if (isAdmin) {
      this.ensureAdminDshHome();
      return this.adminDshHome;
    }

    const cleanUsername = String(username).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const userHome = path.join(this.userHomesDir, `user-${userId}-${cleanUsername}`);
    const webDir = path.join(userHome, 'profiles/web');
    const marketDir = path.join(webDir, '.dsh-market');

    if (!fs.existsSync(marketDir)) fs.mkdirSync(marketDir, { recursive: true });

    // Package.json with dshmarket
    const pkgFile = path.join(webDir, 'package.json');
    if (!fs.existsSync(pkgFile)) {
      fs.writeFileSync(pkgFile, JSON.stringify({
        name: 'dsh-profile-web',
        private: true,
        dependencies: {
          dshmarket: '1.66.45',
          'dsh-user-container-plugin': 'link:/app'
        },
        dsh: {
          profile: {
            bundles: [
              '@deepseek-ai/dsh-base',
              '@deepseek-ai/dsh-web-app',
              'dshmarket',
              'dsh-user-container-plugin'
            ]
          }
        }
      }, null, 2), 'utf8');
    }

    // Market state (sidebar enabled by default)
    const marketStateFile = path.join(marketDir, 'state.json');
    if (!fs.existsSync(marketStateFile)) {
      fs.writeFileSync(marketStateFile, JSON.stringify({
        disabled: [],
        groups: {},
        groupOrder: [],
        region: 'global',
        regionAuto: true,
        sidebarEntry: true
      }, null, 2), 'utf8');
    }

    // Write sanitized cordis.patch.yml & .credentials.yaml for this user
    const { patchYaml, neededKeyEnvs } = this.generateUserPatchContent();
    fs.writeFileSync(path.join(webDir, 'cordis.patch.yml'), patchYaml, 'utf8');

    const credsYaml = this.generateUserCredentialsContent(neededKeyEnvs);
    fs.writeFileSync(path.join(userHome, '.credentials.yaml'), credsYaml, 'utf8');

    return userHome;
  }

  /**
   * Sync all existing user DSH homes when admin modifies permissions
   */
  syncAllUserHomes() {
    try {
      if (!fs.existsSync(this.userHomesDir)) return;
      const { patchYaml, neededKeyEnvs } = this.generateUserPatchContent();
      const credsYaml = this.generateUserCredentialsContent(neededKeyEnvs);

      const entries = fs.readdirSync(this.userHomesDir);
      for (const entry of entries) {
        if (!entry.startsWith('user-')) continue;
        const userHome = path.join(this.userHomesDir, entry);
        const patchFile = path.join(userHome, 'profiles/web/cordis.patch.yml');
        const credsFile = path.join(userHome, '.credentials.yaml');

        if (fs.existsSync(path.dirname(patchFile))) {
          fs.writeFileSync(patchFile, patchYaml, 'utf8');
        }
        fs.writeFileSync(credsFile, credsYaml, 'utf8');
      }
    } catch (e) {
      console.error('[ModelManager] Error syncing user homes:', e.message);
    }
  }

  getContainerEnvForUser(role = 'user') {
    // Environment variables can also pass keys if any plugin requires ENV directly
    const { refs } = this.getAdminConfig();
    const envs = [];
    if (role === 'admin') {
      for (const [k, v] of Object.entries(refs)) {
        envs.push(`${k}=${v}`);
      }
    } else {
      const { neededKeyEnvs } = this.generateUserPatchContent();
      for (const k of neededKeyEnvs) {
        if (refs[k]) {
          envs.push(`${k}=${refs[k]}`);
        }
      }
    }
    return envs;
  }
}

export const masterModelManager = new ModelManager();
