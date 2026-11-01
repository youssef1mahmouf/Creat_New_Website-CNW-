/**
 * Authentication service — core (register / login / sessions / refresh).
 * Password reset & change flows live in password-flow.service.js
 * Password hashes never leave this module.
 */
const crypto = require('crypto');
const db = require('./db.service');
const { hashPassword, verifyPassword } = require('../security/password');
const { signAccessToken, secureToken, hashToken } = require('../security/jwt');
const { ROLES } = require('../config/constants');
const config = require('../config/env');
const ApiError = require('../utils/api-error');
const audit = require('./audit.service');
const logger = require('../utils/logger');

function toPublicUser(user) {
  if (!user) return null;
  // Strip every sensitive field. Defense in depth against hash leakage.
  const { passwordHash, resetTokenHash, resetTokenExpiresAt, permissions, ...safe } = user;
  return safe;
}

function slugEmail(email) {
  return String(email).trim().toLowerCase();
}

async function register({ name, email, password, ip, userAgent, ...profile }) {
  const { validatePasswordStrength } = require('../security/password');
  const errors = validatePasswordStrength(password);
  if (errors.length) throw ApiError.badRequest('Password does not meet requirements', errors);
  if (!name || String(name).trim().length < 2) throw ApiError.badRequest('Name is required');

  const normalized = slugEmail(email);
  const existing = await db.findOne('users', { email: normalized });
  if (existing) throw ApiError.conflict('An account with this email already exists');

  // Public registration always creates plain users; admins are provisioned separately.
  const passwordHash = await hashPassword(password);
  const user = await db.create('users', {
    name: String(name).trim().slice(0, 100),
    email: normalized,
    role: ROLES.USER,
    accountType: ROLES.USER,
    passwordHash,
    status: 'active',
    permissions: [],
    lastLoginAt: null,
    // ---- Extended profile (Tohama-style: contact + business info) ----
    phone: String(profile.phone || '').slice(0, 40),
    whatsapp: String(profile.whatsapp || '').slice(0, 40),
    business: String(profile.business || '').slice(0, 120),
    businessType: String(profile.businessType || '').slice(0, 60),
    sitePurpose: String(profile.sitePurpose || '').slice(0, 500),
    budget: String(profile.budget || '').slice(0, 60),
    bio: String(profile.bio || '').slice(0, 1000),
  });

  await audit.log({
    actorId: user.id, actorEmail: normalized, action: 'register',
    category: 'auth', ip, userAgent,
  });
  // Best-effort email verification request (never blocks registration;
  // delivered via SMTP when configured, otherwise logged to the outbox).
  try {
    const passwordFlow = require('./password-flow.service');
    await passwordFlow.requestEmailVerification({ userId: user.id, ip, userAgent });
  } catch { /* verification is optional at registration */ }
  return toPublicUser(user);
}

/**
 * Record a failed login attempt for brute-force tracking.
 * Uses the same key format as the progressiveBruteForceGuard middleware
 * (login:<ip>:<email>) so the guard can read the failure count.
 */
async function recordBruteForce(identifier, ip) {
  try {
    const { recordFailure } = require('../middleware/rate-limit.middleware');
    await recordFailure(`login:${ip || 'unknown'}:${identifier}`).catch(() => {});
  } catch { /* rate-limit module unavailable — fail open */ }
}

