/**
 * Mail service — SMTP delivery with dev/log fallback.
 *
 * Transports (in priority order):
 *   1. SMTP via nodemailer (MAIL_ENABLED=true + MAIL_HOST/MAIL_USER/MAIL_PASS).
 *   2. Dev/log delivery — every mail is persisted to the `mail_outbox` table
 *      (so it is never lost) and recorded in the dev log for preview.
 *      Real delivery is never pretended: dev rows carry provider `log`.
 *
 * Production: enabling MAIL_ENABLED without host/user/pass fails CLOSED
 * (row marked failed with a configuration error) instead of silently
 * pretending delivery succeeded.
 *
 * Sending NEVER throws: errors are captured on the record so the request
 * that triggered the mail is not broken by e-mail problems.
 */
const db = require('./db.service');
const config = require('../config/env');
const logger = require('../utils/logger');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { nodemailer = null; }

/** True only when dev tokens may be exposed (never production). */
function devTokenAllowed() {
  return !config.isProduction && config.mail.devTokens === true;
}

/**
 * Queue + send an email.
 * @returns {Promise<{id, ok, provider, devUrl?, error?}>}
 */
async function sendMail({ to, subject, text, html = '' }) {
  const record = {
    to: String(to || '').slice(0, 320),
    subject: String(subject || '').slice(0, 200),
    text: String(text || '').slice(0, 20000),
    html: String(html || '').slice(0, 50000),
  };
  let mail = await db.create('mail_outbox', {
    ...record, status: 'queued', attempts: 0, error: '', provider: '',
  });
  const result = await deliver(mail);
  mail = await db.update('mail_outbox', mail.id, {
    status: result.ok ? 'sent' : 'failed',
    provider: result.provider || '',
    attempts: 1,
    error: result.error || '',
  });
  await require('./audit.service').log({
    action: result.ok ? 'email_sent' : 'email_failed',
    category: 'general',
    target: mail.id,
    metadata: { to: record.to, subject: record.subject, provider: result.provider || '' },
  }).catch(() => {});
  return { id: mail.id, ok: result.ok, provider: result.provider, devUrl: result.devUrl, error: result.error };
}

/** Retry a failed outbox row (admin operation). */
async function retryMail(id) {
  const mail = await db.findById('mail_outbox', id);
  if (!mail) {
    const ApiError = require('../utils/api-error');
    throw ApiError.notFound('Mail not found');
  }
  if (mail.status === 'sent') return { id: mail.id, ok: true, provider: mail.provider };
  const attempts = Number(mail.attempts || 0);
  if (attempts >= (config.mail.retryMax || 3)) {
    const ApiError = require('../utils/api-error');
    throw ApiError.badRequest('Retry limit reached for this email');
  }
  const result = await deliver(mail);
  const updated = await db.update('mail_outbox', mail.id, {
    status: result.ok ? 'sent' : 'failed',
    provider: result.provider || mail.provider || '',
    attempts: attempts + 1,
    error: result.error || '',
  });
  return { id: updated.id, ok: result.ok, provider: result.provider, error: result.error };
}

async function deliver(mail) {
  if (config.mail.enabled) {
    if (config.isProduction && (!config.mail.host || !config.mail.user || !config.mail.pass)) {
      return {
        ok: false,
        provider: 'smtp',
        error: 'Email is enabled but MAIL_HOST/MAIL_USER/MAIL_PASS are missing. Set them in backend/.env.',
      };
    }
    if (!nodemailer) {
      return {
        ok: false,
        provider: 'smtp',
        error: 'nodemailer is not installed — run: cd backend && npm install nodemailer',
      };
    }
    try {
      const transporter = nodemailer.createTransport({
        host: config.mail.host,
        port: config.mail.port,
        secure: config.mail.secure,
        auth: { user: config.mail.user, pass: config.mail.pass },
      });
      const result = await transporter.sendMail({
        from: config.mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html || undefined,
      });
      if (result && result.rejected && result.rejected.length) {
        throw new Error(`SMTP rejected recipients: ${result.rejected.join(', ')}`);
      }
      return { ok: true, provider: 'smtp' };
    } catch (err) {
      return { ok: false, provider: 'smtp', error: String(err.message || err).slice(0, 500) };
    }
  }

  // Dev delivery — persisted in the outbox and visible in the Admin dashboard.
  logger.info('mail_queued_dev_delivery', { id: mail.id, to: mail.to, subject: mail.subject });
  return { ok: true, provider: 'log', devUrl: `/api/mail/${mail.id}` };
}

/** Admin: list the outbox (previews / statuses). */
async function listOutbox({ page = 1, limit = 50, status } = {}) {
  const query = {};
  if (status) query.status = status;
  const result = await db.find('mail_outbox', query, { page, limit, sort: '-createdAt' });
  return result;
}

module.exports = { sendMail, retryMail, listOutbox, devTokenAllowed };