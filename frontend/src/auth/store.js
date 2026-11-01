/** Client-side auth state. Tokens kept out of URLs; only in memory/localStorage. */
import { api, setTokens, setAuthListener } from '../api/client.js';

let currentUser = null;
try {
  const storedUser = JSON.parse(localStorage.getItem('cnw_user') || 'null');
  if (storedUser && typeof storedUser === 'object' && typeof storedUser.id === 'string') {
    currentUser = storedUser;
  }
} catch {
  localStorage.removeItem('cnw_user');
}

// NOTE: do NOT clear cnw_user here. api client token expiry alone must not
// sign the user out — only an explicit logout() or a confirmed 401/403
// from /auth/me (fetchMe) may clear the cached user.
setAuthListener(() => {}); // tokens-only; user cleared only by logout/fetchMe

export function getUser() { return currentUser; }
export function isAdmin() { return currentUser && ['admin', 'super_admin'].includes(currentUser.role); }

export async function login(email, password) {
  const res = await api.post('/auth/login', { email, password });
  // Only persist the access token; the refresh token is delivered solely via
  // the HttpOnly cookie set by the server and is never accessible to JS.
  setTokens({ access: res.accessToken });
  currentUser = res.user;
  localStorage.setItem('cnw_user', JSON.stringify(res.user));
  window.dispatchEvent(new CustomEvent('cnw:auth', { detail: res.user }));
  return res.user;
}

export async function register(name, email, password, profile = {}) {
  return api.post('/auth/register', {
    name, email, password,
    phone: profile.phone || '',
    whatsapp: profile.whatsapp || '',
    business: profile.business || '',
    businessType: profile.businessType || '',
    sitePurpose: profile.sitePurpose || '',
    budget: profile.budget || '',
    bio: profile.bio || '',
  });
}

/** Update the signed-in user's extended profile (Tohama-style info). */
export async function updateProfile(patch) {
  const res = await api.put('/users/me/profile', patch);
  if (res.user) {
    currentUser = res.user;
    localStorage.setItem('cnw_user', JSON.stringify(res.user));
  }
  return res.user;
}

export async function logout() {
  try { await api.post('/auth/logout'); } catch { /* session may already be gone */ }
  setTokens({ access: null });
  currentUser = null;
  localStorage.removeItem('cnw_user');
  window.dispatchEvent(new CustomEvent('cnw:auth', { detail: null }));
}

export async function fetchMe() {
  try {
    const res = await api.get('/auth/me');
    currentUser = res.user;
    localStorage.setItem('cnw_user', JSON.stringify(res.user));
    return res.user;
  } catch (err) {
    // Server explicitly rejected the session (bad/expired token, deleted user)
    // → drop the stale local copy so the header correctly falls back to
    // Sign In / Register instead of showing My Profile for a logged-out user.
    // Network failures (no err.status) keep the cached user for offline use.
    if (err && (err.status === 401 || err.status === 403)) {
      currentUser = null;
      localStorage.removeItem('cnw_user');
    }
    return null;
  }
}

export async function forgotPassword(email) { return api.post('/auth/forgot-password', { email }); }
export async function resetPassword(token, password) { return api.post('/auth/reset-password', { token, password }); }
export async function changePassword(currentPassword, newPassword) {
  return api.post('/auth/change-password', { currentPassword, newPassword });
}
export async function mySessions() { return api.get('/auth/sessions'); }
export async function revokeSession(id) { return api.del(`/auth/sessions/${id}`); }
