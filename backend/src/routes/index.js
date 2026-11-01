/** Central route registry — add new resources here; nothing else changes. */
const express = require('express');

const auth = require('../controllers/auth.controller');
const cart = require('../controllers/cart.controller');
const orders = require('../controllers/order.controller');
const ai = require('../controllers/ai.controller');
const contact = require('../controllers/contact.controller');
const i18nCtrl = require('../controllers/i18n.controller');
const errorsCtrl = require('../controllers/errors.controller');
const admin = require('../controllers/admin.controller');
const chat = require('../controllers/chat.controller');
const store = require('../controllers/store.controller');
const coupon = require('../controllers/coupon.controller');
const report = require('../controllers/report.controller');
const plugin = require('../controllers/plugin.controller');
const subscription = require('../controllers/subscription.controller');

const { authenticate, optionalAuth, requirePermission } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const { body } = require('express-validator');
const rateLimits = require('../middleware/rate-limit.middleware');
const asyncHandler = require('../utils/async-handler');
const db = require('../services/db.service');
const { recordMount } = require('./mount-registry');

const router = express.Router();

// ---------- Health ----------
router.get('/health', asyncHandler(async (_req, res) => {
  res.json({ success: true, status: 'ok', db: db.type, time: new Date().toISOString() });
}));

// ---------- Auth ----------
const emailChain = body('email').isEmail().normalizeEmail().withMessage('Valid email required');
const passwordChain = body('password').isString().isLength({ min: 10, max: 200 });

router.post('/auth/register', rateLimits.authLimiter, validate([
  body('name').isString().isLength({ min: 2, max: 100 }),
  emailChain, passwordChain,
]), auth.register);

router.post('/auth/login', rateLimits.authLimiter,
  rateLimits.progressiveBruteForceGuard((req) => `login:${req.ip}:${String(req.body.email || '').toLowerCase()}`),
  validate([emailChain, body('password').isString().isLength({ min: 1, max: 200 })]),
  auth.login);

router.post('/auth/refresh', validate([body('refreshToken').optional().isString().isLength({ max: 512 })]), auth.refresh);
router.post('/auth/logout', optionalAuth, auth.logout);
router.get('/auth/me', authenticate, auth.me);
router.get('/auth/sessions', authenticate, auth.sessions);
router.delete('/auth/sessions/:id', authenticate, auth.revokeSession);
router.post('/auth/verify-request', authenticate, rateLimits.verifyLimiter, auth.requestVerification);
router.post('/auth/verify-email', rateLimits.verifyLimiter,
  validate([body('token').isString().isLength({ min: 10, max: 200 })]), auth.verifyEmail);

router.post('/auth/forgot-password', rateLimits.passwordResetLimiter,
  validate([emailChain]), auth.forgotPassword);

router.post('/auth/reset-password', rateLimits.passwordResetLimiter,
  validate([body('token').isString().isLength({ min: 10, max: 200 }), passwordChain]),
  auth.resetPassword);

router.post('/auth/change-password', authenticate, rateLimits.authLimiter,
  validate([body('currentPassword').isString().isLength({ min: 1, max: 200 }), body('newPassword').isString().isLength({ min: 10, max: 200 })]),
  auth.changePassword);

// ---------- Cart ----------
router.get('/cart', authenticate, cart.getCart);
router.post('/cart/items', authenticate, validate([
  body('productId').isString().isLength({ min: 1, max: 64 }),
  body('quantity').optional().isInt({ min: 1, max: 99 }),
]), cart.addItem);
router.put('/cart/items/:productId', authenticate, cart.updateItem);
router.delete('/cart/items/:productId', authenticate, cart.removeItem);
router.delete('/cart', authenticate, cart.clearCart);

