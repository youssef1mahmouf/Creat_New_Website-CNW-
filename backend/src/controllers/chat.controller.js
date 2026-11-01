/**
 * Chat controller — in-site WhatsApp-style messaging.
 * Users can chat with each other AND with admins/support, exactly like the
 * Tohama reference chat. Messages are stored in the `chat_messages` JSON/Mongo
 * collection; the frontend polls for new messages (no websockets needed).
 *
 * Rich attachments (Tohama-style: image / video / pdf / audio / document):
 *  - POST /api/chat/attachments accepts a small file as a base64 data-URL
 *    (≤2MB) and stores it in `chat_attachments`, returning an attachmentId.
 *  - POST /api/chat/messages accepts { attachmentId } with optional text.
 *  - GET  /api/chat/attachments/:id streams the file back (only to a
 *    participant of the linked thread — never public).
 */
const db = require('../services/db.service');
const asyncHandler = require('../utils/async-handler');
const ApiError = require('../utils/api-error');

// 2MB cap keeps the JSON store fast; larger files are rejected with a hint.
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = /^(image\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+|application\/pdf|application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))|text\/(plain|csv))$/i;

function kindFor(mime = '') {
  const m = String(mime).toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  return 'doc';
}

function publicMessage(m) {
  return {
    id: m.id, from: m.from, to: m.to, text: m.text || '', read: m.read,
    attachmentId: m.attachmentId || null,
    attachmentKind: m.attachmentKind || '',
    attachmentName: m.attachmentName || '',
    attachmentMime: m.attachmentMime || '',
    attachmentSize: m.attachmentSize || 0,
    createdAt: m.createdAt,
  };
}

/** GET /api/chat/contacts — support + recent threads only (no PII dump). */
exports.contacts = asyncHandler(async (req, res) => {
  const me = req.user.id;
  const [a, b] = await Promise.all([
    db.find('chat_messages', { from: me }, { limit: 200, sort: '-createdAt' }),
    db.find('chat_messages', { to: me }, { limit: 200, sort: '-createdAt' }),
  ]);
  const peerIds = new Set();
  for (const m of a.docs.concat(b.docs)) {
    const peer = m.from === me ? m.to : m.from;
    if (peer) peerIds.add(peer);
  }
  // Always include support accounts so users can start a help thread.
  const { docs: support } = await db.find('users', { status: 'active', role: { $in: ['admin', 'super_admin'] } }, { limit: 20, sort: '-lastLoginAt' });
  for (const s of support) peerIds.add(s.id);
  const contacts = [];
  for (const id of [...peerIds].slice(0, 50)) {
    if (id === me) continue;
    const u = await db.findById('users', id);
    if (!u || u.status !== 'active') continue;
    const isSupport = ['admin', 'super_admin'].includes(u.role);
    contacts.push({
      id: u.id,
      name: u.name || u.email,
      role: u.role,
      business: isSupport ? (u.business || '') : '',
      // Private contact details are only shared for support accounts.
      whatsapp: isSupport ? (u.whatsapp || '') : '',
      isSupport,
      lastLoginAt: u.lastLoginAt,
    });
  }
  contacts.sort((x, y) => Number(y.isSupport) - Number(x.isSupport));
  res.json({ success: true, contacts });
});

/** GET /api/chat/messages?peer=<userId> — full thread with one contact. */
exports.messages = asyncHandler(async (req, res) => {
  const peer = String(req.query.peer || '');
  if (!peer) throw ApiError.badRequest('peer is required');
  const me = req.user.id;

  // Query only this thread (both directions) instead of scanning every message.
  const [a, b] = await Promise.all([
    db.find('chat_messages', { from: me, to: peer }, { limit: 200, sort: 'createdAt' }),
    db.find('chat_messages', { from: peer, to: me }, { limit: 200, sort: 'createdAt' }),
  ]);
  const thread = a.docs.concat(b.docs)
    .filter((m) => !m.archived)
    .sort((x, y) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : 0))
    .slice(-200);

  // Mark the peer's messages as read.
  const unread = thread.filter((m) => m.to === me && !m.read);
  for (const m of unread) {
    await db.update('chat_messages', m.id, { read: true }).catch(() => {});
  }

  const peerUser = await db.findById('users', peer);
  res.json({
    success: true,
    messages: thread.map(publicMessage),
    peer: peerUser ? {
      id: peerUser.id,
      name: peerUser.name || peerUser.email,
      role: peerUser.role,
      business: peerUser.business || '',
      whatsapp: peerUser.whatsapp || '',
      isSupport: ['admin', 'super_admin'].includes(peerUser.role),
    } : null,
    unreadMarked: unread.length,
  });
});

/** GET /api/chat/unread — unread counts per contact (badge in the header). */
exports.unread = asyncHandler(async (req, res) => {
  const me = req.user.id;
  const { docs } = await db.find('chat_messages', { to: me }, { limit: 500, sort: '-createdAt' });
  const counts = {};
  for (const m of docs) {
    if (!m.read) counts[m.from] = (counts[m.from] || 0) + 1;
  }
  res.json({ success: true, counts, total: Object.values(counts).reduce((s, n) => s + n, 0) });
});

