/**
 * Authentication & authorization middleware.
 * - authenticate: verifies JWT access token (Authorization header or HttpOnly cookie)
 * - requirePermission: role+permission based authorization (extensible)
 * Session fixation/revocation: access tokens carry a sid checked against live sessions.
 */
const { verifyAccessToken } = require('../security/jwt');
const { hasPermission, hasRoleAtLeast } = require('../config/constants');
const ApiError = require('../utils/api-error');
const db = require('../services/db.service');

async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ')
      ? header.slice(7)
      : (req.cookies && req.cookies.cnw_access) || null;
    if (!token) throw ApiError.unauthorized();

    const payload = verifyAccessToken(token);
    if (!payload) throw ApiError.unauthorized('Invalid or expired token');

    const session = await db.findById('sessions', payload.sid);
    if (!session || session.revoked || new Date(session.expiresAt) < new Date()) {
      throw ApiError.unauthorized('Session expired');
    }

    const user = await db.findById('users', payload.sub);
    if (!user || user.status !== 'active') throw ApiError.unauthorized('Account unavailable');

    req.user = user;
    req.sessionId = session.id;
    next();
  } catch (err) {
    next(err);
  }
}

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : (req.cookies && req.cookies.cnw_access) || null;
  if (!token) return next();
  const payload = verifyAccessToken(token);
  if (!payload) return next();
  req.sessionId = payload.sid;
  db.findById('users', payload.sub)
    .then((user) => {
      if (user && user.status === 'active') req.user = user;
      next();
    })
    .catch(() => next());
}

function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    const roleOk = hasPermission(req.user.role, permission);
    const extraOk = Array.isArray(req.user.permissions) && req.user.permissions.includes(permission);
    if (!roleOk && !extraOk) {
      return next(ApiError.forbidden(`Missing required permission: ${permission}`));
    }
    next();
  };
}

function requireRole(minimumRole) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!hasRoleAtLeast(req.user.role, minimumRole)) return next(ApiError.forbidden());
    next();
  };
}

module.exports = { authenticate, optionalAuth, requirePermission, requireRole };
