/**
 * CNW — State / cache / counter adapter abstraction.
 *
 * Decouple process-local state (counters, rate-limit / brute-force state) from
 * the business layer so the app runs on a single Node with an in-memory
 * adapter and can switch to Redis for multi-node without changing call sites.
 *
 * Interface: { incr(key,delta=1,ttlSeconds) -> Promise<number>,
 *              get(key) -> Promise<number|null>,
 *              set(key,value,ttlSeconds) -> Promise<void>,
 *              del(key) -> Promise<void> }
 *
 * This is for VOLATILE counters only — not a business-data cache and not a
 * session store (sessions already live in the database layer).
 *
 * Env: REDIS_ENABLED="true" + REDIS_URL enables Redis when the `redis` pkg is
 * installed. Otherwise MemoryAdapter. Startup is never blocked by missing Redis
 * or a missing `redis` package.
 */

/**
 * Normalize the many accepted config shapes into one object.
 * Accepts { enabled, url, prefix } (from config.redis) or the legacy
 * { REDIS_ENABLED, REDIS_URL } shape, or nothing at all.
 */
function normalizeConfig(config) {
  const src = config || {};
  const enabledRaw = src.enabled !== undefined ? src.enabled : src.REDIS_ENABLED;
  const urlRaw = src.url !== undefined ? src.url : src.REDIS_URL;
  return {
    enabled: enabledRaw === true || String(enabledRaw || '').trim().toLowerCase() === 'true',
    url: String(urlRaw || '').trim(),
    prefix: String(src.prefix || 'cnw').trim().replace(/:+$/, ''),
  };
}

function createStateAdapter(config) {
  const cfg = normalizeConfig(config);

  if (cfg.enabled && cfg.url) {
    try {
      const redis = require('redis');
      return createRedisAdapter(redis, cfg.url, cfg.prefix);
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'state_adapter_redis_unavailable_falling_back_to_memory',
          reason: String((err && err.message) || err),
          hint: 'Install redis and set REDIS_URL + REDIS_ENABLED=true for multi-node.',
        })
      );
      return createMemoryAdapter();
    }
  }
  return createMemoryAdapter();
}

function createMemoryAdapter() {
  const store = new Map();
  const timers = new Map();

  function _setTTL(key, ttlSeconds) {
    if (timers.has(key)) clearTimeout(timers.get(key));
    if (ttlSeconds == null || ttlSeconds <= 0) return;
    const timer = setTimeout(() => { store.delete(key); timers.delete(key); }, ttlSeconds * 1000);
    // Do not let a pending expiry keep the Node.js event loop (and therefore
    // the process — e.g. the test runner, or a Ctrl+C shutdown) alive. The
    // timer still fires while the process is running; it simply stops being
    // a reason for the process to stay up.
    if (typeof timer.unref === 'function') timer.unref();
    timers.set(key, timer);
  }

  return {
    async incr(key, delta = 1, ttlSeconds = null) {
      const current = Number(store.get(key) || 0);
      const next = current + delta;
      store.set(key, next);
      _setTTL(key, ttlSeconds);
      return next;
    },
    async get(key) {
      const value = store.get(key);
      if (value == null) return null;
      return Number(value);
    },
    async set(key, value, ttlSeconds = null) {
      store.set(key, value);
      _setTTL(key, ttlSeconds);
    },
    async del(key) {
      store.delete(key);
      if (timers.has(key)) { clearTimeout(timers.get(key)); timers.delete(key); }
    },
    /** No-op: nothing external to release. Kept so callers are adapter-agnostic. */
    async disconnect() { return true; },
    /** Adapter identity for startup diagnostics/tests. Never exposes config. */
    kind: 'memory',
  };
}

/**
 * Redis adapter — multi-node shared counters.
 *
 * Uses the official `redis` package (v4+) with Promises. Counter values are
 * stored as UTF-8 integer strings; the adapter coerces at the boundary so
 * call sites only see numbers. TTL via EXPIRE. incr is atomic via INCRBY.
 *
 * This is appended by a follow-up edit to keep each tool call within size
 * limits; functionally it is part of the same module.
 */

function createRedisAdapter(Redis, url, prefix = 'cnw') {
  let client = null;
  const ns = String(prefix || 'cnw').replace(/:+$/, '');
  // Namespace every key so multiple apps/environments can share one Redis.
  const k = (key) => `${ns}:${key}`;

  async function _getClient() {
    if (client) return client;
    client = Redis.createClient({ url });
    client.on('error', (err) => {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'redis_adapter_client_error',
          reason: String((err && err.message) || err),
        })
      );
    });
    await client.connect();
    return client;
  }

  /**
   * Send one command with a namespaced key.
   *
   * The command name must stay untouched: namespacing `args[0]` (as an earlier
   * version did) emitted commands like `cnw:INCRBY <key>` — Redis rejects those
   * as unknown commands, and the real key was never namespaced at all. Only the
   * key is prefixed, so multiple apps/environments can share one Redis.
   */
  async function _cmd(cmd, key, ...rest) {
    const c = await _getClient();
    return await c.sendCommand([String(cmd).toUpperCase(), k(key), ...rest.map(String)]);
  }

  return {
    async incr(key, delta = 1, ttlSeconds = null) {
      const newVal = await _cmd('INCRBY', key, String(delta));
      if (ttlSeconds != null && ttlSeconds > 0) {
        await _cmd('EXPIRE', key, String(ttlSeconds));
      }
      return Number(newVal);
    },
    async get(key) {
      const value = await _cmd('GET', key);
      if (value == null || value === false) return null;
      const n = parseInt(value, 10);
      return Number.isFinite(n) ? n : null;
    },
    async set(key, value, ttlSeconds = null) {
      await _cmd('SET', key, String(value));
      if (ttlSeconds != null && ttlSeconds > 0) {
        await _cmd('EXPIRE', key, String(ttlSeconds));
      }
    },
    async del(key) {
      await _cmd('DEL', key);
    },
    /** Close the Redis connection (graceful shutdown). Never throws. */
    async disconnect() {
      if (!client) return true;
      try {
        await client.quit();
      } catch {
        try { client.destroy?.(); } catch { /* already closed */ }
      }
      client = null;
      return true;
    },
    kind: 'redis',
  };
}

module.exports = { createStateAdapter, createMemoryAdapter, createRedisAdapter, normalizeConfig };

