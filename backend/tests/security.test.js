/** Security unit tests: password hashing, encryption, key rotation. */
const { test, describe } = require('node:test');
const assert = require('node:assert');
require('./helpers');

const { hashPassword, verifyPassword, validatePasswordStrength } = require('../src/security/password');
const { encrypt, decrypt } = require('../src/security/encryption');
const keyManager = require('../src/security/key-manager');

describe('password security (Argon2id)', () => {
  test('hashes a password and verifies it', async () => {
    const hash = await hashPassword('MySecretPassword1');
    assert.match(hash, /^\$argon2id\$/);
    assert.ok(!hash.includes('MySecretPassword1'), 'plaintext must not appear in hash');
    const { valid } = await verifyPassword('MySecretPassword1', hash);
    assert.equal(valid, true);
  });

  test('rejects wrong password', async () => {
    const hash = await hashPassword('CorrectPassword1');
    const { valid } = await verifyPassword('WrongPassword1', hash);
    assert.equal(valid, false);
  });

  test('generates unique salts for identical passwords', async () => {
    const a = await hashPassword('SamePassword1');
    const b = await hashPassword('SamePassword1');
    assert.notEqual(a, b);
  });

  test('flags needsRehash for outdated pepper', async () => {
    const { hashPassword: hashNoPepper } = require('../src/security/password');
    // Simulate hash created without pepper by hashing with empty pepper secret.
    const hash = await hashPassword('LegacyPassword1', '');
    const { valid, needsRehash } = await verifyPassword('LegacyPassword1', hash);
    assert.equal(valid, true);
    assert.equal(needsRehash, true, 'should upgrade to peppered hash');
  });

  test('password strength validation', () => {
    assert.ok(validatePasswordStrength('short').length > 0);
    assert.ok(validatePasswordStrength('alllowercase1').length > 0);
    assert.ok(validatePasswordStrength('NoDigitsHere').length > 0);
    assert.equal(validatePasswordStrength('GoodPassword1').length, 0);
  });
});

describe('AES-256-GCM encryption', () => {
  test('encrypt/decrypt roundtrip', () => {
    const envelope = encrypt('sensitive-data-123');
    assert.equal(envelope.alg, 'aes-256-gcm');
    assert.ok(envelope.iv && envelope.tag && envelope.ciphertext);
    assert.equal(decrypt(envelope), 'sensitive-data-123');
  });

  test('unique IV per operation', () => {
    const a = encrypt('x');
    const b = encrypt('x');
    assert.notEqual(a.iv, b.iv);
  });

  test('tampered ciphertext fails integrity check', () => {
    const envelope = encrypt('do-not-tamper');
    const bytes = Buffer.from(envelope.ciphertext, 'base64');
    bytes[0] ^= 0xff;
    envelope.ciphertext = bytes.toString('base64');
    assert.throws(() => decrypt(envelope), /integrity/);
  });

  test('tampered tag fails integrity check', () => {
    const envelope = encrypt('do-not-tamper-tag');
    envelope.tag = Buffer.from('0'.repeat(22) + 'ff', 'base64').toString('base64');
    assert.throws(() => decrypt(envelope));
  });
});

describe('key manager rotation', () => {
  test('old keys remain decryptable after rotation', () => {
    const envelope = encrypt('pre-rotation-secret');
    keyManager.rotate('new-rotation-key-material-for-test');
    assert.equal(decrypt(envelope), 'pre-rotation-secret', 'old data must stay readable');
    const fresh = encrypt('post-rotation-secret');
    assert.equal(fresh.keyVersion, envelope.keyVersion + 1);
  });
});
