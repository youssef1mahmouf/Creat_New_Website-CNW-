/**
 * Rate limiting — global limiter plus strict limiters for sensitive endpoints.
 * Progressive brute-force protection for login: repeated failures cause an
 * exponentially increasing block window per IP+identifier.
 */
const rateLimit = require('express-rate-limit');
const { createStateAdapter } = require('../services/state-adapter');

const config = require('../config/env');

function makeLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => config.isTest,
    message: { success: false, code: 'RATE_LIMITED', message },
  });
}

// Global: 300 requests / 15 min per IP
const globalLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Too many requests, please slow down.',
});

// Sensitive endpoints: strict
const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts. Try again later.',
});

const passwordResetLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many password reset attempts. Try again in an hour.',
});

const aiLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: 'AI request quota exceeded for this hour.',
});

const contactLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many contact submissions. Try again in an hour.',
});

// In-site WhatsApp-style chat: generous but bounded (sends + polls).
const chatLimiter = makeLimiter({
  windowMs: 5 * 60 * 1000,
  max: 300,
  message: 'Chat rate limit reached. Please wait a moment.',
});

const errorLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'Too many error reports from this client.',
});

const verifyLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many verification attempts. Try again in an hour.',
});

const orderLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'Too many order attempts. Please wait before trying again.',
});

/**
 * Progressive brute-force guard — adapter-backed so it shares state across
 * instances (MemoryAdapter by default; RedisAdapter when available).
 * failureKey -> counter + blocked-until timestamp in the adapter.
 */

const bruteForceConfig = {
  ttlSeconds: 60 * 60, // 1 hour for failure counters
};

let _bruteAdapter = null;

function getBruteAdapter() {
  if (!_bruteAdapter) {
    // Prefer the validated config block; fall back to raw env for callers that
    // build the limiter before/without the config module (e.g. unit tests).
    let redisCfg = null;
    try {
      // eslint-disable-next-line global-require
      const appConfig = require('../config/env');
      redisCfg = appConfig && appConfig.redis;
    } catch { /* config unavailable — use process.env */ }

    _bruteAdapter = createStateAdapter(
      redisCfg || { REDIS_ENABLED: process.env.REDIS_ENABLED, REDIS_URL: process.env.REDIS_URL }
    );
  }
  return _bruteAdapter;
}

/**
 * Release adapter resources (Redis connection) during graceful shutdown.
 * Safe to call when the adapter was never created. Never throws.
 */
async function closeBruteAdapter() {
  if (!_bruteAdapter || typeof _bruteAdapter.disconnect !== 'function') return true;
  try {
    await _bruteAdapter.disconnect();
  } catch { /* shutdown must never throw */ }
  _bruteAdapter = null;
  return true;
}

/**
 * Record a failed login attempt for `key` (e.g. `login:<ip>:<email>`).
 * Exponential backoff: after 3 failures, block for 1s * 2^(count-3),
 * capped at 5 minutes (must not exceed the temporary-suspension window).
 */
async function recordFailure(key) {
  const adapter = getBruteAdapter();
  const countKey = `bf:${key}:count`;
  const blockKey = `bf:${key}:blockuntil`;
  const now = Date.now();

  let count = (await adapter.get(countKey)) || 0;
  count += 1;
  await adapter.set(countKey, count, bruteForceConfig.ttlSeconds);

  let blockedUntil = await adapter.get(blockKey);
  if (blockedUntil == null) blockedUntil = 0;
  blockedUntil = Number(blockedUntil);

  if (count > 3) {
    const penalty = Math.min(1000 * 2 ** (count - 3), 5 * 60 * 1000);
    const newBlockUntil = now + penalty;
    if (newBlockUntil > blockedUntil) {
      await adapter.set(blockKey, String(newBlockUntil), bruteForceConfig.ttlSeconds);
    }
  }
}

/**
 * Clear a brute-force entry (called after a successful login).
 */
async function clearFailures(key) {
  const adapter = getBruteAdapter();
  await adapter.del(`bf:${key}:count`);
  await adapter.del(`bf:${key}:blockuntil`);
}

/**
 * Middleware factory: before allowing a login attempt, check whether the key
 * is currently blocked. Must be placed BEFORE the login route handler.
 */
function progressiveBruteForceGuard(keyExtractor) {
  return async (req, res, next) => {
    const key = keyExtractor(req);
    const adapter = getBruteAdapter();
    try {
      const blockedUntil = await adapter.get(`bf:${key}:blockuntil`);
      if (blockedUntil != null && Number(blockedUntil) > Date.now()) {
        const waitSec = Math.ceil((Number(blockedUntil) - Date.now()) / 1000);
        res.set('Retry-After', String(waitSec));
        return res.status(429).json({
          success: false,
          code: 'RATE_LIMITED',
          message: `Too many failed attempts. Try again in ${waitSec}s.`,
        });
      }
    } catch {
      // If the adapter fails (e.g. Redis down during a brief outage), fail
      // open: allow the request through rather than blocking all logins.
    }
    next();
  };
}

module.exports = {
  globalLimiter,
  authLimiter,
  passwordResetLimiter,
  aiLimiter,
  contactLimiter,
  chatLimiter,
  errorLimiter,
  verifyLimiter,
  orderLimiter,
  recordFailure,
  clearFailures,
  progressiveBruteForceGuard,
  getBruteAdapter,
  closeBruteAdapter,
};
