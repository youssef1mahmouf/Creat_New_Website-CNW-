/**
 * Mail templates — copy + links separated from delivery logic.
 * Every template returns { subject, text }. No secrets are embedded.
 * Tokens/links are passed in by the caller and never logged here.
 */
const config = require('../config/env');

function hello(user) {
  return (user && user.name) || 'there';
}

function emailVerification(user, link) {
  return {
    subject: 'CNW — Verify your email address',
    text: `Hello ${hello(user)},\n\nThanks for creating a CNW account. Please verify your email within 24 hours:\n\n${link}\n\nIf you did not create this account, you can safely ignore this email.\n\n— CNW`,
  };
}

function passwordReset(user, link, ttlMinutes) {
  return {
    subject: 'CNW — Reset your password',
    text: `Hello ${hello(user)},\n\nWe received a request to reset your CNW password.\nOpen this link within ${ttlMinutes} minutes to choose a new password:\n\n${link}\n\nIf you did not request this, you can safely ignore this email.\n\n— CNW Security`,
  };
}

function passwordChanged(user) {
  return {
    subject: 'CNW — Your password was changed',
    text: `Hello ${hello(user)},\n\nThis is a confirmation that the password for ${user.email} was just changed.\nIf this was you, no further action is needed.\nIf you did not do this, reset your password immediately and contact support.\n\n— CNW Security`,
  };
}

function orderConfirmation(user, order) {
  const id = String(order.id || '').slice(0, 8).toUpperCase();
  const lines = (order.items || []).map((i) => `- ${i.name} x${i.quantity} — ${Number(i.unitPrice * i.quantity).toFixed(2)} ${i.currency || order.currency}`).join('\n');
  return {
    subject: `CNW — Order ${id} confirmed`,
    text: `Hi ${hello(user)},\n\nYour payment of ${Number(order.total).toFixed(2)} ${order.currency} was confirmed.\nOrder ${id}:\n${lines}\n\nDownload your items from My Products. Thank you for choosing CNW!\n\n— CNW`,
  };
}

function paymentResult(user, payment, ok) {
  return {
    subject: ok ? `CNW — Payment ${Number(payment.amount).toFixed(2)} ${payment.currency} confirmed` : 'CNW — Payment failed',
    text: ok
      ? `Hi ${hello(user)},\n\nYour payment of ${Number(payment.amount).toFixed(2)} ${payment.currency} (ref ${String(payment.providerRef || '').slice(0, 24)}) was confirmed.\n\n— CNW`
      : `Hi ${hello(user)},\n\nYour payment of ${Number(payment.amount).toFixed(2)} ${payment.currency} could not be completed (status: ${payment.status}).\nNo entitlement was created. Please try again or contact support.\n\n— CNW`,
  };
}

function securityNotice(user, message) {
  return {
    subject: '[CNW] Security notice for your account',
    text: `Hello ${hello(user)},\n\n${message}\n\nIf this was not you, please reset your password and contact support.\n\n— CNW Security`,
  };
}

function adminNotification(subject, body) {
  return { subject: `[CNW] ${subject}`, text: `${body}\n\n— CNW System` };
}

function clientUrl() {
  return config.clientUrl;
}

module.exports = {
  emailVerification, passwordReset, passwordChanged,
  orderConfirmation, paymentResult, securityNotice, adminNotification, clientUrl,
};
