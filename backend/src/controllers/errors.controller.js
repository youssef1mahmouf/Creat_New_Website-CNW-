/** Error reporting controller — inspect + AI-fix server/client errors. */
const db = require('../services/db.service');
const errorsService = require('../services/errors.service');
const aiAgents = require('../ai/agents');
const ApiError = require('../utils/api-error');
const asyncHandler = require('../utils/async-handler');

exports.list = asyncHandler(async (req, res) => {
  const result = await errorsService.list({
    page: req.query.page,
    limit: req.query.limit,
    source: req.query.source,
    resolved: req.query.resolved,
  });
  res.json({ success: true, ...result });
});

exports.resolve = asyncHandler(async (req, res) => {
  const doc = await errorsService.markResolved(req.params.id, req.body.resolved !== false);
  res.json({ success: true, doc });
});

/** Send the (sanitized) error to the AI agent for a fix recommendation. */
exports.aiFix = asyncHandler(async (req, res) => {
  const report = await db.findById('error_reports', req.params.id);
  if (!report) throw ApiError.notFound('Error report not found');
  const result = await aiAgents.askErrorFix({ report, user: req.user });
  await errorsService.setSuggestion(req.params.id, result.suggestion);
  res.json({ success: true, suggestion: result.suggestion, offline: result.offline });
});

/** Public-ish endpoint used by the frontend to report JS errors. */
exports.clientError = asyncHandler(async (req, res) => {
  const { message, stack, path, metadata } = req.body;
  await errorsService.reportError({
    source: 'client',
    level: 'error',
    code: 'CLIENT_JS',
    message,
    stack,
    path,
    status: 0,
    userId: req.user ? req.user.id : null,
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
    metadata: metadata ? { kind: String(metadata.kind || 'js').slice(0, 40), page: String(metadata.page || '').slice(0, 120) } : {},
  });
  res.json({ success: true, reported: true });
});