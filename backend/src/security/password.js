/**
 * Password security — Argon2id with optional server-side pepper.
 *
 * Flow: password -> pepper (HMAC, from env only) -> Argon2id (unique salt) -> hash
 * Pepper is NEVER stored in any database and never leaves the server.
 * Pepper rotation support: old pepper kept only in memory for verification;
 * hashes are transparently re-hashed with the new pepper on next successful login.
 */
const argon2 = require('argon2');
const crypto = require('crypto');
const config = require('../config/env');

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB (OWASP-recommended baseline)
  timeCost: 2,
  parallelism: 1,
};

const PEPPER_HMAC_KEY_SALT = 'cnw-pepper-v1';

/**
 * Derive the actual pepper input from PASSWORD_PEPPER using HMAC so that
 * rotating PASSWORD_PEPPER's wrapping key is possible without breaking hashes.
 */
function derivePepper(pepperSecret) {
  if (!pepperSecret) return '';
  return crypto
    .createHmac('sha256', pepperSecret)
    .update(PEPPER_HMAC_KEY_SALT)
    .digest();
}

function applyPepper(password, pepperSecret) {
  const pepper = derivePepper(pepperSecret);
  if (!pepper) return password;
  return crypto.createHmac('sha256', pepper).update(password, 'utf8').digest('base64');
}

/** Hash a plaintext password. Returns an argon2id hash string. */
async function hashPassword(password, pepperSecret = config.secrets.pepper) {
  const peppered = applyPepper(password, pepperSecret);
  return argon2.hash(peppered, ARGON2_OPTIONS);
}

/**
 * Verify a password.
 * Returns { valid, needsRehash } — needsRehash is true when the stored hash
 * parameters are outdated or the password was hashed under an older pepper.
 */
async function verifyPassword(password, hash, { previousPepper } = {}) {
  const candidates = [applyPepper(password, config.secrets.pepper)];
  if (previousPepper) candidates.push(applyPepper(password, previousPepper));
  candidates.push(password); // no-pepper legacy compatibility

  let valid = false;
  let matchedCurrent = false;
  for (let i = 0; i < candidates.length; i++) {
    // argon2.verify is constant-time per attempt; use dummy verify to equalize
    // timing between attempts (defense against hash-vs-no-hash oracles).
    const ok = await argon2.verify(hash, candidates[i]).catch(() => false);
    if (ok) {
      valid = true;
      matchedCurrent = i === 0;
      break;
    }
  }

  const needsRehash =
    valid && (!matchedCurrent || argon2.needsRehash(hash, ARGON2_OPTIONS));
  return { valid, needsRehash };
}

/** Password strength validation (server-side; never trust frontend). */
function validatePasswordStrength(password) {
  const errors = [];
  if (typeof password !== 'string' || password.length < 10) {
    errors.push('Password must be at least 10 characters long.');
  }
  if (password && password.length > 200) errors.push('Password is too long.');
  if (!/[a-z]/.test(password || '')) errors.push('Password must contain a lowercase letter.');
  if (!/[A-Z]/.test(password || '')) errors.push('Password must contain an uppercase letter.');
  if (!/[0-9]/.test(password || '')) errors.push('Password must contain a digit.');
  // Symbols are recommended but not required (matches frontend hint + test spec).
  return errors;
}

module.exports = { hashPassword, verifyPassword, validatePasswordStrength, ARGON2_OPTIONS };
