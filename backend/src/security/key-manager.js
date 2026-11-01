/** Key manager — rotates AES-256-GCM encryption keys by version.
 * The active key is derived from the current env key; previous keys are
 * kept only for decrypting older envelopes during rotation.
 * Keys NEVER leave this module as plaintext.
 *
 * Rotation model:
 *   - ENCRYPTION_KEY_CURRENT  -> new data is encrypted under the current version
 *   - ENCRYPTION_KEY_PREVIOUS -> old data remains readable; a migration job
 *     re-encrypts records to the current version without losing access.
 */
const crypto = require('crypto');
const config = require('../config/env');

class KeyManager {
  constructor() {
    this.keys = new Map(); // version (number) -> Buffer(32)
    this.currentVersion = 1;
    this._load();
  }

  _load() {
    const raw = config.secrets.encryptionKeys;
    for (const [version, value] of Object.entries(raw)) {
      if (!value) continue;
      let key;
      if (/^[0-9a-fA-F]{64}$/.test(value)) key = Buffer.from(value, 'hex');
      else key = Buffer.from(value, 'base64');
      if (key.length !== 32) {
        // Deterministically derive a 32-byte key from any provided secret.
        key = crypto.createHash('sha256').update(value).digest();
      }
      this.keys.set(Number(version), key);
      const v = Number(version);
      if (v > this.currentVersion && raw['1']) this.currentVersion = Math.max(v, 1);
    }
    if (this.keys.size === 0) {
      throw new Error('No encryption key configured. Set ENCRYPTION_KEY_CURRENT.');
    }
  }

  /** Current active key + version for new encryptions. */
  getCurrentKey() {
    return { key: this.keys.get(this.currentVersion), version: this.currentVersion };
  }

  /** Retrieve a historical key (returns undefined if unknown). */
  getKey(version) {
    return this.keys.get(Number(version));
  }

  /** Rotate: promote a new key. Old keys remain for decryption compatibility. */
  rotate(newKeyMaterial) {
    const key = typeof newKeyMaterial === 'string'
      ? crypto.createHash('sha256').update(newKeyMaterial).digest()
      : Buffer.from(newKeyMaterial);
    if (key.length !== 32) throw new Error('Key material must yield 32 bytes');
    const next = this.currentVersion + 1;
    this.keys.set(next, key);
    this.currentVersion = next;
    return next;
  }

  /** List versions available for re-encryption migrations. */
  versions() {
    return [...this.keys.keys()].sort((a, b) => a - b);
  }
}

// Singleton
module.exports = new KeyManager();
