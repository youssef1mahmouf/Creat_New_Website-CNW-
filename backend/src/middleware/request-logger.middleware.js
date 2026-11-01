/**
 * Runtime request/response tracing.
 *
 * Prints ONE line per request and ONE per response (no body, no headers, no
 * cookies, no tokens):
 *   [09:25:13] [REQUEST]  GET  /api/health
 *   [09:25:13] [RESPONSE] 200  GET  /api/health  4ms
 *
 * - A short request id is generated, echoed back in `X-Request-Id` and shown in
 *   error blocks so a failing request can be correlated.
 * - Query values of sensitive keys (token, password, code, ...) are redacted.
 * - Static assets and CORS preflights are logged at DEBUG level (hidden by
 *   default) so the console stays free of noise.
 */
const crypto = require('crypto');
const config = require('../config/env');
const logger = require('../utils/logger');
const terminal = require('../utils/terminal');

const ASSET_RE = /\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|mp4|webm|txt|xml)$/i;
const SENSITIVE_QUERY_RE = /(token|password|secret|apikey|api_key|key|code|otp|signature|authorization|refresh)/i;

/** Path + query with sensitive query values redacted. */
function safePath(originalUrl) {
  const [pathname, query] = String(originalUrl || '/').split('?');
  if (!query) return pathname;
  const cleaned = query
    .split('&')
    .map((pair) => {
      const [key, value] = pair.split('=');
      return SENSITIVE_QUERY_RE.test(key) ? `${key}=[REDACTED]` : (value === undefined ? key : `${key}=${value}`);
    })
    .join('&');
  return `${pathname}?${cleaned}`;
}

/** Status code coloring: 2xx green, 3xx cyan, 4xx yellow, 5xx red. */
function statusPaint(status) {
  const color = status >= 500 ? 'red' : status >= 400 ? 'yellow' : status >= 300 ? 'cyan' : 'green';
  return terminal.paint(String(status), color);
}

function milliseconds(startedAt) {
  return `${(Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(1)}ms`;
}

function requestLogger(req, res, next) {
  // Tests stay silent; the middleware adds no behavior beyond tracing.
  if (config.isTest) return next();

  const startedAt = process.hrtime.bigint();
  const requestId = String(req.get('x-request-id') || crypto.randomUUID()).slice(0, 8);
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  const path = safePath(req.originalUrl);
  const isAsset = !path.startsWith('/api') && ASSET_RE.test(path.split('?')[0]);
  const level = isAsset || req.method === 'OPTIONS' ? 'debug' : 'info';
  // Debug-level traces (static assets, preflights) stay visually distinct so a
  // hidden-by-default line is obvious when LOG_LEVEL=debug is enabled.
  const prefix = `${terminal.paint(`[${logger.clock()}]`, 'gray')} `
    + (level === 'debug' ? `${terminal.paint('[DEBUG] ', 'gray')} ` : '');

  if (logger.enabled(level)) {
    if (logger.format === 'json') {
      logger.debug('http_request', { category: 'request', method: req.method, path, requestId });
    } else {
      terminal.print(`${prefix}${terminal.paint('[REQUEST] ', 'cyan')} ${req.method.padEnd(6, ' ')} ${path}`);
    }
  }

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const { statusCode } = res;
    const size = res.getHeader('content-length');
    if (!logger.enabled(level)) return;
    if (logger.format === 'json') {
      logger.debug('http_response', {
        category: 'response', method: req.method, path, status: statusCode,
        durationMs: Math.round(durationMs), requestId,
      });
    } else {
      terminal.print(
        `${prefix}${terminal.paint('[RESPONSE]', 'cyan')} `
        + `${statusPaint(statusCode)} ${req.method.padEnd(6, ' ')} ${path}  `
        + `${terminal.paint(milliseconds(startedAt), 'gray')}`
        + (size ? `  ${terminal.paint(`${size}B`, 'gray')}` : '')
      );
    }
  });

  next();
}

module.exports = { requestLogger, safePath };