/** POST /api/chat/messages { peer, text?, attachmentId? } — send a message. */
exports.send = asyncHandler(async (req, res) => {
  const peer = String(req.body.peer || '');
  const text = String(req.body.text || '').trim().slice(0, 2000);
  const attachmentId = req.body.attachmentId ? String(req.body.attachmentId) : null;
  if (!peer || (!text && !attachmentId)) throw ApiError.badRequest('peer and text (or an attachment) are required');
  if (peer === req.user.id) throw ApiError.badRequest('You cannot message yourself');

  const peerUser = await db.findById('users', peer);
  if (!peerUser || peerUser.status !== 'active') throw ApiError.notFound('Contact not found');

  // Attachments must belong to the sender and be unclaimed (claimed once).
  let attachment = null;
  if (attachmentId) {
    attachment = await db.findById('chat_attachments', attachmentId);
    if (!attachment || attachment.ownerId !== req.user.id) throw ApiError.badRequest('Invalid attachment');
    if (attachment.messageId) throw ApiError.badRequest('Attachment already sent');
  }

  const message = await db.create('chat_messages', {
    from: req.user.id,
    to: peer,
    text,
    read: false,
    attachmentId: attachment ? attachment.id : null,
    attachmentKind: attachment ? attachment.kind : '',
    attachmentName: attachment ? attachment.name : '',
    attachmentMime: attachment ? attachment.mime : '',
    attachmentSize: attachment ? attachment.size : 0,
  });
  if (attachment) {
    await db.update('chat_attachments', attachment.id, { messageId: message.id }).catch(() => {});
  }
  res.status(201).json({ success: true, message: publicMessage(message) });
});

/**
 * POST /api/chat/attachments { name, mime, size, dataUrl } — upload a file.
 * The file must be sent as a base64 data-URL (≤2MB after decode). Returns
 * { attachmentId, kind, name, mime, size } to reference from a message.
 */
exports.upload = asyncHandler(async (req, res) => {
  const storage = require('../services/storage.service');
  const name = String(req.body.name || 'file').slice(0, 120);
  const mime = String(req.body.mime || '').slice(0, 120);
  const dataUrl = String(req.body.dataUrl || '');
  if (!dataUrl.startsWith('data:')) throw ApiError.badRequest('dataUrl must be a base64 data-URL');
  const b64 = dataUrl.split(',')[1] || '';
  const approxBytes = Math.floor((b64.length * 3) / 4);
  storage.validateFile({ name, mime, bytes: approxBytes });
  if (!b64) throw ApiError.badRequest('dataUrl must be a base64 data-URL');
  const buffer = Buffer.from(b64, 'base64');
  const stored = await storage.putFile({ ownerId: req.user.id, name, mime, buffer });
  const attachment = await db.create('chat_attachments', {
    ownerId: req.user.id,
    name: storage.safeName(name),
    mime,
    size: stored.size,
    kind: stored.kind,
    storageKey: stored.storageKey,
    dataUrl: '',
  });
  await require('../services/audit.service').log({
    actorId: req.user.id, action: 'file_uploaded', category: 'general',
    target: attachment.id, metadata: { mime, size: stored.size },
  }).catch(() => {});
  res.status(201).json({
    success: true,
    attachment: {
      id: attachment.id, kind: attachment.kind, name: attachment.name,
      mime: attachment.mime, size: attachment.size,
    },
  });
});

/**
 * GET /api/chat/attachments/:id — download/stream the file.
 * Only the uploader or the other participant of the linked thread may read it.
 * Active content (SVG/HTML) is forced to download, never rendered inline.
 */
exports.download = asyncHandler(async (req, res) => {
  const attachment = await db.findById('chat_attachments', req.params.id);
  if (!attachment) throw ApiError.notFound('Attachment not found');
  const me = req.user.id;
  let allowed = attachment.ownerId === me;
  if (!allowed && attachment.messageId) {
    const msg = await db.findById('chat_messages', attachment.messageId);
    allowed = !!msg && ((msg.from === me || msg.to === me) && !msg.archived);
  }
  if (!allowed) throw ApiError.forbidden('You cannot access this file');
  const storage = require('../services/storage.service');
  let buf = null;
  if (attachment.storageKey) buf = storage.getFile(attachment.storageKey);
  if (!buf && attachment.dataUrl) {
    const b64 = String(attachment.dataUrl || '').split(',')[1] || '';
    buf = Buffer.from(b64, 'base64');
  }
  if (!buf) throw ApiError.notFound('File bytes unavailable');
  storage.downloadHeaders(res, { name: attachment.name, mime: attachment.mime });
  await require('../services/audit.service').log({
    actorId: me, action: 'file_downloaded', category: 'general', target: attachment.id,
  }).catch(() => {});
  res.send(buf);
});

/**
 * DELETE /api/chat/messages/:id — move one message to trash (Tohama
 * trash-manager): flagged archived, hidden from threads, kept for audit.
 */
exports.remove = asyncHandler(async (req, res) => {
  const msg = await db.findById('chat_messages', req.params.id);
  if (!msg || (msg.from !== req.user.id && msg.to !== req.user.id) || msg.archived) {
    throw ApiError.notFound('Message not found');
  }
  await db.update('chat_messages', msg.id, { archived: true });
  res.json({ success: true });
});