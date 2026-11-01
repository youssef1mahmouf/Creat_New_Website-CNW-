/**
 * Backup service — encrypted, restorable database backups.
 * Backup keys come from BACKUP_ENCRYPTION_KEY (env) and are protected
 * separately from the primary encryption keys.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config/env');
const db = require('./db.service');
const { encrypt, decrypt } = require('../security/encryption');
const audit = require('./audit.service');

function backupDir() {
  const dir = path.join(__dirname, '..', '..', 'database', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function envelopeEncrypt(dataBuf) {
  // Backups use the dedicated backup key when provided; otherwise fall back to
  // the primary key manager envelope (still AES-256-GCM authenticated).
  if (!config.secrets.backup) return encrypt(dataBuf.toString('base64'));
  const key = crypto.createHash('sha256').update(config.secrets.backup).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(dataBuf), cipher.final()]);
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    keyVersion: 'backup',
    alg: 'aes-256-gcm',
  };
}

function envelopeDecrypt(envelope) {
  if (envelope.keyVersion === 'backup') {
    if (!config.secrets.backup) throw new Error('Backup key unavailable');
    const key = crypto.createHash('sha256').update(config.secrets.backup).digest();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm', key, Buffer.from(envelope.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
  }
  return Buffer.from(decrypt(envelope), 'base64');
}

async function createBackup(actorId = null) {
  const tables = Object.keys(db.definitions);
  const dump = {};
  for (const table of tables) {
    const { docs } = await db.find(table, {}, { page: 1, limit: 100000 });
    dump[table] = docs;
  }
  const json = Buffer.from(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), tables: dump }));
  const envelope = envelopeEncrypt(json);
  const name = `backup-${Date.now()}.enc.json`;
  const file = path.join(backupDir(), name);
  fs.writeFileSync(file, JSON.stringify(envelope, null, 2));
  await audit.log({ actorId, action: 'backup_created', category: 'security', target: name });
  return { name, file, size: fs.statSync(file).size, tables: tables.length };
}

async function listBackups() {
  const dir = backupDir();
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.enc.json'))
    .map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size, createdAt: fs.statSync(path.join(dir, f)).mtime }));
}

async function restoreBackup(name, actorId = null, { mode = 'empty-only' } = {}) {
  if (!/^backup-\d+\.enc\.json$/.test(name)) throw new Error('Invalid backup name');
  if (!['empty-only', 'merge'].includes(mode)) throw new Error('Invalid restore mode');
  const file = path.join(backupDir(), name);
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!envelope || !envelope.ciphertext || !envelope.iv || !envelope.tag || envelope.alg !== 'aes-256-gcm') {
    throw new Error('Invalid backup envelope');
  }
  const json = envelopeDecrypt(envelope).toString('utf8');
  const dump = JSON.parse(json);
  if (!dump || dump.version !== 1 || typeof dump.tables !== 'object') {
    throw new Error('Unsupported backup version');
  }
  const perTable = {};
  let restored = 0;
  let skipped = 0;
  for (const [table, docs] of Object.entries(dump.tables || {})) {
    if (!db.definitions[table] || !Array.isArray(docs)) {
      perTable[table] = { restored: 0, skipped: Array.isArray(docs) ? docs.length : 0, reason: 'unknown table' };
      skipped += Array.isArray(docs) ? docs.length : 0;
      continue;
    }
    const existing = await db.count(table);
    if (existing > 0 && mode === 'empty-only') {
      perTable[table] = { restored: 0, skipped: docs.length, reason: 'non-empty table (use mode=merge)' };
      skipped += docs.length;
      continue;
    }
    let tableRestored = 0;
    const existingIds = new Set();
    if (mode === 'merge') {
      const { docs: current } = await db.find(table, {}, { page: 1, limit: 100000 });
      for (const c of current) existingIds.add(c.id);
    }
    for (const doc of docs) {
      if (mode === 'merge' && doc && doc.id && existingIds.has(doc.id)) {
        skipped += 1;
        continue;
      }
      await db.create(table, doc);
      restored += 1;
      tableRestored += 1;
    }
    perTable[table] = { restored: tableRestored, skipped: docs.length - tableRestored };
  }
  await audit.log({ actorId, action: 'backup_restored', category: 'security', target: name, metadata: { restored, skipped, mode } });
  return { restored, skipped, mode, perTable };
}

module.exports = { createBackup, listBackups, restoreBackup };
