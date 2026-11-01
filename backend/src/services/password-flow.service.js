/**
 * Password flow service — forgot / reset / change password.
 * Reset tokens: cryptographically random, single-use, expiring.
 * Only the SHA-256 hash of the token is stored — never the token or passwords.
 */
const db = require('./db.service');
const { hashPassword, validatePasswordStrength } = require('../security/password');
const { secureToken, hashToken } = require('../security/jwt');
const config = require('../config/env');
const ApiError = require('../utils/api-error');
const audit = require('./audit.service');
const mail = require('./mail.service');
const { slugEmail } = require('./auth.service');

async function requestPasswordReset({ email, ip, userAgent }) {
  const normalized = slugEmail(email);
  const user = await db.findOne('users', { email: normalized });
  // Always succeed externally to prevent user enumeration.
  if (!user) return { sent: true };
  const token = secureToken(32);
  const expiresAt = new Date(Date.now() + config.passwordReset.ttlMinutes * 60 * 1000).toISOString();
  await db.update('users', user.id, {
    resetTokenHash: hashToken(token),
    resetTokenExpiresAt: expiresAt,
  });
  await audit.log({
    actorId: user.id, actorEmail: normalized, action: 'password_reset_request',
    category: 'auth', ip, userAgent,
  });
  // Deliver the reset link by email when SMTP is configured; otherwise the
  // token is returned ONLY when dev tokens are explicitly allowed (never prod).
  if (config.mail.enabled) {
    try {
      const templates = require('./mail-templates');
      const resetUrl = `${config.clientUrl}/user/forgot.html#/reset?token=${token}`;
      await mail.sendMail({
        to: normalized,
        subject: templates.passwordReset(user, resetUrl, config.passwordReset.ttlMinutes).subject,
        text: templates.passwordReset(user, resetUrl, config.passwordReset.ttlMinutes).text,
      });
    } catch {
      // Never reveal whether delivery failed; the flow still succeeds.
    }
  }
  return { sent: true, devToken: mail.devTokenAllowed() ? token : undefined };
}

async function resetPassword({ token, password, ip, userAgent }) {
  const errors = validatePasswordStrength(password);
  if (errors.length) throw ApiError.badRequest('Password does not meet requirements', errors);
  const hashed = hashToken(String(token || ''));
  const user = await db.findOne('users', { resetTokenHash: hashed });
  if (!user || !user.resetTokenExpiresAt || new Date(user.resetTokenExpiresAt) < new Date()) {
    throw ApiError.badRequest('Invalid or expired reset token');
  }
  const passwordHash = await hashPassword(password);
  // Single-use: token is cleared on success and cannot be reused.
  await db.update('users', user.id, {
    passwordHash,
    resetTokenHash: '',
    resetTokenExpiresAt: null,
  });
  // Revoke all sessions after reset (defense against session hijack).
  const { docs } = await db.find('sessions', { userId: user.id, revoked: false });
  for (const s of docs) await db.update('sessions', s.id, { revoked: true });
  await audit.log({
    actorId: user.id, actorEmail: user.email, action: 'password_reset_complete',
    category: 'auth', ip, userAgent,
  });
  return true;
}

const VERIFY_TTL_MINUTES = 1440; // 24h email verification window.

function verificationExpiry() {
  return new Date(Date.now() + VERIFY_TTL_MINUTES * 60 * 1000).toISOString();
}

async function changePassword({ userId, currentPassword, newPassword, ip, userAgent }) {
  const user = await db.findById('users', userId);
  if (!user) throw ApiError.unauthorized();
  const { verifyPassword } = require('../security/password');
  const { valid } = await verifyPassword(String(currentPassword || ''), user.passwordHash);
  if (!valid) {
    await audit.log({
      actorId: userId, actorEmail: user.email, action: 'password_change',
      category: 'auth', ip, userAgent, success: false,
    });
    throw ApiError.badRequest('Current password is incorrect');
  }
  const errors = validatePasswordStrength(newPassword);
  if (errors.length) throw ApiError.badRequest('Password does not meet requirements', errors);
  const { valid: sameAsOld } = await verifyPassword(String(newPassword), user.passwordHash).catch(() => ({ valid: false }));
  if (sameAsOld) throw ApiError.badRequest('New password must be different from the current password');
  await db.update('users', userId, { passwordHash: await hashPassword(newPassword) });
  // Revoke all other sessions; the caller keeps its current session (rotated by login flow if needed).
  const { docs } = await db.find('sessions', { userId, revoked: false });
  for (const s of docs) await db.update('sessions', s.id, { revoked: true });
  await audit.log({
    actorId: userId, actorEmail: user.email, action: 'password_change',
    category: 'auth', ip, userAgent,
  });
  try {
    const templates = require('./mail-templates');
    await mail.sendMail({
      to: user.email,
      subject: templates.passwordChanged(user).subject,
      text: templates.passwordChanged(user).text,
    });
  } catch { /* notification is best-effort */ }
  return true;
}

/** Email verification: request a single-use hashed token link. */
async function requestEmailVerification({ userId, ip, userAgent }) {
  const user = await db.findById('users', userId);
  if (!user) throw ApiError.unauthorized();
  if (user.emailVerified) return { sent: true };
  const token = secureToken(32);
  await db.update('users', user.id, {
    emailVerifyHash: hashToken(token),
    emailVerifyExpiresAt: verificationExpiry(),
  });
  await audit.log({
    actorId: user.id, actorEmail: user.email, action: 'email_verify_request',
    category: 'auth', ip, userAgent,
  });
  if (config.mail.enabled) {
    try {
      const templates = require('./mail-templates');
      const link = `${config.clientUrl}/user/verify.html#/verify?token=${token}`;
      await mail.sendMail({
        to: user.email,
        subject: templates.emailVerification(user, link).subject,
        text: templates.emailVerification(user, link).text,
      });
    } catch { /* never leak delivery state */ }
  }
  return { sent: true, devToken: mail.devTokenAllowed() ? token : undefined };
}

/** Email verification: consume a single-use hashed token. */
async function verifyEmail({ token, ip, userAgent }) {
  const hashed = hashToken(String(token || ''));
  const user = await db.findOne('users', { emailVerifyHash: hashed });
  if (!user || !user.emailVerifyExpiresAt || new Date(user.emailVerifyExpiresAt) < new Date()) {
    throw ApiError.badRequest('Invalid or expired verification token');
  }
  await db.update('users', user.id, {
    emailVerified: true,
    emailVerifyHash: '',
    emailVerifyExpiresAt: null,
    status: user.status === 'pending' ? 'active' : user.status,
  });
  await audit.log({
    actorId: user.id, actorEmail: user.email, action: 'email_verified',
    category: 'auth', ip, userAgent,
  });
  return true;
}

module.exports = { requestPasswordReset, resetPassword, changePassword, requestEmailVerification, verifyEmail };
