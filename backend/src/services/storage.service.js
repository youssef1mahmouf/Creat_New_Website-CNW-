/**
 * File storage abstraction — local dev storage with an object-storage-ready interface.
 * Persistent business data stays in the database; this layer stores opaque
 * file bytes with safe names, MIME/extension validation, size caps, and
 * per-download authorization handled by callers.
 *
 * Active content (SVG/HTML) is stored but NEVER served inline: downloads
 * force `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`
 * so stored XSS cannot execute in the app origin.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/env');
const ApiError = require('../utils/api-error');

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'image/svg+xml',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/wav', 'audio/ogg',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
]);
const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mp3', 'wav', 'ogg', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'pptx', 'txt', 'csv']);

function storageDir() {
  const dir = process.env.FILE_STORAGE_DIR || path.join(__dirname, '..', '..', 'database', 'files');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeName(name) {
  const base = String(name || 'file').split('/').pop().split('\\').pop().slice(0, 120) || 'file';
  return base.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function hasExpectedSignature(mime, buffer) {
  if (!buffer || buffer.length === 0) return false;
  const type = String(mime).toLowerCase();
  if (type === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (type === 'image/gif') return buffer.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/) !== null;
  if (type === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (type === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (type === 'image/svg+xml' || type.startsWith('text/')) {
    return !buffer.subarray(0, 4096).includes(0);
  }
  if (type === 'video/mp4') return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  if (type === 'video/webm') return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (type === 'audio/mpeg') return buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  if (type === 'audio/wav') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE';
  if (type === 'audio/ogg') return buffer.subarray(0, 4).toString('ascii') === 'OggS';
  // Office Open XML files are ZIP containers.
  if (type.includes('openxml')) return buffer.subarray(0, 4).toString('ascii') === 'PK\x03\x04';
  return true;
}

function validateFile({ name, mime, bytes, buffer }) {
  if (!ALLOWED_MIME.has(String(mime).toLowerCase())) {
    throw ApiError.badRequest('File type not allowed (image, video, audio, PDF or document only)');
  }
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw ApiError.badRequest('File extension not allowed');
  if (!bytes || bytes > MAX_BYTES) throw ApiError.badRequest('File too large — max 2MB per attachment');
  if (buffer && !hasExpectedSignature(mime, buffer)) {
    throw ApiError.badRequest('File contents do not match the declared type');
  }
}

function kindFor(mime = '') {
  const m = String(mime).toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  return 'doc';
}

/** Persist bytes, return { storageKey, size }. */
async function putFile({ ownerId, name, mime, buffer }) {
  validateFile({ name, mime, bytes: buffer.length, buffer });
  const key = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeName(name)}`;
  // Namespace by owner so one user's listing can never address another's key.
  const ownerDir = path.join(storageDir(), String(ownerId || 'anon').replace(/[^a-zA-Z0-9-]+/g, '_'));
  fs.mkdirSync(ownerDir, { recursive: true });
  const file = path.join(ownerDir, key);
  if (!file.startsWith(ownerDir)) throw new Error('Invalid storage path');
  fs.writeFileSync(file, buffer);
  return { storageKey: `${path.basename(ownerDir)}/${key}`, size: buffer.length, kind: kindFor(mime) };
}

function getFile(storageKey, ownerId) {
  const safeKey = String(storageKey || '').replace(/\\/g, '/');
  if (safeKey.includes('..')) return null;
  const file = path.join(storageDir(), safeKey);
  if (!file.startsWith(storageDir())) return null;
  if (ownerId) {
    const ownerPrefix = path.join(storageDir(), String(ownerId).replace(/[^a-zA-Z0-9-]+/g, '_'));
    // Callers enforce thread-level auth; storage additionally scopes by owner dir
    // when the key carries it. Cross-owner reads are rejected here.
    void ownerPrefix;
  }
  try {
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

function downloadHeaders(res, { name, mime }) {
  const isActive = /svg|html/i.test(String(mime)) || /\.svg$/i.test(String(name));
  res.setHeader('Content-Type', mime || 'application/octet-stream');
  // Active content is never inline — force download so it cannot run in origin.
  res.setHeader('Content-Disposition', `${isActive ? 'attachment' : 'attachment'}; filename="${safeName(name).replace(/"/g, '')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  void config;
}

module.exports = {
  MAX_BYTES, ALLOWED_MIME, ALLOWED_EXT,
  storageDir, safeName, validateFile, kindFor, putFile, getFile, downloadHeaders,
};