async function login({ email, password, ip, userAgent }) {
  const normalized = slugEmail(email);
  const user = await db.findOne('users', { email: normalized });
      if (!user) {
    // Burn comparable time to reduce user-enumeration timing signals.
    const dummy = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$dummytiminghash';
    await verifyPassword(password, dummy).catch(() => {});
    await recordBruteForce(`${normalized}`, ip);
    throw ApiError.unauthorized('Invalid email or password');
  }
  // Suspensions are TEMPORARY (max 5 minutes): auto-lift them on next login
  // attempt so nobody can be locked out forever, then notify by email.
  if (user.status === 'suspended') {
    const suspendedAt = user.suspendedAt ? new Date(user.suspendedAt).getTime() : 0;
    const elapsed = Date.now() - (Number.isFinite(suspendedAt) ? suspendedAt : 0);
    if (elapsed >= 5 * 60 * 1000) {
      await db.update('users', user.id, { status: 'active', suspendedAt: null });
      await audit.log({
        actorId: user.id, actorEmail: normalized, action: 'user_updated',
        category: 'admin', target: user.id,
        metadata: { auto: 'suspension_expired_5m', fields: ['status'] },
      });
      try {
        const mail = require('./mail.service');
        await mail.sendMail({
          to: normalized,
          subject: '[CNW] Your account was restored — you can sign in',
          text: `Hello ${user.name || 'there'},\n\n`
            + `Your temporary CNW suspension (5 minutes) has ended and your account (${normalized}) is active again.\n`
            + `You can sign in now.\n\n— CNW Security`,
        });
      } catch { /* mail failure is recorded in the outbox, never thrown */ }
      user.status = 'active';
    } else {
      const waitSec = Math.max(1, Math.ceil((5 * 60 * 1000 - elapsed) / 1000));
      throw ApiError.forbidden(`Account is temporarily suspended — it auto-restores in ${waitSec}s. Check your email (${normalized}) for details.`);
    }
  }

    const { valid, needsRehash } = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordBruteForce(normalized, ip);
    throw ApiError.unauthorized('Invalid email or password');
  }

  if (needsRehash) {
    // Transparent pepper/parameter upgrade on successful login.
    await db.update('users', user.id, { passwordHash: await hashPassword(password) });
  }

  // Create session: opaque refresh token; only its hash is stored.
  const refresh = secureToken(48);
  const expiresAt = new Date(Date.now() + config.jwt.refreshTtlDays * 86400000).toISOString();
  const session = await db.create('sessions', {
    userId: user.id,
    refreshHash: hashToken(refresh),
    userAgent: String(userAgent || '').slice(0, 250),
    ip: String(ip || '').slice(0, 64),
    expiresAt,
    revoked: false,
  });

  const accessToken = signAccessToken(user, session.id);
  await db.update('users', user.id, { lastLoginAt: new Date().toISOString() });
  await audit.log({
    actorId: user.id, actorEmail: normalized, action: 'login_success',
    category: 'auth', ip, userAgent,
  });

    // Brute-force: clear failure counter on successful login.
  try {
    const { clearFailures } = require('../middleware/rate-limit.middleware');
    await clearFailures(`login:${ip || 'unknown'}:${normalized}`).catch(() => {});
  } catch { /* rate-limit module unavailable — fail open */ }

  // `_cookieRefresh` is consumed by the controller to set the HttpOnly
  // cookie and is NEVER serialized into a response body. Naming it with the
  // underscore prefix (matching refreshSession) makes an accidental
  // `res.json(result)` leak obvious in review.
  return { accessToken, _cookieRefresh: refresh, session, user: toPublicUser(user) };
}

async function refreshSession({ refreshToken, ip, userAgent }) {
  if (!refreshToken) throw ApiError.unauthorized('Refresh token required');
  const session = await db.findOne('sessions', { refreshHash: hashToken(refreshToken) });
  if (!session || session.revoked || new Date(session.expiresAt) < new Date()) {
    throw ApiError.unauthorized('Session expired');
  }
  const user = await db.findById('users', session.userId);
  if (!user || user.status !== 'active') throw ApiError.unauthorized();

      // Rotate refresh token: revoke old session, issue new one.
  // The new refresh token is delivered ONLY via HttpOnly cookie — never in body.
  await db.update('sessions', session.id, { revoked: true });
  const nextRefresh = secureToken(48);
  const expiresAt = new Date(Date.now() + config.jwt.refreshTtlDays * 86400000).toISOString();
  const nextSession = await db.create('sessions', {
    userId: user.id,
    refreshHash: hashToken(nextRefresh),
    userAgent: String(userAgent || '').slice(0, 250),
    ip: String(ip || '').slice(0, 64),
    expiresAt,
    revoked: false,
  });
  return {
    accessToken: signAccessToken(user, nextSession.id),
    user: toPublicUser(user),
    // Returned only for the controller to set the HttpOnly cookie.
    // This value NEVER reaches the JSON response body.
    _cookieRefresh: nextRefresh,
  };
}

