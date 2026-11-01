/**
 * SMS service — provider-agnostic delivery.
 *
 * Providers:
 *   SMS_PROVIDER=log      -> dev/log delivery (persisted to sms_outbox)
 *   SMS_PROVIDER=twilio   -> Twilio Messages API (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM)
 *   SMS_PROVIDER=custom   -> generic JSON webhook (SMS_CUSTOM_URL / SMS_CUSTOM_API_KEY)
 *
 * Sending NEVER throws: failures are recorded on the message row.
 */
const db = require('./db.service');
const config = require('../config/env');
const logger = require('../utils/logger');

async function sendSms({ to, message }) {
  const sms = await db.create('sms_outbox', {
    to: String(to || '').slice(0, 40),
    message: String(message || '').slice(0, 1600),
    provider: config.sms.provider,
    status: 'queued',
    error: '',
  });
  const result = await deliver(sms);
  await db.update('sms_outbox', sms.id, {
    status: result.ok ? 'sent' : 'failed',
    error: result.error || '',
  });
  return { id: sms.id, ok: result.ok, provider: result.provider, error: result.error };
}

async function deliver(sms) {
  const { provider } = config.sms;

  if (provider === 'twilio' && config.sms.twilioSid && config.sms.twilioToken && config.sms.twilioFrom) {
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.sms.twilioSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${config.sms.twilioSid}:${config.sms.twilioToken}`).toString('base64')}`,
        },
        body: new URLSearchParams({ To: sms.to, From: config.sms.twilioFrom, Body: sms.message }).toString(),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Twilio HTTP ${res.status}`);
      return { ok: true, provider: 'twilio' };
    } catch (err) {
      return { ok: false, provider: 'twilio', error: String(err.message || err).slice(0, 500) };
    }
  }

  if (provider === 'custom' && config.sms.customUrl) {
    try {
      const res = await fetch(config.sms.customUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.sms.customApiKey ? { Authorization: `Bearer ${config.sms.customApiKey}` } : {}),
        },
        body: JSON.stringify({ to: sms.to, message: sms.message }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`SMS gateway HTTP ${res.status}`);
      return { ok: true, provider: 'custom' };
    } catch (err) {
      return { ok: false, provider: 'custom', error: String(err.message || err).slice(0, 500) };
    }
  }

  logger.info('sms_queued_log_delivery', { id: sms.id, to: sms.to });
  return { ok: true, provider: 'log' };
}

async function listOutbox({ page = 1, limit = 50, status } = {}) {
  const query = {};
  if (status) query.status = status;
  const result = await db.find('sms_outbox', query, { page, limit, sort: '-createdAt' });
  return result;
}

module.exports = { sendSms, listOutbox };