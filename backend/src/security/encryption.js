/**
 * Encryption service — AES-256-GCM authenticated encryption.
 *
 * Every encryption produces a self-contained envelope:
 *   { ciphertext, iv, tag, keyVersion, alg }
 *
 * The key NEVER leaves the KeyManager / env. Unique random IV per operation.
 */
const crypto = require('crypto');
const keyManager = require('./key-manager');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce recommended for GCM

function encrypt(plaintext) {
  const { key, version } = keyManager.getCurrentKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([
    cipher.update(Buffer.from(String(plaintext), 'utf8')),
    cipher.final(),
  ]);
  return {
    ciphertext: data.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    keyVersion: version,
    alg: ALGORITHM,
  };
}

function decrypt(envelope) {
  if (!envelope || !envelope.ciphertext || !envelope.iv || !envelope.tag) {
    throw new Error('Malformed encrypted payload');
  }
  const key = keyManager.getKey(envelope.keyVersion);
  if (!key) throw new Error(`Unknown key version: ${envelope.keyVersion}`);
  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(envelope.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  } catch {
    // Authentication failure (tampered ciphertext / wrong key) — do not leak more.
    throw new Error('Decryption failed: integrity check error');
  }
}

module.exports = { encrypt, decrypt, ALGORITHM };
