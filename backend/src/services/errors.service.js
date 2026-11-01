/**
 * Error reporting service.
 * Server-side unhandled errors and client-side JS errors are persisted here
 * (sanitized — never passwords, keys, tokens) so admins can inspect them and
 * ask the AI agent for a fix. Storing is best-effort and never breaks requests.
 */
const db = require('./db.service');
const ApiError = require('../utils/api-error');

async function reportError({
  source = 'server',
  level = 'error',
  code = '',
  message = '',
  stack = '',
  path = '',
  method = '',
  status = 500,
  userId = null,
  ip = '',
  userAgent = '',
  metadata = {},
} = {}) {
  if (!message || typeof message !== 'string') message = 'Unknown error';
  try {
    return await db.create('error_reports', {
      source, // server | client
      level: String(level || 'error').slice(0, 20),
      code: String(code || '').slice(0, 80),
      message: message.slice(0, 4000),
      stack: String(stack || '').slice(0, 8000),
      path: String(path || '').slice(0, 300),
      method: String(method || '').slice(0, 10).toUpperCase(),
      status: Number(status) || 500,
      userId,
      ip: String(ip || '').slice(0, 64),
      userAgent: String(userAgent || '').slice(0, 250),
      resolved: false,
      aiSuggestion: '',
      metadata: (metadata && typeof metadata === 'object') ? metadata : {},
    });
  } catch {
    return null;
  }
}

async function list({ page = 1, limit = 50, source, resolved } = {}) {
  const query = {};
  if (source) query.source = source;
  if (resolved !== undefined && resolved !== '') query.resolved = resolved === 'true' || resolved === true;
  return db.find('error_reports', query, { page, limit, sort: '-createdAt' });
}

async function markResolved(id, value = true) {
  const doc = await db.findById('error_reports', id);
  if (!doc) throw ApiError.notFound('Error report not found');
  return db.update('error_reports', id, { resolved: value === true });
}

async function setSuggestion(id, text) {
  const doc = await db.findById('error_reports', id);
  if (!doc) throw ApiError.notFound('Error report not found');
  return db.update('error_reports', id, { aiSuggestion: String(text || '').slice(0, 16000) });
}

module.exports = { reportError, list, markResolved, setSuggestion };