// ---------- Orders & Payments ----------
router.get('/payments/providers', orders.listProviders);
router.post('/orders/checkout', authenticate, rateLimits.orderLimiter, validate([
  body('provider').optional().isString().isLength({ max: 40 }),
  body('couponCode').optional().isString().isLength({ max: 24 }),
  body('idempotencyKey').optional().isString().isLength({ max: 64 }),
  body('billingName').optional().isString().isLength({ max: 120 }),
  body('billingCountry').optional().isString().isLength({ max: 60 }),
]), orders.checkout);
router.post('/payments/:id/capture', authenticate, orders.capturePayment);
router.post('/payments/webhook/:provider', orders.webhook);
router.post('/payments/:id/refund', authenticate, requirePermission('refund:payments'), orders.refundPayment);
router.get('/orders', authenticate, orders.myOrders);
router.get('/orders/:id', authenticate, orders.getOrder);
router.get('/payments', authenticate, orders.myPayments);
router.get('/entitlements/mine', authenticate, orders.myEntitlements);
router.get('/downloads/code/:id', authenticate, orders.downloadCode);
router.get('/downloads/design/:id', authenticate, orders.downloadDesign);

// ---------- AI ----------
router.post('/ai/chat', rateLimits.aiLimiter, authenticate, requirePermission('use:user-ai'),
  validate([body('message').isString().isLength({ min: 1, max: 4000 })]), ai.userChat);

router.post('/ai/admin', rateLimits.aiLimiter, authenticate, requirePermission('use:admin-ai'),
  validate([body('message').isString().isLength({ min: 1, max: 4000 })]), ai.adminChat);

router.get('/ai/conversations', authenticate, ai.conversations);

router.post('/ai/builder', rateLimits.aiLimiter, authenticate, requirePermission('use:admin-ai'),
  validate([body('description').isString().isLength({ min: 10, max: 4000 })]), ai.builderPlan);

router.post('/ai/builder/approve', authenticate, requirePermission('use:admin-ai'),
  validate([body('plan').isObject()]), ai.approvePlan);

// ---------- Contact / i18n / Error reporting ----------
router.get('/i18n', optionalAuth, i18nCtrl.index);

router.post('/contact', rateLimits.contactLimiter, optionalAuth, validate([
  body('name').isString().isLength({ min: 2, max: 100 }),
  body('email').isEmail().withMessage('Valid email required'),
  body('message').isString().isLength({ min: 5, max: 4000 }),
  body('phone').optional().isString().isLength({ max: 40 }),
  body('type').optional().isString().isLength({ max: 60 }),
  // Anti-spam metadata (honeypot + time-trap) — never stored for humans.
  body('honeypot').optional().isString().isLength({ max: 200 }),
  body('elapsedMs').optional().isInt({ min: 0, max: 600000 }),
]), contact.submit);

router.post('/errors/client', rateLimits.errorLimiter, optionalAuth, validate([
  body('message').isString().isLength({ min: 1, max: 2000 }),
]), errorsCtrl.clientError);


// ---------- Admin: overview, users, backups, audit (canonical; resources.routes holds no duplicates) ----------
router.get('/admin/users', authenticate, requirePermission('read:users'), admin.listUsers);
router.post('/admin/users', authenticate, requirePermission('write:users'), admin.createUser);
router.get('/admin/users/:id', authenticate, requirePermission('read:users'), admin.getUser);
router.put('/admin/users/:id', authenticate, requirePermission('write:users'), admin.updateUser);
router.delete('/admin/users/:id', authenticate, requirePermission('delete:users'), admin.deleteUser);
router.get('/admin/audit', authenticate, requirePermission('read:audit'), admin.auditLogs);
router.get('/admin/audit-logs', authenticate, requirePermission('read:audit'), admin.auditLogs);
router.post('/admin/backup', authenticate, requirePermission('manage:security'), admin.createBackup);
router.get('/admin/backups', authenticate, requirePermission('manage:security'), admin.listBackups);
router.post('/admin/backup/restore', authenticate, requirePermission('manage:security'), admin.restoreBackup);

