/**
 * CSRF protection — lightweight double-submit cookie + header pattern.
 *
 * Design:
 *  - The server sets a secure cookie `cnw_csrf` containing a random token.
 *  - For state-changing authenticated requests, the client must also send
 *    the same token in a header (default `X-CSRF-Token`).
 *  - Verification is server-side and constant-time against timing leaks.
 *
 * Safe methods (GET/HEAD/OPTIONS) are never CSRF-checked.
 * The cookie is HttpOnly: false intentionally so the client JS can read it;
 * the security comes from requiring the header as well, so an attacker
 * who can only set cookies (no custom headers) cannot forge a request.
 *
 * For login/logout/register we allow a relaxed mode because there is no
 * authenticated session yet; these endpoints are still protected by
 * rate limiting + origin checks. For all other mutating endpoints we
 * require a valid CSRF token.
 */

const crypto = require('node:crypto');

const CSRF_COOKIE = 'cnw_csrf';
const CSRF_HEADER = 'x-csrf-token';

/**
 * Auth cookies the browser sends automatically. If any of these is present the
 * request is "ambient-credential authenticated" and therefore forgeable from a
 * cross-site page → CSRF protection is mandatory. Requests authenticated with
 * an explicit `Authorization: Bearer` header cannot be forged cross-site
 * (an attacker page cannot set custom headers), so they need no CSRF token.
 */
const SESSION_COOKIES = ['cnw_access', 'cnw_refresh'];

const TOKEN_BYTES = 32;

/** Generate a fresh CSRF token. */
function generateToken() {
  return crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))
    .reduce((acc, b) => acc + b.toString(16).padStart(2, '0'), '');
}

/**
 * Set a CSRF cookie on the response.
 * `secure` should be true in production (HTTPS), false in local dev.
 */
function setCsrfCookie(res, token, secure = false, sameSite = 'lax') {
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false, // client JS must read it to send the header
    secure,
    sameSite,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days, refreshed on each render
    // No `domain` default → scoped to origin that set it.
  });
}

/**
 * Read the CSRF token from the request header, falling back to the cookie
 * only for the double-submit comparison. The header value is the authoritative
 * token the client intends to use.
 */
function getHeaderToken(req) {
  return req.headers[CSRF_HEADER] || null;
}

function getCookieToken(req) {
  const raw = req.cookies?.[CSRF_COOKIE];
  return raw && typeof raw === 'string' ? raw.trim() : null;
}

/**
 * Compare tokens in constant time to avoid timing side-channels.
 */
function tokensMatch(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify the CSRF token for a request.
 *
 * Rules:
 *  - GET/HEAD/OPTIONS are always allowed (no state change).
 *  - For state-changing requests we require a header token that matches
 *    the cookie token.
 *  - Login/register/logout (no existing session) are allowed to proceed
 *    when the header matches the cookie, OR when there is no cookie yet
 *    (first visit) — the rate limiter is the main protection there.
 *
 * Returns: { ok: boolean, reason?: string }
 */
/**
 * True when the request carries a cookie the browser would attach
 * automatically (i.e. the request could be forged by a cross-site page).
 */
function hasSessionCookie(req) {
  if (!req.cookies) return false;
  return SESSION_COOKIES.some((name) => {
    const value = req.cookies[name];
    return typeof value === 'string' && value.length > 0;
  });
}

/**
 * Verify the CSRF token for a request.
 *
 * Rules:
 *  - GET/HEAD/OPTIONS are always allowed (no state change).
 *  - Requests carrying an auth cookie (`cnw_access` / `cnw_refresh`) MUST
 *    present a header token identical to the `cnw_csrf` cookie
 *    (double-submit). Missing or mismatching → rejected.
 *  - Requests with no auth cookie (Bearer-header API clients, first-visit
 *    login/register) cannot be forged via CSRF. A *provided* header must
 *    still match a present cookie, so a partial/tampered pair never passes.
 *
 * Returns: { ok: boolean, reason?: string }
 */
function verifyCsrf(req) {
  const method = (req.method || '').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { ok: true };
  }

  const headerToken = getHeaderToken(req);
  const cookieToken = getCookieToken(req);

  if (hasSessionCookie(req)) {
    // Ambient-credential request → double-submit is mandatory.
    if (!cookieToken) return { ok: false, reason: 'missing_csrf_cookie' };
    if (!headerToken) return { ok: false, reason: 'missing_csrf_header' };
    if (!tokensMatch(headerToken, cookieToken)) {
      return { ok: false, reason: 'csrf_token_mismatch' };
    }
    return { ok: true };
  }

  // Bearer / anonymous request: CSRF does not apply, but a present
  // header+cookie pair must still agree (defends against token tampering).
  if (headerToken && cookieToken && !tokensMatch(headerToken, cookieToken)) {
    return { ok: false, reason: 'csrf_token_mismatch' };
  }

  return { ok: true };
}

/**
 * Middleware factory: enforce CSRF on state-changing requests.
 *
 * Options:
 *  - `secure`: set the CSRF cookie with the Secure flag (true in production).
 *  - `onFail`: optional function(req, res, reason) to customize failure.
 *
 * There is intentionally NO bypass flag. An earlier `requireAuth` option
 * skipped CSRF whenever `req.user` was absent, but `req.user` is populated
 * inside individual route handlers (authenticate/optionalAuth) and never at
 * the global middleware level — so that flag disabled CSRF entirely. An
 * `allowAnon` option had the same effect for the anonymous window.
 * `verifyCsrf` already permits cookie-less requests (first-visit
 * login/register and Bearer-token API clients), so no bypass is needed.
 *
 * CSRF is enforced in every environment, including NODE_ENV=test. The API
 * test suite authenticates with `Authorization: Bearer` and no cookies, so
 * it passes `verifyCsrf` naturally without a test-only bypass.
 */
function csrfMiddleware({ onFail, secure = false } = {}) {
  return (req, res, next) => {
    const method = (req.method || '').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      // GET is also an opportunity to ensure a CSRF cookie exists so the
      // next POST/PUT/DELETE has a matching token pair.
      ensureCsrfCookie(req, res, secure);
      return next();
    }

    const result = verifyCsrf(req);
    if (result.ok) return next();

    const message = 'Request rejected: invalid or missing CSRF token';
    if (onFail) {
      try { return onFail(req, res, result.reason); } catch { /* fall through */ }
    }
    return res.status(403).json({
      success: false,
      code: 'CSRF_FAIL',
      message,
    });
  };
}

/**
 * Create a CSRF-aware response helper for endpoints that mutate state.
 * Call this at the start of the handler to ensure a cookie is present for
 * the current response (fresh token per render is ideal, but per-request
 * refresh is acceptable for this app).
 */
function ensureCsrfCookie(req, res, secure = false) {
  let token = getCookieToken(req);
  if (!token) {
    token = generateToken();
    setCsrfCookie(res, token, secure);
  }
  return token;
}

module.exports = {
  CSRF_COOKIE,
  CSRF_HEADER,
  generateToken,
  setCsrfCookie,
  getHeaderToken,
  getCookieToken,
  verifyCsrf,
  csrfMiddleware,
  ensureCsrfCookie,
};
