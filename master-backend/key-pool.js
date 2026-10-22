import fs from 'node:fs';
import path from 'node:path';

const POOLS_FILE = process.env.DSH_KEY_POOLS_FILE || path.resolve(process.cwd(), 'data/key_pools.json');

export function maskApiKey(key) {
  if (!key || typeof key !== 'string') return null;
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 8)}••••••••${key.slice(-4)}`;
}

export class MasterKeyPoolManager {
  constructor(filePath = POOLS_FILE) {
    this.filePath = filePath;
    this.pools = new Map();
    this.loadFromFile();
  }

  loadFromFile() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        for (const [ref, keys] of Object.entries(data)) {
          if (Array.isArray(keys)) {
            this.pools.set(ref, keys);
          }
        }
      }
    } catch (e) {
      console.error('[KeyPool] Error reading key pools file:', e.message);
    }
  }

  saveToFile() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const obj = {};
      for (const [ref, keys] of this.pools.entries()) {
        obj[ref] = keys;
      }
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
      console.error('[KeyPool] Error saving key pools file:', e.message);
    }
  }

  setKeys(ref, keyString) {
    const rawKeys = keyString.split(/[\r\n,]+/).map(k => k.trim()).filter(Boolean);
    const pool = rawKeys.map(k => ({
      key: k,
      status: 'active',
      cooldownUntil: 0,
      failCount: 0,
      lastUsed: 0
    }));
    this.pools.set(ref, pool);
    this.saveToFile();
    return pool;
  }

  addKeys(ref, keyString) {
    const rawKeys = keyString.split(/[\r\n,]+/).map(k => k.trim()).filter(Boolean);
    const existing = this.pools.get(ref) || [];
    const existingKeys = new Set(existing.map(x => x.key));
    let addedCount = 0;

    for (const k of rawKeys) {
      if (!existingKeys.has(k)) {
        existing.push({
          key: k,
          status: 'active',
          cooldownUntil: 0,
          failCount: 0,
          lastUsed: 0
        });
        existingKeys.add(k);
        addedCount++;
      }
    }

    this.pools.set(ref, existing);
    this.saveToFile();
    return { pool: existing, addedCount };
  }

  getMaskedPools() {
    const result = {};
    for (const [ref, keys] of this.pools.entries()) {
      result[ref] = keys.map(item => ({
        keyMasked: maskApiKey(item.key),
        status: item.status,
        failCount: item.failCount,
        lastUsed: item.lastUsed
      }));
    }
    return result;
  }
}

export const masterKeyPool = new MasterKeyPoolManager();