/** ---------- Admin: code store ---------- */
router.get('/admin/code-products', authenticate, requirePermission('read:products'), store.adminList);
router.post('/admin/code-products', authenticate, requirePermission('write:products'), validate([
  body('title').isString().isLength({ min: 2, max: 120 }),
  body('language').optional().isIn(['css', 'html', 'js', 'full']),
  body('price').optional().isFloat({ min: 0, max: 1000000 }),
  body('status').optional().isIn(['draft', 'published']),
]), store.create);
router.put('/admin/code-products/:id', authenticate, requirePermission('write:products'), store.update);
router.delete('/admin/code-products/:id', authenticate, requirePermission('delete:products'), store.remove);

// ---------- Admin: coupons ----------
router.get('/admin/coupons', authenticate, requirePermission('manage:coupons'), coupon.list);
router.post('/admin/coupons', authenticate, requirePermission('manage:coupons'), validate([
  body('code').isString().isLength({ min: 2, max: 24 }),
  body('percent').optional().isInt({ min: 1, max: 90 }),
  body('amountOff').optional().isFloat({ min: 0, max: 100000 }),
  body('maxUses').optional().isInt({ min: 1, max: 1000000 }),
  body('perUserLimit').optional().isInt({ min: 1, max: 1000 }),
  body('minOrder').optional().isFloat({ min: 0 }),
  body('maxDiscount').optional().isFloat({ min: 0 }),
  body('expiresAt').optional().isISO8601(),
]), coupon.create);
router.put('/admin/coupons/:id', authenticate, requirePermission('manage:coupons'), coupon.update);
router.delete('/admin/coupons/:id', authenticate, requirePermission('manage:coupons'), coupon.remove);
router.post('/admin/mail/:id/retry', authenticate, requirePermission('read:audit'), contact.retryMail);

// ---------- Admin: reports (Excel/CSV/PDF) ----------
router.get('/admin/reports/:dataset', authenticate, requirePermission('read:audit'), report.download);
router.get('/admin/reports', authenticate, requirePermission('read:audit'), report.summary);

// ---------- Admin: subscriptions & payments ----------
router.get('/admin/subscription-plans', authenticate, requirePermission('read:users'), subscription.listPlans);
router.get('/admin/orders', authenticate, requirePermission('read:orders'), admin.listOrders);
router.put('/admin/subscriptions/:id/cancel', authenticate, requirePermission('write:users'), subscription.adminCancel);
router.get('/admin/files', authenticate, requirePermission('read:files'), admin.listFiles);
router.get('/admin/errors', authenticate, requirePermission('read:audit'), errorsCtrl.list);
router.post('/admin/errors/:id/resolve', authenticate, requirePermission('read:audit'), errorsCtrl.resolve);
router.post('/admin/errors/:id/ai-fix', authenticate, requirePermission('use:admin-ai'), errorsCtrl.aiFix);
router.get('/admin/contact-messages', authenticate, requirePermission('read:audit'), contact.list);
router.post('/admin/contact-messages/:id/read', authenticate, requirePermission('read:audit'), contact.markRead);
router.get('/admin/mail', authenticate, requirePermission('read:audit'), contact.mailList);
router.get('/admin/mail/:id', authenticate, requirePermission('read:audit'), contact.mailPreview);
router.get('/admin/sms', authenticate, requirePermission('read:audit'), contact.smsList);
router.get('/admin/system', authenticate, requirePermission('read:settings'), admin.systemStatus);
router.get('/admin/settings', authenticate, requirePermission('read:settings'), admin.getSettings);
router.put('/admin/settings', authenticate, requirePermission('write:settings'), validate([
  body('settings').isObject(),
]), admin.updateSettings);

// ---------- Admin: plugins ----------
router.get('/admin/plugins', authenticate, requirePermission('read:plugins'), plugin.list);
router.post('/admin/plugins', authenticate, requirePermission('manage:plugins'), plugin.install);
router.put('/admin/plugins/:id/activate', authenticate, requirePermission('manage:plugins'), plugin.activate);
router.put('/admin/plugins/:id/deactivate', authenticate, requirePermission('manage:plugins'), plugin.deactivate);
router.delete('/admin/plugins/:id', authenticate, requirePermission('manage:plugins'), plugin.uninstall);
router.put('/admin/plugins/:id/configure', authenticate, requirePermission('manage:plugins'), plugin.configure);



