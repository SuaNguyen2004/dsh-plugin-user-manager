import fs from "node:fs";
import path from "node:path";
import { maskApiKey } from "./model-guard.js";

const PLUGIN_ROOT = path.resolve(import.meta.dirname, "../..");

export function getKeyPoolsFilePath() {
    if (process.env.DSH_KEY_POOLS_FILE) {
        return process.env.DSH_KEY_POOLS_FILE;
    }
    const dataDir = process.env.DSH_DATA_DIR || path.join(PLUGIN_ROOT, "data");
    return path.join(dataDir, "key_pools.json");
}

// Default cooldown duration for 429 RPM limit (60 seconds)
const DEFAULT_COOLDOWN_MS = 60 * 1000;

export class KeyPoolManager {
    constructor(customFilePath = null) {
        this.customFilePath = customFilePath;
        this.pools = new Map(); // ref -> Array<{ key: string, status: string, cooldownUntil: number, failCount: number, lastUsed: number }>
        this.currentIndices = new Map(); // ref -> number
        this.initialized = false;
    }

    getFilePath() {
        return this.customFilePath || getKeyPoolsFilePath();
    }

    /**
     * Initialize pool manager, loading saved pools from disk
     */
    init() {
        if (this.initialized) return;
        this.loadFromFile();
        this.initialized = true;
    }