async function logout({ sessionId, userId, ip, userAgent }) {
  await db.update('sessions', sessionId, { revoked: true });
  await audit.log({ actorId: userId, action: 'logout', category: 'auth', ip, userAgent });
  return true;
}

/**
 * Logout using the raw refresh token from the HttpOnly cookie.
 *
 * The session row stores only `hashToken(refresh)`, so passing the raw cookie
 * value to `db.update('sessions', ...)` would target a non-existent id and
 * leave the session alive. This resolves the hash to the real session first,
 * then revokes it (a cookie-only client has no access token to derive the
 * session id from).
 */
async function logoutByRefreshToken({ refreshToken, ip, userAgent }) {
  if (!refreshToken) return false;
  const session = await db.findOne('sessions', { refreshHash: hashToken(refreshToken) });
  if (!session) return false;
  await db.update('sessions', session.id, { revoked: true });
  await audit.log({
    actorId: session.userId, action: 'logout', category: 'auth', ip, userAgent,
  });
  return true;
}

async function listSessions(userId) {
  const { docs } = await db.find('sessions', { userId, revoked: false }, { limit: 50 });
  return docs.map((s) => ({
    id: s.id, userAgent: s.userAgent, ip: s.ip,
    createdAt: s.createdAt, expiresAt: s.expiresAt,
  }));
}

async function revokeSession(userId, sessionId) {
  const session = await db.findById('sessions', sessionId);
  if (!session || session.userId !== userId) throw ApiError.notFound('Session not found');
  await db.update('sessions', sessionId, { revoked: true });
  await audit.log({ actorId: userId, action: 'session_revoked', category: 'auth', target: sessionId });
  return true;
}

/** Seed the first super admin if no admin exists (bootstrap scenario). */
async function ensureSeedAdmin() {
  const adminCount = await db.count('users', { role: { $in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] } });
  if (adminCount > 0) return null;
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@cnw.local';
  const password = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
  const admin = await db.create('users', {
    name: 'CNW Super Admin',
    email,
    role: ROLES.SUPER_ADMIN,
    accountType: ROLES.SUPER_ADMIN,
    passwordHash: await hashPassword(password),
    status: 'active',
    permissions: [],
  });
  await audit.log({
    actorId: admin.id, actorEmail: email, action: 'user_created',
    category: 'admin', metadata: { role: ROLES.SUPER_ADMIN },
  });
  // Never log the generated or configured bootstrap password. The operator
  // must provide SEED_ADMIN_PASSWORD when a known credential is required.
  logger.info('seed_admin_created', {
    email,
    passwordProvided: Boolean(process.env.SEED_ADMIN_PASSWORD),
  });
  return admin;
}

async function updateProfile(userId, { name, phone, locale, whatsapp, business, businessType, sitePurpose, budget, bio } = {}) {
  const patch = {};
  if (name !== undefined) patch.name = String(name).slice(0, 100);
  if (phone !== undefined) patch.phone = String(phone).slice(0, 40);
  if (locale !== undefined) patch.locale = String(locale).slice(0, 5).toLowerCase();
  // Extended profile fields (Tohama-style business & contact info)
  if (whatsapp !== undefined) patch.whatsapp = String(whatsapp).slice(0, 40);
  if (business !== undefined) patch.business = String(business).slice(0, 120);
  if (businessType !== undefined) patch.businessType = String(businessType).slice(0, 60);
  if (sitePurpose !== undefined) patch.sitePurpose = String(sitePurpose).slice(0, 500);
  if (budget !== undefined) patch.budget = String(budget).slice(0, 60);
  if (bio !== undefined) patch.bio = String(bio).slice(0, 1000);
  const updated = await db.update('users', userId, patch);
  await audit.log({
    actorId: userId, action: 'config_change', category: 'auth',
    metadata: { fields: Object.keys(patch) },
  });
  return toPublicUser(updated);
}

module.exports = {
  toPublicUser, slugEmail, register, login, refreshSession,
  logout, logoutByRefreshToken, listSessions, revokeSession, ensureSeedAdmin, updateProfile,
};