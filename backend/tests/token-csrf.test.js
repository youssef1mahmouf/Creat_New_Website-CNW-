/**
 * Token security + CSRF + shared-state (Redis readiness) regression tests.
 *
 * Locks down the hardening from the token/CSRF/Redis task:
 *  1. refresh tokens travel ONLY in the HttpOnly `cnw_refresh` cookie
 *  2. rotation + replay rejection + revocation (logout, password reset)
 *  3. double-submit CSRF enforced on every ambient-credential write
 *  4. authorization boundaries still hold with cookie authentication
 *  5. state adapter contract (memory now, Redis when configured)
 *  6. the frontend never persists a token in JS-readable storage
 *
 * These tests drive the real HTTP app — no middleware is mocked — so they
 * fail if the wiring regresses rather than if an internal detail changes.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { db, startApp, api, registerAndLogin } = require('./helpers');

let ctx;
before(async () => { ctx = await startApp(); });
after(async () => { ctx.server.close(); await db.flush(); });

const FRONTEND_SRC = path.resolve(__dirname, '..', '..', 'frontend', 'src');
function readFrontend(...parts) {
  return fs.readFileSync(path.join(FRONTEND_SRC, ...parts), 'utf8');
}

/**
 * Minimal cookie jar. fetch() keeps no cookie store, so tests replay
 * Set-Cookie headers explicitly — exactly what a browser does implicitly.
 */
function cookieJar() {
  const jar = new Map();
  return {
    raw: (name) => jar.get(name) || null,
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    absorb(res) {
      const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      for (const raw of list) {
        const pair = raw.split(';')[0];
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (!value) jar.delete(name); // cleared cookie
        else jar.set(name, value);
      }
      return list;
    },
  };
}

/**
 * HTTP call that threads cookies in and out of a jar.
 * `csrf: true` replays the readable `cnw_csrf` cookie as the double-submit
 * header, which is what the browser client does on unsafe methods.
 */