    /**
     * Load pools from persistent disk storage
     */
    loadFromFile() {
        try {
            const poolsFile = this.getFilePath();
            const parentDir = path.dirname(poolsFile);
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }
            if (fs.existsSync(poolsFile)) {
                const raw = fs.readFileSync(poolsFile, "utf8");
                const data = JSON.parse(raw);
                for (const [ref, keys] of Object.entries(data)) {
                    if (Array.isArray(keys)) {
                        this.pools.set(ref, keys);
                    }
                }
            }
        } catch (err) {
            console.error("[dsh-plugin-user-manager] Error loading key pools:", err.message);
        }
    }

    /**
     * Save current pools to persistent disk storage
     */
    saveToFile() {
        try {
            const poolsFile = this.getFilePath();
            const parentDir = path.dirname(poolsFile);
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }
            const data = {};
            for (const [ref, keys] of this.pools.entries()) {
                data[ref] = keys;
            }
            fs.writeFileSync(poolsFile, JSON.stringify(data, null, 2), "utf8");
        } catch (err) {
            console.error("[dsh-plugin-user-manager] Error saving key pools:", err.message);
        }
    }

    /**
     * Seed/sync with existing single key from .credentials.yaml if pool is empty
     */
    seedFromCredentials(ref, singleKey) {
        if (!singleKey || typeof singleKey !== "string") return;
        const cleanKey = singleKey.trim();
        if (!cleanKey) return;

        const existing = this.pools.get(ref) || [];
        if (existing.length === 0) {
            this.pools.set(ref, [
                {
                    key: cleanKey,
                    status: "active",
                    cooldownUntil: 0,
                    failCount: 0,
                    lastUsed: 0,
                },
            ]);
            this.saveToFile();
        }
    }

    /**
     * Set keys for a provider ref from raw input (string with newlines/commas or array)
     */
    setKeys(ref, rawInput) {
        if (!ref || typeof ref !== "string") return [];

        let keyStrings = [];
        if (Array.isArray(rawInput)) {
            keyStrings = rawInput.map((k) => String(k).trim()).filter(Boolean);
        } else if (typeof rawInput === "string") {
            keyStrings = rawInput
                .split(/[\r\n,]+/)
                .map((k) => k.trim())
                .filter((k) => k.length > 0 && !k.startsWith("#"));
        }

        // Deduplicate
        const uniqueKeys = Array.from(new Set(keyStrings));

        // Preserve existing status / metadata if key already existed
        const existing = this.pools.get(ref) || [];
        const existingMap = new Map(existing.map((e) => [e.key, e]));

        const newPool = uniqueKeys.map((k) => {
            const prev = existingMap.get(k);
            if (prev) {
                return {
                    ...prev,
                    status: prev.status === "cooldown" && Date.now() >= prev.cooldownUntil ? "active" : prev.status,
                };
            }
            return {
                key: k,
                status: "active",
                cooldownUntil: 0,
                failCount: 0,
                lastUsed: 0,
            };
        });

        if (newPool.length > 0) {
            this.pools.set(ref, newPool);
        } else {
            this.pools.delete(ref);
        }

        this.saveToFile();
        return newPool;
    }

    /**
     * Add keys to existing pool for a provider ref (appends new unique keys, keeping existing keys)
     */
    addKeys(ref, rawInput) {
        if (!ref || typeof ref !== "string") return [];
        this.init();

        let keyStrings = [];
        if (Array.isArray(rawInput)) {
            keyStrings = rawInput.map((k) => String(k).trim()).filter(Boolean);
        } else if (typeof rawInput === "string") {
            keyStrings = rawInput
                .split(/[\r\n,]+/)
                .map((k) => k.trim())
                .filter((k) => k.length > 0 && !k.startsWith("#"));
        }

        const existing = this.pools.get(ref) || [];
        const existingKeysSet = new Set(existing.map((e) => e.key));

        let addedCount = 0;
        for (const k of keyStrings) {
            if (!existingKeysSet.has(k)) {
                existing.push({
                    key: k,
                    status: "active",
                    cooldownUntil: 0,
                    failCount: 0,
                    lastUsed: 0,
                });
                existingKeysSet.add(k);
                addedCount++;
            }
        }

        if (existing.length > 0) {
            this.pools.set(ref, existing);
        }

        this.saveToFile();
        existing.addedCount = addedCount;
        return existing;
    }

    /**
     * Remove a single key from pool by index (0-based)
     */
    removeKeyByIndex(ref, index) {
        this.init();
        const pool = this.pools.get(ref);
        if (!pool || pool.length === 0) return [];

        const idx = Number(index);
        if (!Number.isNaN(idx) && idx >= 0 && idx < pool.length) {
            pool.splice(idx, 1);
            if (pool.length === 0) {
                this.pools.delete(ref);
            }
            this.saveToFile();
        }
        return pool;
    }

    /**
     * Get active healthy key for a ref using health-first round-robin
     */
    getActiveKey(ref) {
        this.init();
        const pool = this.pools.get(ref);
        if (!pool || pool.length === 0) return null;

        const now = Date.now();
        // Auto-recover expired cooldowns
        for (const item of pool) {
            if (item.status === "cooldown" && now >= item.cooldownUntil) {
                item.status = "active";
                item.cooldownUntil = 0;
            }
        }

        // Filter available healthy keys
        const available = pool.filter((k) => k.status === "active");
        if (available.length === 0) {
            // All keys in cooldown: return null so callers know no healthy key is currently available
            return null;
        }

        // Round-robin selection
        const currentIndex = this.currentIndices.get(ref) || 0;
        const selected = available[currentIndex % available.length];
        this.currentIndices.set(ref, (currentIndex + 1) % available.length);

        selected.lastUsed = now;
        return selected.key;
    }

    /**
     * Get the most recently used key for a ref
     */
    getLastUsedKey(ref) {
        this.init();
        const pool = this.pools.get(ref);
        if (!pool || pool.length === 0) return null;
        const sorted = [...pool].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
        return sorted[0]?.key || null;
    }

    /**
     * Get the key that will recover earliest when all keys are on cooldown
     */
    getSoonestRecoveringKey(ref) {
        this.init();
        const pool = this.pools.get(ref);
        if (!pool || pool.length === 0) return null;
        const sorted = [...pool].sort((a, b) => (a.cooldownUntil || 0) - (b.cooldownUntil || 0));
        return sorted[0] || null;
    }

    /**
     * Check if a pool exists for ref and has configured keys
     */
    hasPool(ref) {
        this.init();
        const pool = this.pools.get(ref);
        return Boolean(pool && pool.length > 0);
    }

    /**
     * Build compound attempt identifier: (requestId + optional attempt + ref)
     */
    _buildAttemptKey(requestId, attemptId, ref) {
        if (!requestId) return null;
        const reqStr = String(requestId).trim();
        const attStr = attemptId !== undefined && attemptId !== null ? String(attemptId).trim() : "0";
        const refStr = ref ? String(ref).trim() : "*";
        return `${reqStr}::att_${attStr}::ref_${refStr}`;
    }

    /**
     * Bind a specific request/attempt to the API key used
     * NEVER use sessionId or generic session container IDs.
     */
    trackAttemptKey({ requestId, attemptId, ref }, key) {
        if (!requestId || !key) return;
        const reqStr = String(requestId).trim();
        // Strictly disallow session IDs as attempt identifiers
        if (reqStr.startsWith("session-") || reqStr.startsWith("session_") || reqStr === "sessionId") {
            return;
        }

        if (!this.attemptKeyMap) this.attemptKeyMap = new Map();

        // 1. Specific attempt entry: (requestId + attemptId + ref)
        const specificKey = this._buildAttemptKey(reqStr, attemptId, ref);
        if (specificKey) {
            this.attemptKeyMap.set(specificKey, { ref, key, timestamp: Date.now() });
        }

        // 2. Also map without ref if ref provided, for lookup flexibility
        if (ref) {
            const noRefKey = this._buildAttemptKey(reqStr, attemptId, null);
            if (noRefKey) {
                this.attemptKeyMap.set(noRefKey, { ref, key, timestamp: Date.now() });
            }
        }

        // Auto-cleanup entries older than 15 minutes
        if (this.attemptKeyMap.size > 1000) {
            const cutoff = Date.now() - 15 * 60 * 1000;
            for (const [id, entry] of this.attemptKeyMap.entries()) {
                if (entry.timestamp < cutoff) this.attemptKeyMap.delete(id);
            }
        }
    }

    /**
     * Retrieve the API key bound to a specific request/attempt
     */
    getAttemptKey({ requestId, attemptId, ref }) {
        if (!requestId || !this.attemptKeyMap) return null;
        const reqStr = String(requestId).trim();
        if (reqStr.startsWith("session-") || reqStr.startsWith("session_")) {
            return null; // Session IDs are never valid request/attempt identifiers
        }

        // 1. Try exact match: requestId + attemptId + ref
        if (attemptId !== undefined && attemptId !== null) {
            const specificKey = this._buildAttemptKey(reqStr, attemptId, ref);
            if (specificKey && this.attemptKeyMap.has(specificKey)) {
                return this.attemptKeyMap.get(specificKey).key;
            }
            // Try without ref
            const noRefKey = this._buildAttemptKey(reqStr, attemptId, null);
            if (noRefKey && this.attemptKeyMap.has(noRefKey)) {
                return this.attemptKeyMap.get(noRefKey).key;
            }
        }

        // 2. If attemptId was not specified, try attempt 0
        const defaultKey = this._buildAttemptKey(reqStr, 0, ref);
        if (defaultKey && this.attemptKeyMap.has(defaultKey)) {
            return this.attemptKeyMap.get(defaultKey).key;
        }
        const defaultNoRefKey = this._buildAttemptKey(reqStr, 0, null);
        if (defaultNoRefKey && this.attemptKeyMap.has(defaultNoRefKey)) {
            return this.attemptKeyMap.get(defaultNoRefKey).key;
        }

        return null;
    }

    /**
     * Backward-compatible helper for single requestId (delegates to trackAttemptKey)
     */
    trackRequestKey(reqId, ref, key) {
        this.trackAttemptKey({ requestId: reqId, ref }, key);
    }

    /**
     * Backward-compatible helper for single requestId (delegates to getAttemptKey)
     */
    getRequestKey(reqId) {
        return this.getAttemptKey({ requestId: reqId });
    }

    /**
     * Record a 429 Rate Limit error on a specific key and rotate to next key
     * If failedKey is not provided or not found, does NOT guess or penalize arbitrary keys.
     */
    markKey429(ref, failedKey, retryAfterMs = DEFAULT_COOLDOWN_MS) {
        this.init();
        const pool = this.pools.get(ref);
        if (!pool || pool.length === 0) {
            return { rotated: false, nextKey: null, availableCount: 0, totalCount: 0 };
        }

        const now = Date.now();
        const cooldownDuration =
            typeof retryAfterMs === "number" && retryAfterMs > 0 ? retryAfterMs : DEFAULT_COOLDOWN_MS;

        // Auto-recover any keys whose cooldown expired
        for (const item of pool) {
            if (item.status === "cooldown" && now >= item.cooldownUntil) {
                item.status = "active";
                item.cooldownUntil = 0;
            }
        }

        if (!failedKey) {
            // Do not penalize or guess based on timestamps to avoid punishing concurrent requests
            console.warn(`[dsh-plugin-user-manager] markKey429: failedKey is unspecified for "${ref}". Cooldown skipped to prevent race conditions across concurrent requests.`);
            const available = pool.filter((k) => k.status === "active");
            return {
                rotated: false,
                nextKey: this.getActiveKey(ref),
                skipped: true,
                reason: 'unknown_failed_key',
                cooldownDurationMs: cooldownDuration,
                availableCount: available.length,
                totalCount: pool.length,
            };
        }

        const entry = pool.find((k) => k.key === failedKey);
        if (!entry) {
            console.warn(`[dsh-plugin-user-manager] markKey429: key "${failedKey.slice(0, 8)}..." not found in pool "${ref}". Cooldown skipped.`);
            const available = pool.filter((k) => k.status === "active");
            return {
                rotated: false,
                nextKey: this.getActiveKey(ref),
                skipped: true,
                reason: 'key_not_in_pool',
                cooldownDurationMs: cooldownDuration,
                availableCount: available.length,
                totalCount: pool.length,
            };
        }

        entry.status = "cooldown";
        entry.cooldownUntil = now + cooldownDuration;
        entry.failCount = (entry.failCount || 0) + 1;

        // Save changes
        this.saveToFile();

        // Check if another key is available
        const available = pool.filter((k) => k.status === "active");
        const nextKey = this.getActiveKey(ref);

        return {
            rotated: Boolean(nextKey && nextKey !== failedKey),
            nextKey,
            cooldownDurationMs: cooldownDuration,
            availableCount: available.length,
            totalCount: pool.length,
        };
    }

    /**
     * Reset cooldown on all keys for a ref (or all refs)
     */
    resetCooldown(ref = null) {
        this.init();
        if (ref) {
            const pool = this.pools.get(ref);
            if (pool) {
                for (const k of pool) {
                    k.status = "active";
                    k.cooldownUntil = 0;
                }
            }
        } else {
            for (const pool of this.pools.values()) {
                for (const k of pool) {
                    k.status = "active";
                    k.cooldownUntil = 0;
                }
            }
        }
        this.saveToFile();
    }

    /**
     * Get summary for Admin UI with masked keys
     */
    getPoolSummary(ref) {
        this.init();
        const pool = this.pools.get(ref) || [];
        const now = Date.now();

        let activeCount = 0;
        let cooldownCount = 0;

        const maskedKeys = pool.map((item, index) => {
            const isCooling = item.status === "cooldown" && now < item.cooldownUntil;
            const status = isCooling ? "cooldown" : "active";
            if (status === "active") activeCount++;
            else cooldownCount++;

            const cooldownRemainingSec = isCooling ? Math.max(0, Math.ceil((item.cooldownUntil - now) / 1000)) : 0;

            return {
                index: index + 1,
                masked: maskApiKey(item.key),
                status,
                cooldownRemainingSec,
                failCount: item.failCount || 0,
            };
        });

        return {
            total: pool.length,
            active: activeCount,
            cooldown: cooldownCount,
            keys: maskedKeys,
        };
    }

    /**
     * Get raw key list for a ref (for admin editing)
     */
    getRawKeys(ref) {
        this.init();
        const pool = this.pools.get(ref) || [];
        return pool.map((k) => k.key);
    }
}

export const keyPool = new KeyPoolManager();
