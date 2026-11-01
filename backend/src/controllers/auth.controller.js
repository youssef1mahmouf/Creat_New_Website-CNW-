/** Auth controller — thin HTTP layer over auth + password-flow services. */
const authService = require('../services/auth.service');
const passwordFlow = require('../services/password-flow.service');
const asyncHandler = require('../utils/async-handler');
const config = require('../config/env');

const COOKIE_OPTS = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'lax',
  path: '/',
  maxAge: config.jwt.refreshTtlDays * 24 * 3600 * 1000,
};

function reqMeta(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') || '' };
}

exports.register = asyncHandler(async (req, res) => {
  const user = await authService.register({ ...req.body, ...reqMeta(req) });
  res.status(201).json({ success: true, user });
});

exports.login = asyncHandler(async (req, res) => {
  const result = await authService.login({ ...req.body, ...reqMeta(req) });
  res.cookie('cnw_access', result.accessToken, { ...COOKIE_OPTS, maxAge: 1000 * 60 * 60 });
  res.cookie('cnw_refresh', result._cookieRefresh, COOKIE_OPTS);
  res.json({
    success: true,
    user: result.user,
    accessToken: result.accessToken,
    // NOTE: refreshToken is intentionally NOT returned in the body.
    // It is delivered ONLY via the HttpOnly cookie `cnw_refresh` so that
    // JavaScript cannot read it (defense against XSS token theft).
    // Frontend clients MUST rely on the cookie + same-origin credentials,
    // not on a localStorage copy.
  });
});

exports.refresh = asyncHandler(async (req, res) => {
  // Cookie-only: the refresh token is read exclusively from the HttpOnly
  // `cnw_refresh` cookie. A body-supplied `refreshToken` is ignored (it was
  // a short transition window that is now closed) — accepting it would give
  // an XSS-readable path back into the token flow.
  const refreshToken = req.cookies.cnw_refresh;
  const result = await authService.refreshSession({ refreshToken, ...reqMeta(req) });
  res.cookie('cnw_access', result.accessToken, { ...COOKIE_OPTS, maxAge: 1000 * 60 * 60 });
  res.cookie('cnw_refresh', result._cookieRefresh, COOKIE_OPTS);
  res.json({ success: true, accessToken: result.accessToken, user: result.user });
});

exports.logout = asyncHandler(async (req, res) => {
  // Cookie-based logout (covers same-origin + credentialed requests).
  if (req.user) {
    await authService.logout({ sessionId: req.sessionId, userId: req.user.id, ...reqMeta(req) });
  } else {
    // Anonymous logout: no access token to derive the session id from, so
    // resolve the session through the refresh cookie's hash.
    const refresh = req.cookies.cnw_refresh;
    if (refresh) {
      await authService
        .logoutByRefreshToken({ refreshToken: refresh, ...reqMeta(req) })
        .catch(() => {});
    }
  }
  res.clearCookie('cnw_access', { httpOnly: true, secure: config.isProduction, sameSite: 'lax', path: '/' });
  res.clearCookie('cnw_refresh', { httpOnly: true, secure: config.isProduction, sameSite: 'lax', path: '/' });
  res.json({ success: true, message: 'Signed out' });
});

exports.me = (req, res) => {
  res.json({ success: true, user: authService.toPublicUser(req.user), sessionId: req.sessionId });
};

exports.sessions = asyncHandler(async (req, res) => {
  res.json({ success: true, sessions: await authService.listSessions(req.user.id) });
});

exports.revokeSession = asyncHandler(async (req, res) => {
  await authService.revokeSession(req.user.id, req.params.id);
  res.json({ success: true });
});

exports.forgotPassword = asyncHandler(async (req, res) => {
  const result = await passwordFlow.requestPasswordReset({ ...req.body, ...reqMeta(req) });
  res.json({ success: true, message: 'If the account exists, a reset link has been sent.', devToken: result.devToken });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  await passwordFlow.resetPassword({ token: req.body.token, password: req.body.password, ...reqMeta(req) });
  res.json({ success: true, message: 'Password has been reset. Please sign in.' });
});

exports.requestVerification = asyncHandler(async (req, res) => {
  const result = await passwordFlow.requestEmailVerification({ userId: req.user.id, ...reqMeta(req) });
  res.json({ success: true, message: 'If verification is needed, a link has been sent.', devToken: result.devToken });
});

exports.verifyEmail = asyncHandler(async (req, res) => {
  await passwordFlow.verifyEmail({ token: req.body.token, ...reqMeta(req) });
  res.json({ success: true, message: 'Email verified.' });
});

exports.changePassword = asyncHandler(async (req, res) => {
  await passwordFlow.changePassword({
    userId: req.user.id,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword,
    ...reqMeta(req),
  });
  res.json({ success: true, message: 'Password updated' });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user.id, {
    name: req.body.name,
    phone: req.body.phone,
    locale: req.body.locale,
    whatsapp: req.body.whatsapp,
    business: req.body.business,
    businessType: req.body.businessType,
    sitePurpose: req.body.sitePurpose,
    budget: req.body.budget,
    bio: req.body.bio,
  });
  res.json({ success: true, user });
});
