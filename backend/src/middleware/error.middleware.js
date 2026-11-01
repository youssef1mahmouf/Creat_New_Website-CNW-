/**
 * Centralized error handling.
 * NEVER exposes stack traces, DB credentials, API keys, file paths or
 * password information to clients.
 */
const config = require('../config/env');
const logger = require('../utils/logger');
const diagnostics = require('../utils/diagnostics');
const errorsService = require('../services/errors.service');

function notFoundHandler(req, res) {
  res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Endpoint not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status = err.statusCode || 500;
  const isOperational = err.isOperational === true;

  if (!isOperational) {
    logger.error('unhandled_error', {
      message: err.message,
      path: req.originalUrl,
      requestId: req.id,
    });
    // Developer console: what happened -> where -> why -> what to do.
    // (File/function/stack lines only appear outside production.)
    if (!config.isTest) diagnostics.printRuntimeError({ scope: 'REQUEST', err, req });
    // Persist the error so admins can review it and ask the AI agent for a fix.
    // Best effort — storing must never break the response.
    errorsService.reportError({
      source: 'server',
      level: 'error',
      code: err.code || 'INTERNAL',
      message: err.message,
      stack: err.stack,
      path: req.originalUrl || req.url,
      method: req.method,
      status,
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
      metadata: { routes: String(req.route?.path || '') },
    }).catch(() => {});
  }

  const body = {
    success: false,
    code: err.code || 'INTERNAL',
    message: isOperational
      ? err.message
      : 'An unexpected error occurred. Please try again later.',
  };
  if (err.details) body.details = err.details;
  if (!config.isProduction && !config.isTest && err.stack) {
    // Stack traces only in local development, never in production responses.
    body.stack = err.stack.split('\n').slice(0, 4).join('\n');
  }
  res.status(status).json(body);
}

module.exports = { notFoundHandler, errorHandler };