// ---------- In-site Chat (WhatsApp-style, user <-> user & support) ----------
router.get('/chat/contacts', authenticate, rateLimits.chatLimiter, chat.contacts);
router.get('/chat/unread', authenticate, rateLimits.chatLimiter, chat.unread);
router.get('/chat/messages', authenticate, rateLimits.chatLimiter, chat.messages);
router.post('/chat/messages', authenticate, rateLimits.chatLimiter, validate([
  body('peer').isString().isLength({ min: 1, max: 64 }),
  body('text').optional().isString().isLength({ max: 2000 }),
  body('attachmentId').optional().isString().isLength({ max: 64 }),
]), chat.send);
// Tohama-style rich attachments: image / video / pdf / audio / document.
router.post('/chat/attachments', authenticate, rateLimits.chatLimiter, validate([
  body('name').optional().isString().isLength({ max: 120 }),
  body('mime').isString().isLength({ min: 3, max: 120 }),
  body('size').optional().isInt({ min: 1, max: 8 * 1024 * 1024 }),
  body('dataUrl').isString().isLength({ min: 10, max: 4 * 1024 * 1024 }),
]), chat.upload);
router.get('/chat/attachments/:id', authenticate, rateLimits.chatLimiter, chat.download);
router.delete('/chat/messages/:id', authenticate, rateLimits.chatLimiter, chat.remove);

// ---------- Code Store (CSS/HTML/JS snippets with live previews) ----------
router.get('/code-products', optionalAuth, store.list);
router.get('/code-products/:id', optionalAuth, store.get);
router.post('/code-products', authenticate, requirePermission('write:products'), validate([
  body('title').isString().isLength({ min: 2, max: 120 }),
  body('language').optional().isIn(['css', 'html', 'js', 'full']),
]), store.create);
router.put('/code-products/:id', authenticate, requirePermission('write:products'), store.update);
router.delete('/code-products/:id', authenticate, requirePermission('delete:products'), store.remove);

// ---------- Subscriptions (weekly / monthly update plans) ----------
router.get('/subscriptions/plans', subscription.plans);
router.post('/subscriptions/subscribe', authenticate, validate([
  body('planId').isString().isIn(['starter-weekly', 'pro-monthly', 'business-monthly']),
  body('provider').optional().isString().isLength({ max: 40 }),
  body('billingName').optional().isString().isLength({ max: 120 }),
]), subscription.subscribe);
router.get('/subscriptions/mine', authenticate, subscription.mine);
router.post('/subscriptions/:id/cancel', authenticate, subscription.cancel);
router.get('/admin/subscriptions', authenticate, requirePermission('read:payments'), subscription.adminList);

// Customers validate a code before checkout (no discount details leaked beyond %).
router.post('/coupons/validate', authenticate, validate([
  body('code').isString().isLength({ min: 1, max: 24 }),
]), coupon.validate);


// ---------- Extended user profile (WhatsApp / business info) ----------
router.put('/users/me/profile', authenticate, validate([
  body('name').optional().isString().isLength({ min: 2, max: 100 }),
  body('whatsapp').optional().isString().isLength({ max: 40 }),
  body('business').optional().isString().isLength({ max: 120 }),
  body('businessType').optional().isString().isLength({ max: 60 }),
  body('sitePurpose').optional().isString().isLength({ max: 500 }),
  body('budget').optional().isString().isLength({ max: 60 }),
  body('bio').optional().isString().isLength({ max: 1000 }),
]), auth.updateProfile);

// ---------- Resources / Admin / Plugins ----------
const resourcesRouter = require('./resources.routes');
recordMount(resourcesRouter, ''); // mounted at the /api root — see diagnostics
router.use('/', resourcesRouter);

module.exports = router;

