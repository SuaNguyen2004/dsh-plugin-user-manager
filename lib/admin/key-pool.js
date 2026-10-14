import fs from "node:fs";
import path from "node:path";
import { maskApiKey } from "./model-guard.js";

const PLUGIN_ROOT = path.resolve(import.meta.dirname, "../..");
const DATA_DIR = path.join(PLUGIN_ROOT, "data");
const POOLS_FILE = path.join(DATA_DIR, "key_pools.json");

// Default cooldown duration for 429 RPM limit (60 seconds)
const DEFAULT_COOLDOWN_MS = 60 * 1000;

class KeyPoolManager {
    constructor() {
        this.pools = new Map(); // ref -> Array<{ key: string, status: string, cooldownUntil: number, failCount: number, lastUsed: number }>
        this.currentIndices = new Map(); // ref -> number
        this.initialized = false;
    }

    /**
     * Initialize pool manager, loading saved pools from data/key_pools.json
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
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            if (fs.existsSync(POOLS_FILE)) {
                const raw = fs.readFileSync(POOLS_FILE, "utf8");
                const data = JSON.parse(raw);
                for (const [ref, keys] of Object.entries(data)) {
                    if (Array.isArray(keys)) {
                        this.pools.set(ref, keys);
                    }
                }
            }
        } catch (err) {
            console.error("[dsh-plugin-user-manager] Error loading key_pools.json:", err.message);
        }
    }

    /**
     * Save current pools to persistent disk storage
     */
    saveToFile() {
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            const data = {};
            for (const [ref, keys] of this.pools.entries()) {
                data[ref] = keys;
            }
            fs.writeFileSync(POOLS_FILE, JSON.stringify(data, null, 2), "utf8");
        } catch (err) {
            console.error("[dsh-plugin-user-manager] Error saving key_pools.json:", err.message);
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
        } else {
            // Ensure the configured key is at least in the pool
            const hasKey = existing.some((k) => k.key === cleanKey);
            if (!hasKey) {
                existing.unshift({
                    key: cleanKey,
                    status: "active",
                    cooldownUntil: 0,
                    failCount: 0,
                    lastUsed: 0,
                });
                this.saveToFile();
            }
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
            // All keys in cooldown: return the one that recovers soonest
            const sorted = [...pool].sort((a, b) => (a.cooldownUntil || 0) - (b.cooldownUntil || 0));
            return sorted[0]?.key || null;
        }

        // Round-robin selection
        const currentIndex = this.currentIndices.get(ref) || 0;
        const selected = available[currentIndex % available.length];
        this.currentIndices.set(ref, (currentIndex + 1) % available.length);

        selected.lastUsed = now;
        return selected.key;
    }

    /**
     * Record a 429 Rate Limit error on a specific key and rotate to next key
     */
    markKey429(ref, failedKey, retryAfterMs = DEFAULT_COOLDOWN_MS) {
        this.init();
        const pool = this.pools.get(ref);
        if (!pool || pool.length === 0) {
            return { rotated: false, nextKey: null, availableCount: 0 };
        }

        const now = Date.now();
        const cooldownDuration =
            typeof retryAfterMs === "number" && retryAfterMs > 0 ? retryAfterMs : DEFAULT_COOLDOWN_MS;

        // Find the key that failed
        const entry = failedKey ? pool.find((k) => k.key === failedKey) : pool.find((k) => k.status === "active");

        if (entry) {
            entry.status = "cooldown";
            entry.cooldownUntil = now + cooldownDuration;
            entry.failCount = (entry.failCount || 0) + 1;
        }

        // Save changes
        this.saveToFile();

        // Check if another key is available
        const available = pool.filter(
            (k) => k.status === "active" || (k.status === "cooldown" && now >= k.cooldownUntil),
        );
        const nextKey = this.getActiveKey(ref);

        return {
            rotated: available.length > 0 && nextKey !== failedKey,
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