async function call(jar, method, urlPath, { body, headers = {}, csrf = false } = {}) {
  const outbound = { 'Content-Type': 'application/json', ...headers };
  // An explicit Cookie header (forgery scenarios) wins over the jar.
  if (!outbound.Cookie) {
    const cookie = jar.header();
    if (cookie) outbound.Cookie = cookie;
  }
  if (csrf) {
    const token = jar.raw('cnw_csrf');
    if (token) outbound['X-CSRF-Token'] = token;
  }

  const res = await fetch(`${ctx.baseUrl}${urlPath}`, {
    method,
    headers: outbound,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookies = jar.absorb(res);
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json, setCookies };
}

/** Register + sign in over cookies, returning a primed jar. */
async function loginWithCookies({ email, password = 'Str0ngPass!word', name = 'Cookie User' } = {}) {
  const creds = {
    email: email || `ck${Date.now()}${Math.floor(Math.random() * 1000)}@test.local`,
    password,
    name,
  };
  await call(cookieJar(), 'POST', '/auth/register', { body: creds });
  const jar = cookieJar();
  const login = await call(jar, 'POST', '/auth/login', { body: creds });
  return { jar, creds, login };
}

/* ------------------------------------------------------------------ *
 * 1. Refresh token delivery — HttpOnly cookie only, never in a body
 * ------------------------------------------------------------------ */
describe('refresh token delivery', () => {
  test('login body never contains a refresh token', async () => {
    const { login } = await loginWithCookies();
    assert.equal(login.status, 200);
    assert.equal(login.json.refreshToken, undefined, 'no camelCase refresh token in body');
    assert.equal(login.json.refresh_token, undefined, 'no snake_case refresh token either');
    assert.equal(typeof login.json.accessToken, 'string', 'access token still returned');
    assert.ok(
      !/refresh/i.test(JSON.stringify(login.json)),
      'response body must not mention any refresh field'
    );
  });

  test('login sets cnw_refresh and cnw_access as HttpOnly SameSite cookies', async () => {
    const { login } = await loginWithCookies();
    const refresh = login.setCookies.find((c) => c.startsWith('cnw_refresh='));
    const access = login.setCookies.find((c) => c.startsWith('cnw_access='));
    assert.ok(refresh, 'cnw_refresh cookie is set on login');
    assert.ok(access, 'cnw_access cookie is set on login');
    assert.match(refresh, /HttpOnly/i, 'refresh cookie is HttpOnly (unreadable from JS)');
    assert.match(access, /HttpOnly/i, 'access cookie is HttpOnly');
    assert.match(refresh, /SameSite=Lax/i, 'refresh cookie is SameSite=Lax');
    assert.match(refresh, /Path=\//i, 'refresh cookie is scoped to /');
  });

  test('the CSRF cookie is JS-readable while the auth cookies are not', async () => {
    const { login } = await loginWithCookies();
    const csrf = login.setCookies.find((c) => c.startsWith('cnw_csrf='));
    assert.ok(csrf, 'cnw_csrf cookie is issued');
    assert.ok(!/HttpOnly/i.test(csrf), 'cnw_csrf must NOT be HttpOnly (the client reads it)');
  });

  test('refresh body never contains a refresh token', async () => {
    const { jar } = await loginWithCookies();
    const res = await call(jar, 'POST', '/auth/refresh', { csrf: true });
    assert.equal(res.status, 200);
    assert.equal(res.json.refreshToken, undefined, 'no refresh token in the refresh body');
    assert.ok(!/refresh/i.test(JSON.stringify(res.json)), 'body mentions no refresh field');
    const rotated = res.setCookies.find((c) => c.startsWith('cnw_refresh='));
    assert.ok(rotated, 'the rotated refresh token is delivered by Set-Cookie only');
  });

  test('a body-supplied refresh token is ignored (cookie-only flow)', async () => {
    // No cookies at all → CSRF does not apply, so this reaches the handler —
    // and the body token must still not be honoured.
    const res = await call(cookieJar(), 'POST', '/auth/refresh', {
      body: { refreshToken: 'a'.repeat(64) },
    });
    assert.equal(res.status, 401, 'a body token is not a valid refresh source');
  });
});

/* ------------------------------------------------------------------ *
 * 2. Rotation, replay detection and revocation
 * ------------------------------------------------------------------ */
describe('refresh rotation + revocation', () => {
  test('refresh rotates the refresh cookie', async () => {
    const { jar } = await loginWithCookies();
    const previous = jar.raw('cnw_refresh');
    assert.ok(previous, 'jar holds a refresh token before rotation');
    const res = await call(jar, 'POST', '/auth/refresh', { csrf: true });
    assert.equal(res.status, 200);
    assert.notEqual(jar.raw('cnw_refresh'), previous, 'refresh token rotated on use');
  });

  test('replaying a rotated (now revoked) token is rejected', async () => {
    const { jar } = await loginWithCookies();
    const stolen = jar.raw('cnw_refresh');
    const first = await call(jar, 'POST', '/auth/refresh', { csrf: true });
    assert.equal(first.status, 200, 'first use succeeds');
    // A replay attacker who also holds a valid CSRF pair still cannot use the
    // dead token — the 401 is the token's rejection, not the middleware's.
    const csrf = jar.raw('cnw_csrf');
    const replay = await call(cookieJar(), 'POST', '/auth/refresh', {
      headers: {
        Cookie: `cnw_refresh=${stolen}; cnw_csrf=${csrf}`,
        'X-CSRF-Token': csrf,
      },
    });
    assert.equal(replay.status, 401, 'the old refresh token is dead after rotation');
  });

  test('a revoked session cannot refresh', async () => {
    const { jar } = await loginWithCookies();
    const me = await call(jar, 'GET', '/auth/me');
    assert.ok(me.json.sessionId, 'session id is exposed to its owner');
    const revoked = await call(jar, 'DELETE', `/auth/sessions/${me.json.sessionId}`, { csrf: true });
    assert.equal(revoked.status, 200);
    const res = await call(jar, 'POST', '/auth/refresh', { csrf: true });
    assert.equal(res.status, 401, 'a revoked session must not mint new tokens');
  });

  test('logout revokes the session and clears both auth cookies', async () => {
    const { jar } = await loginWithCookies();
    const res = await call(jar, 'POST', '/auth/logout', { csrf: true });
    assert.equal(res.status, 200);
    const cleared = res.setCookies.join('\n');
    assert.match(cleared, /cnw_refresh=;/, 'refresh cookie cleared');
    assert.match(cleared, /cnw_access=;/, 'access cookie cleared');
    assert.equal(jar.raw('cnw_refresh'), null, 'jar no longer holds a refresh token');
    const after = await call(jar, 'POST', '/auth/refresh', { csrf: true });
    assert.equal(after.status, 401, 'refresh after logout is rejected');
  });

  test('a garbage refresh token is rejected with 401', async () => {
    const { jar } = await loginWithCookies();
    const csrf = jar.raw('cnw_csrf');
    const res = await call(cookieJar(), 'POST', '/auth/refresh', {
      headers: {
        Cookie: `cnw_refresh=not-a-real-token; cnw_csrf=${csrf}`,
        'X-CSRF-Token': csrf,
      },
    });
    assert.equal(res.status, 401, 'an unknown refresh token cannot mint a session');
  });

  test('password reset revokes every existing session', async () => {
    const { jar, creds } = await loginWithCookies();
    const forgot = await call(jar, 'POST', '/auth/forgot-password', {
      body: { email: creds.email }, csrf: true,
    });
    assert.equal(forgot.status, 200);
    assert.ok(forgot.json.devToken, 'dev token is available outside production');
    const reset = await call(jar, 'POST', '/auth/reset-password', {
      body: { token: forgot.json.devToken, password: 'BrandNewPass!9' }, csrf: true,
    });
    assert.equal(reset.status, 200);
    const res = await call(jar, 'POST', '/auth/refresh', { csrf: true });
    assert.equal(res.status, 401, 'sessions revoked after a password reset');
  });
});

/* ------------------------------------------------------------------ *
 * 3. CSRF — double-submit enforcement on ambient-credential requests
 * ------------------------------------------------------------------ */
describe('csrf enforcement', () => {
  test('a write with a matching cookie/header pair succeeds', async () => {
    const { jar } = await loginWithCookies();
    const res = await call(jar, 'POST', '/auth/logout', { csrf: true });
    assert.equal(res.status, 200);
  });

  test('a cookie-authenticated write without the CSRF header is rejected', async () => {
    const { jar } = await loginWithCookies();
    const res = await call(jar, 'POST', '/auth/logout', { csrf: false });
    assert.equal(res.status, 403, 'a missing header must be blocked');
    assert.equal(res.json.code, 'CSRF_FAIL');
    assert.ok(
      !/cnw_csrf|X-CSRF/i.test(JSON.stringify(res.json)),
      'the failure body names no token or header'
    );
  });

  test('a forged CSRF header is rejected', async () => {
    const { jar } = await loginWithCookies();
    const res = await call(jar, 'POST', '/auth/logout', {
      headers: { 'X-CSRF-Token': 'forged-token-value' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, 'CSRF_FAIL');
  });

  test('an auth cookie with no CSRF cookie is rejected', async () => {
    // Cross-site forgery shape: the browser attaches the auth cookie but the
    // attacker page cannot know (or read) cnw_csrf.
    const { jar } = await loginWithCookies();
    const res = await call(jar, 'POST', '/auth/logout', {
      headers: { Cookie: `cnw_access=${jar.raw('cnw_access')}` },
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, 'CSRF_FAIL');
  });

  test('a protected write endpoint (cart) is CSRF-guarded too', async () => {
    const { jar } = await loginWithCookies();
    const body = { productId: 'x', quantity: 1 };
    const blocked = await call(jar, 'POST', '/cart/items', { body });
    assert.equal(blocked.status, 403, 'cart write without the header is blocked');
    assert.equal(blocked.json.code, 'CSRF_FAIL');
    const allowed = await call(jar, 'POST', '/cart/items', { body, csrf: true });
    assert.notEqual(allowed.status, 403, 'the same write passes with a valid token');
  });

  test('safe GET requests need no CSRF token', async () => {
    const { jar } = await loginWithCookies();
    const res = await call(jar, 'GET', '/auth/me');
    assert.equal(res.status, 200);
    assert.ok(res.json.user, 'a cookie-only read works');
  });

  test('bearer-only clients are not CSRF-blocked', async () => {
    const { token } = await registerAndLogin(ctx.baseUrl);
    const res = await api(ctx.baseUrl, 'POST', '/cart/items', {
      token, body: { productId: 'x', quantity: 1 },
    });
    assert.notEqual(res.status, 403, `a bearer request must not be CSRF-blocked (got ${res.status})`);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Authorization boundaries (never weakened by the cookie work)
 * ------------------------------------------------------------------ */
describe('authorization boundaries', () => {
  test('a private route without credentials is 401', async () => {
    const res = await call(cookieJar(), 'GET', '/auth/me');
    assert.equal(res.status, 401);
  });

  test("a user cannot revoke another user's session", async () => {
    const victim = await loginWithCookies();
    const sessions = await call(victim.jar, 'GET', '/auth/sessions');
    assert.equal(sessions.status, 200);
    const victimSessionId = sessions.json.sessions[0].id;

    const attacker = await loginWithCookies();
    const res = await call(attacker.jar, 'DELETE', `/auth/sessions/${victimSessionId}`, { csrf: true });
    assert.ok([403, 404].includes(res.status), `cross-user revoke blocked (got ${res.status})`);

    // The victim's session must be untouched.
    const stillMe = await call(victim.jar, 'GET', '/auth/me');
    assert.equal(stillMe.status, 200, 'the victim session is still usable');
  });

  test('a normal user cannot reach admin endpoints', async () => {
    const { jar } = await loginWithCookies();
    const res = await call(jar, 'GET', '/admin/overview');
    assert.equal(res.status, 403, 'a regular user is not an admin');
  });

  test('privilege escalation through the profile body is ignored', async () => {
    const { jar } = await loginWithCookies();
    const res = await call(jar, 'PUT', '/users/me/profile', {
      csrf: true,
      body: {
        name: 'Escalate Me',
        role: 'admin',
        accountType: 'admin',
        permissions: ['read:users', 'write:users'],
        status: 'active',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.role, 'user', 'role must not be client-writable');
    assert.equal(res.json.user.accountType, 'user', 'accountType must not be client-writable');
    assert.ok(
      !res.json.user.permissions || res.json.user.permissions.length === 0,
      'permissions must not be client-writable'
    );
    const admin = await call(jar, 'GET', '/admin/overview');
    assert.equal(admin.status, 403, 'still not an admin after the attempt');
  });

  test('profile responses expose no password or reset material', async () => {
    const { jar } = await loginWithCookies();
    const put = await call(jar, 'PUT', '/users/me/profile', {
      csrf: true, body: { name: 'Safe Name' },
    });
    const me = await call(jar, 'GET', '/auth/me');
    for (const payload of [put.json, me.json]) {
      const text = JSON.stringify(payload);
      assert.ok(!/passwordHash/i.test(text), 'no password hash leaks');
      assert.ok(!/resetToken/i.test(text), 'no reset-token material leaks');
      assert.ok(!/\$argon2/i.test(text), 'no Argon2 hash leaks');
    }
  });
});

/* ------------------------------------------------------------------ *
 * 5. State adapter — memory now, Redis when configured
 * ------------------------------------------------------------------ */
describe('state adapter', () => {
  const {
    createStateAdapter, createMemoryAdapter, createRedisAdapter, normalizeConfig,
  } = require('../src/services/state-adapter');

  const IFACE = ['incr', 'get', 'set', 'del', 'disconnect'];

  test('the memory adapter implements the full adapter contract', async () => {
    const a = createMemoryAdapter();
    assert.equal(a.kind, 'memory');
    for (const m of IFACE) assert.equal(typeof a[m], 'function', `${m}() must exist`);
    assert.equal(await a.get('missing'), null, 'unknown keys read as null');
    assert.equal(await a.incr('hits'), 1);
    assert.equal(await a.incr('hits', 4), 5, 'delta is applied');
    assert.equal(await a.get('hits'), 5, 'values round-trip as numbers');
    await a.set('flag', 7);
    assert.equal(await a.get('flag'), 7);
    await a.del('hits');
    assert.equal(await a.get('hits'), null);
    assert.equal(await a.disconnect(), true, 'disconnect is a safe no-op');
  });

  test('the memory adapter expires keys by TTL', async () => {
    const a = createMemoryAdapter();
    await a.set('short', 1, 0.05);
    assert.equal(await a.get('short'), 1);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(await a.get('short'), null, 'the key expired after its TTL');
  });

  test('normalizeConfig accepts both the modern and the legacy shape', () => {
    assert.deepEqual(
      normalizeConfig({ enabled: true, url: 'redis://x:6379', prefix: 'app' }),
      { enabled: true, url: 'redis://x:6379', prefix: 'app' }
    );
    assert.deepEqual(
      normalizeConfig({ REDIS_ENABLED: 'true', REDIS_URL: ' redis://y:6379 ' }),
      { enabled: true, url: 'redis://y:6379', prefix: 'cnw' },
      'legacy env shape is normalized (trimmed) and defaults the prefix'
    );
    const off = normalizeConfig();
    assert.equal(off.enabled, false, 'no config means disabled');
    assert.equal(off.url, '');
    assert.equal(off.prefix, 'cnw');
    assert.equal(normalizeConfig({ REDIS_ENABLED: 'nope' }).enabled, false, 'only "true" enables Redis');
  });

  test('the adapter falls back to memory when Redis is not configured', () => {
    assert.equal(createStateAdapter().kind, 'memory');
    assert.equal(createStateAdapter({ enabled: false, url: 'redis://x:6379' }).kind, 'memory');
    assert.equal(createStateAdapter({ enabled: true, url: '' }).kind, 'memory');
    assert.equal(
      createStateAdapter({ REDIS_ENABLED: 'false', REDIS_URL: 'redis://x:6379' }).kind,
      'memory'
    );
  });

  test('the Redis adapter namespaces keys and applies TTLs', async () => {
    // A fake `redis` module keeps this test offline while still exercising the
    // real adapter code path (key namespacing, value coercion, EXPIRE, quit).
    const sent = [];
    const fakeRedis = {
      createClient() {
        return {
          on() { /* error listener */ },
          async connect() { /* pretend to connect */ },
          async sendCommand(args) {
            sent.push(args);
            const cmd = String(args[0]).toUpperCase();
            if (cmd === 'INCRBY') return 3;
            if (cmd === 'GET') return '3';
            return 'OK';
          },
          async quit() { sent.push(['QUIT']); },
        };
      },
    };

    const a = createRedisAdapter(fakeRedis, 'redis://cache:6379', 'cnw');
    assert.equal(a.kind, 'redis');
    assert.equal(await a.incr('hits', 1, 60), 3, 'INCRBY reply is coerced to a number');
    assert.equal(await a.get('hits'), 3, 'GET reply is coerced to a number');
    await a.set('flag', 'on', 30);
    await a.del('hits');

    assert.deepEqual(sent[0], ['INCRBY', 'cnw:hits', '1'], 'command name intact, key namespaced');
    assert.ok(
      sent.some((c) => c[0] === 'EXPIRE' && c[1] === 'cnw:hits'),
      'TTLs are applied with EXPIRE on the namespaced key'
    );
    assert.ok(
      sent.some((c) => c[0] === 'GET' && c[1] === 'cnw:hits'),
      'reads use the namespaced key'
    );
    assert.equal(await a.disconnect(), true, 'disconnect quits the client');
    assert.deepEqual(sent[sent.length - 1], ['QUIT']);
  });

  test('selecting Redis never connects eagerly (safe with no server running)', async () => {
    // Construction is lazy: nothing dials out until the first command, so an
    // unreachable or absent Redis can never block startup.
    const a = createStateAdapter({ enabled: true, url: 'redis://127.0.0.1:1' });
    assert.equal(a.kind, 'redis', 'the Redis adapter is selected when configured');
    assert.equal(await a.disconnect(), true, 'disconnect before use is a no-op');
  });

  test('the rate-limit middleware exposes its adapter-backed helpers', () => {
    const rl = require('../src/middleware/rate-limit.middleware');
    assert.equal(typeof rl.recordFailure, 'function');
    assert.equal(typeof rl.clearFailures, 'function');
    assert.equal(typeof rl.getBruteAdapter, 'function');
    assert.equal(typeof rl.closeBruteAdapter, 'function');
    const adapter = rl.getBruteAdapter();
    assert.equal(typeof adapter.incr, 'function');
    assert.ok(['memory', 'redis'].includes(adapter.kind), 'a real adapter backs brute-force state');
  });
});

/* ------------------------------------------------------------------ *
 * 6. Frontend guarantees — no JS-readable token storage
 * ------------------------------------------------------------------ */
describe('frontend token handling', () => {
  test('the API client never persists a token in web storage', () => {
    const src = readFrontend('api', 'client.js');
    const writes = src.match(/(?:localStorage|sessionStorage)\.setItem\s*\(/g) || [];
    assert.deepEqual(writes, [], `token storage writes found: ${writes.join(', ')}`);
    assert.match(src, /localStorage\.removeItem\('cnw_refresh'\)/, 'legacy refresh copy purged');
    assert.match(src, /localStorage\.removeItem\('cnw_access'\)/, 'legacy access copy purged');
  });

  test('the API client sends the double-submit CSRF header on unsafe methods', () => {
    const src = readFrontend('api', 'client.js');
    assert.match(src, /X-CSRF-Token/, 'the CSRF header name is present');
    assert.match(src, /SAFE_METHODS\s*=\s*\[[^\]]*'GET'/, 'safe methods are explicitly listed');
    assert.match(src, /credentials:\s*'same-origin'/, 'cookies are sent same-origin');
    assert.match(src, /cnw_csrf/, 'the readable CSRF cookie is read');
    assert.match(src, /headers\[CSRF_HEADER\]\s*=\s*csrf/, 'the header is attached when a token exists');
  });

  test('the refresh call is cookie-only and CSRF-protected', () => {
    const src = readFrontend('api', 'client.js');
    assert.match(
      src,
      /refreshHeaders\[CSRF_HEADER\]\s*=\s*refreshCsrf/,
      'a CSRF header is prepared for the refresh call'
    );
    const at = src.indexOf('/auth/refresh');
    assert.ok(at > 0, 'the refresh endpoint is called');
    // The fetch options only (method → closing brace): no body, cookies only.
    const refreshFetch = src.slice(at, src.indexOf('}).catch', at));
    assert.ok(!/body:/.test(refreshFetch), 'no request body is sent (no token in JS reach)');
    assert.match(refreshFetch, /credentials:\s*'same-origin'/, 'the refresh relies on cookies');
  });

  test('the auth store keeps only the access token in memory', () => {
    const src = readFrontend('auth', 'store.js');
    assert.ok(
      !/localStorage\.setItem\('cnw_(access|refresh)'/.test(src),
      'no token is written to localStorage'
    );
    assert.match(src, /setTokens\(\{\s*access:\s*res\.accessToken\s*\}\)/, 'login stores the access token');
    assert.match(src, /setTokens\(\{\s*access:\s*null\s*\}\)/, 'logout clears the in-memory token');
  });
});







