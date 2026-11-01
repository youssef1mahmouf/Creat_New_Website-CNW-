/**
 * Audit logging service.
 * Tracks: login success/failure, logout, password change/reset, admin actions,
 * permission changes, plugin lifecycle, important config changes.
 * NEVER logs passwords, hashes, keys, tokens or API credentials.
 */
const db = require('./db.service');

const SAFE_ACTIONS = new Set([
  'login_success', 'login_failure', 'logout', 'register',
  'password_change', 'password_reset_request', 'password_reset_complete',
  'email_verify_request', 'email_verified',
  'email_sent', 'email_failed',
  'admin_action', 'permission_change', 'plugin_install', 'plugin_activate',
  'plugin_deactivate', 'config_change', 'user_created', 'user_updated',
  'user_deleted', 'backup_created', 'backup_restored', 'key_rotated',
  'order_created', 'payment_recorded', 'payment_refunded', 'coupon_redeemed',
  'coupon_created', 'subscription_started', 'subscription_cancelled',
  'subscription_expired', 'entitlement_granted', 'download', 'ai_request',
  'session_revoked', 'settings_updated', 'file_uploaded', 'file_downloaded',
  'payment_proof_submitted', 'payment_approved', 'payment_rejected',
  'plugin_route_registered',
]);

function redactMetadata(metadata = {}) {
  const out = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (/password|hash|secret|token|key|apikey|api_key|cvv|card/i.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function log({
  actorId = null,
  actorEmail = '',
  action,
  category = 'general',
  target = '',
  ip = '',
  userAgent = '',
  success = true,
  metadata = {},
}) {
  if (!SAFE_ACTIONS.has(action)) {
    // Fail closed: unknown actions are still recorded but flagged.
    category = category === 'general' ? 'uncategorized' : category;
  }
  try {
    return await db.create('audit_logs', {
      actorId,
      actorEmail,
      action,
      category,
      target,
      ip: ip ? String(ip).slice(0, 64) : '',
      userAgent: userAgent ? String(userAgent).slice(0, 250) : '',
      success,
      metadata: redactMetadata(metadata),
    });
  } catch {
    // Audit logging must never break the request flow.
    return null;
  }
}

async function list({ page = 1, limit = 50, category, action, actorId } = {}) {
  const query = {};
  if (category) query.category = category;
  if (action) query.action = action;
  if (actorId) query.actorId = actorId;
  return db.find('audit_logs', query, { page, limit, sort: '-createdAt' });
}

module.exports = { log, list };
