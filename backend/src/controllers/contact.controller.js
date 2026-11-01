/**
 * Contact controller — stores inquiries and notifies the owner
 * via the configured email + SMS channels (never blocks the response).
 */
const db = require('../services/db.service');
const mail = require('../services/mail.service');
const sms = require('../services/sms.service');
const config = require('../config/env');
const asyncHandler = require('../utils/async-handler');

exports.submit = asyncHandler(async (req, res) => {
  // ---- Anti-spam: honeypot + time-trap (silent drop, fake success for bots) ----
  const honeypot = String(req.body.honeypot || '').trim();
  const elapsedMs = Number(req.body.elapsedMs || 999999);
  if (honeypot || elapsedMs < 2000) {
    return res.status(201).json({
      success: true,
      id: 'filtered',
      message: 'Inquiry received.',
      notified: { mail: { ok: true }, sms: { ok: true } },
    });
  }

  const name = String(req.body.name || '').slice(0, 100);
  const email = String(req.body.email || '').slice(0, 200).toLowerCase().trim();
  const phone = String(req.body.phone || '').slice(0, 40);
  const type = String(req.body.type || 'general').slice(0, 60);
  const message = String(req.body.message || '').slice(0, 4000);

  const record = await db.create('contact_messages', {
    name, email, phone, type, message,
    status: 'new',
    userId: req.user ? req.user.id : null,
    ip: req.ip,
  });

  // Notify the owner — best effort, failures recorded but never propagated.
  let mailResult = null;
  let smsResult = null;
  try {
    await mail.sendMail({
      to: config.notify.adminEmail,
      subject: `[CNW] New contact: ${type} — ${name}`,
      text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\nType: ${type}\n\n${message}`,
    });
    mailResult = { ok: true };
  } catch (e) {
    mailResult = { ok: false, error: e.message };
  }
  if (config.notify.adminPhone) {
    try {
      await sms.sendSms({
        to: config.notify.adminPhone,
        message: `[CNW] ${name} (${email}): ${message.slice(0, 140)}`,
      });
      smsResult = { ok: true };
    } catch (e) {
      smsResult = { ok: false, error: e.message };
    }
  }

  res.status(201).json({
    success: true,
    id: record.id,
    message: 'Inquiry received.',
    notified: { mail: mailResult, sms: smsResult },
  });
});

exports.list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const result = await db.find('contact_messages', {}, { page, limit, sort: '-createdAt' });
  res.json({ success: true, ...result });
});

exports.markRead = asyncHandler(async (req, res) => {
  const doc = await db.findById('contact_messages', req.params.id);
  if (!doc) {
    const ApiError = require('../utils/api-error');
    throw ApiError.notFound('Message not found');
  }
  const updated = await db.update('contact_messages', req.params.id, { status: req.body.status || 'read' });
  res.json({ success: true, doc: updated });
});

/** Admin: preview a specific email that was queued (dev delivery). */
exports.mailPreview = asyncHandler(async (req, res) => {
  const doc = await db.findById('mail_outbox', req.params.id);
  if (!doc) {
    const ApiError = require('../utils/api-error');
    throw ApiError.notFound('Mail not found');
  }
  res.json({ success: true, mail: doc });
});

/** Admin: list email outbox. */
exports.mailList = asyncHandler(async (req, res) => {
  const result = await mail.listOutbox({
    page: Math.max(1, parseInt(req.query.page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50)),
    status: req.query.status,
  });
  res.json({ success: true, ...result });
});

/** Admin: list email outbox. */
exports.smsList = asyncHandler(async (req, res) => {
  const result = await sms.listOutbox({
    page: Math.max(1, parseInt(req.query.page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50)),
    status: req.query.status,
  });
  res.json({ success: true, ...result });
});

/** Admin: retry a failed email. */
exports.retryMail = asyncHandler(async (req, res) => {
  const result = await mail.retryMail(req.params.id);
  await require('../services/audit.service').log({
    actorId: req.user.id, actorEmail: req.user.email, action: 'admin_action',
    category: 'admin', target: req.params.id, metadata: { op: 'mail_retry', ok: result.ok },
  }).catch(() => {});
  res.json({ success: true, result });
});