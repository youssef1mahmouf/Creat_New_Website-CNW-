/** API client — the ONLY way the frontend talks to the backend.
 * Secrets (API keys, DB credentials) never live here; the backend holds them. */

const BASE = '/api';

// Tokens are NEVER persisted in JS-readable storage.
//  - Access token: short-lived, kept in memory only. The server also sets it
//    as an HttpOnly `cnw_access` cookie, which is what restores the session
//    after a page reload (see authenticate() -> cookie fallback).
//  - Refresh token: HttpOnly `cnw_refresh` cookie, unreachable from JS.
// Anything in localStorage/sessionStorage would be stealable by an XSS bug,
// so nothing token-shaped lives there.
let accessToken = null;
let onAuthChange = () => {};

// One-time cleanup of legacy copies written by older builds. Leaving them
// would keep JS-readable credentials alive in users' browsers.
try {
  localStorage.removeItem('cnw_refresh');
  localStorage.removeItem('cnw_access');
} catch { /* storage disabled */ }

const CSRF_COOKIE = 'cnw_csrf';
const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export function setAuthListener(fn) { onAuthChange = fn; }

/** Read the double-submit CSRF token the server wrote as a readable cookie. */
export function getCsrfToken() {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  } catch { return null; }
}

/**
 * Guarantee a CSRF cookie exists before the first state-changing request
 * (a brand-new browser has not received a response from the server yet).
 * Safe/cheap: a single same-origin GET, no credentials leakage.
 */
let csrfBootstrap = null;
async function ensureCsrfToken() {
  if (getCsrfToken()) return getCsrfToken();
  if (!csrfBootstrap) {
    csrfBootstrap = fetch(`${BASE}/health`, { credentials: 'same-origin' })
      .catch(() => null)
      .then(() => { csrfBootstrap = null; return getCsrfToken(); });
  }
  return csrfBootstrap;
}

export function setTokens({ access }) {
  if (access !== undefined) {
    // Memory-only by design; the HttpOnly cookie is the persistent copy.
    accessToken = access || null;
  }
}

export function clearAuth() {
  accessToken = null;
}

export function getAccessToken() {
  return accessToken;
}

export async function request(method, path, body, retry = true) {
  const token = getAccessToken();
  const upper = (method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json' };

  if (token) headers.Authorization = `Bearer ${token}`;

  // Double-submit CSRF: required by the server whenever it sees an auth
  // cookie. Bearer-only requests are exempt, but sending the header is
  // always safe and keeps cookie-based flows working.
  if (!SAFE_METHODS.includes(upper)) {
    const csrf = getCsrfToken() || (await ensureCsrfToken());
    if (csrf) headers[CSRF_HEADER] = csrf;
  }

  const res = await fetch(`${BASE}${path}`, {
    method: upper,
    // Same-origin credentials: the browser attaches the HttpOnly
    // `cnw_access` / `cnw_refresh` cookies automatically.
    credentials: 'same-origin',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    // Cookie-only refresh: no token in the body — the server reads the
    // HttpOnly `cnw_refresh` cookie and rotates it there.
    //
    // The request carries a session cookie, so the server's CSRF middleware
    // requires the double-submit header here exactly like any other
    // state-changing call. Without it the refresh would be rejected with
    // 403 CSRF_FAIL and the user would be signed out on the first expiry.
    const refreshHeaders = { 'Content-Type': 'application/json' };
    const refreshCsrf = getCsrfToken() || (await ensureCsrfToken());
    if (refreshCsrf) refreshHeaders[CSRF_HEADER] = refreshCsrf;

    const refreshed = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: refreshHeaders,
      credentials: 'same-origin',
    }).catch(() => null);

    if (refreshed && refreshed.ok) {
      const data = await refreshed.json().catch(() => ({}));
      setTokens({ access: data.accessToken });
      return request(method, path, body, false);
    }
    // Refresh rejected → drop the in-memory/local copy of the access token.
    // The cached user (cnw_user) is cleared by store.fetchMe() only after
    // /auth/me confirms the rejection, so a transient 401 cannot sign a user
    // out by itself.
    clearAuth();
  }

  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error(json?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = json?.code;
    err.details = json?.details;
    throw err;
  }
  return json;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
};
