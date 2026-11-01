/** JWT helpers — access tokens (short-lived) + refresh tokens (opaque, hashed in DB). */
const jwt = require('jsonwebtoken');
const config = require('../config/env');

function signAccessToken(user, sessionId) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      sid: sessionId,
      type: 'access',
    },
    config.secrets.jwt,
    { expiresIn: config.jwt.accessTtl, issuer: 'cnw-api' }
  );
}

function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, config.secrets.jwt, { issuer: 'cnw-api' });
    if (payload.type !== 'access') return null;
    return payload;
  } catch {
    return null;
  }
}

/** Cryptographically secure random tokens (reset tokens, refresh tokens, ids). */
function secureToken(bytes = 32) {
  return require('crypto').randomBytes(bytes).toString('base64url');
}

/** Only a hash of reset/refresh tokens is ever stored. */
function hashToken(token) {
  return require('crypto').createHash('sha256').update(token).digest('hex');
}

module.exports = { signAccessToken, verifyAccessToken, secureToken, hashToken };
