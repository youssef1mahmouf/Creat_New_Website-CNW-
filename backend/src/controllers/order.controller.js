/**
 * Payment provider abstraction — business logic never touches a PSP directly.
 *
 * States: pending -> processing -> succeeded | failed | cancelled
 *          succeeded -> refunded | partially_refunded
 *
 * Providers implement:
 *   initiate({ amount, currency, orderId, userId }) -> { providerRef, clientAction, status? }
 *   capture({ providerRef, amount, currency })      -> { status, providerRef }
 *   verifyWebhook({ rawBody, signature, secret })   -> { valid, providerRef, status, amount?, currency? }
 *   refund({ providerRef, amount, currency })       -> { status, providerRef }
 *
 * `manual` is a DEVELOPMENT settlement marker only. It never claims real
 * verification: capture requires explicit admin approval and is rejected in
 * production unless MANUAL_PAYMENTS_ALLOW=true is set deliberately.
 */
const db = require('../services/db.service');
const { computeTotals } = require('./cart.controller');
const ApiError = require('../utils/api-error');
const asyncHandler = require('../utils/async-handler');
const audit = require('../services/audit.service');
const mail = require('../services/mail.service');
const sms = require('../services/sms.service');
const config = require('../config/env');

/** Payment provider registry — extend this map to add providers. */
const paymentProviders = {
  // Development settlement marker. Capture is admin-approved (see capturePayment)
  // and production capture is rejected unless explicitly allowed via env.
  manual: {
    name: 'manual',
    isMock: true,
    async initiate({ amount, currency }) {
      return {
        providerRef: `MANUAL-${Date.now()}`,
        clientAction: { type: 'confirm', message: 'Manual settlement: an admin must approve this payment. Not a real PSP charge.' },
        amount, currency,
      };
    },
    async capture({ providerRef, adminApproved }) {
      if (!adminApproved) return { status: 'processing', providerRef };
      return { status: 'succeeded', providerRef };
    },
    async verifyWebhook() {
      return { valid: false, reason: 'manual provider has no webhooks' };
    },
    async refund({ providerRef }) {
      return { status: 'succeeded', providerRef };
    },
  },
  // Example placeholder showing how a future provider slots in:
  // stripe: { initiate: stripeInitiate, capture: stripeCapture, verifyWebhook: stripeWebhookVerify, refund: stripeRefund },

  // ---- Local payment methods (no PSP API) — customer submits proof, admin reviews ----
  // These providers create a 'pending' payment; the customer transfers to the
  // configured business account and later submits a reference. An admin then
  // approves or rejects via /admin/payments/:id/approve & :id/reject.
  // The destination account details live in config.payments (env.js) — never
  // secrets, just the public account info shown to customers.
  instapay: {
    name: 'instapay',
    isLocal: true,
    async initiate({ amount, currency, config: cfg }) {
      return {
        providerRef: `INSTAPAY-${Date.now()}`,
        clientAction: {
          type: 'submit_reference',
          message: `Transfer ${amount} ${currency} to ${cfg.instapay.identifier || cfg.instapay.accountName} via InstaPay. Save the transfer reference — you will submit it after checkout.`,
          instructions: cfg.instapay.instructions || '',
          destination: { name: cfg.instapay.accountName, identifier: cfg.instapay.identifier },
        },
        amount, currency,
      };
    },
    async capture() {
      // Local method: capture is NOT called by the checkout flow.
      // Status transitions happen through the admin review endpoints.
      return { status: 'processing', providerRef: '' };
    },
    async verifyWebhook() {
      return { valid: false, reason: 'instapay has no webhook' };
    },
    async refund() {
      return { status: 'succeeded', providerRef: '' };
    },
  },
  wallet: {
    name: 'wallet',
    isLocal: true,
    async initiate({ amount, currency, config: cfg }) {
      const w = cfg.wallet;
      return {
        providerRef: `WALLET-${Date.now()}`,
        clientAction: {
          type: 'submit_reference',
          message: `Transfer ${amount} ${currency} to ${w.identifier || w.accountName} (${w.provider}) via mobile wallet. Save the reference and submit it after checkout.`,
          instructions: w.instructions || '',
          destination: { name: w.accountName, identifier: w.identifier, provider: w.provider },
        },
        amount, currency,
      };
    },
    async capture() {
      return { status: 'processing', providerRef: '' };
    },
    async verifyWebhook() {
      return { valid: false, reason: 'wallet has no webhook' };
    },
    async refund() {
      return { status: 'succeeded', providerRef: '' };
    },
  },
};

exports.listProviders = (req, res) => {
  res.json({ success: true, providers: Object.keys(paymentProviders) });
};

/** POST /api/orders/checkout — creates order from cart + initiates payment. */
exports.checkout = asyncHandler(async (req, res) => {
  const result = await executeCheckout(req.user.id, {
    provider: req.body.provider,
    couponCode: req.body.couponCode,
    idempotencyKey: req.body.idempotencyKey,
    billingName: req.body.billingName,
    billingCountry: req.body.billingCountry,
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
  });
  res.status(result.reused ? 200 : 201).json({
    success: true,
    reused: Boolean(result.reused),
    order: result.order,
    payment: { ...result.payment, billingDetails: undefined },
    clientAction: result.clientAction,
  });
});

/**
 * Shared checkout logic — used by the REST route AND the AI agent so the
 * agent performs the exact same secure flow as the UI.
 * Atomic boundaries: validate -> preview coupon -> create order/payment ->
 * redeem coupon; rollback redemption + mark failed on error. Entitlements
 * are created ONLY on succeeded capture (never here).
 */
async function executeCheckout(userId, { provider = 'manual', couponCode = '', idempotencyKey = '', billingName = '', billingCountry = '', ip = '', userAgent = '' } = {}) {
  const providerName = String(provider || 'manual');
  const providerImpl = paymentProviders[providerName];
  if (!providerImpl) throw ApiError.badRequest(`Unknown payment provider: ${providerName}`);
  if (providerImpl.isMock && config.isProduction && process.env.MANUAL_PAYMENTS_ALLOW !== 'true') {
    throw ApiError.badRequest('Manual settlement is disabled in production.');
  }
  const key = String(idempotencyKey || '').slice(0, 64);
  if (key) {
    const priorPayment = await db.findOne('payments', { idempotencyKey: key, userId }).catch(() => null);
    if (priorPayment) {
      const priorOrder = await db.findById('orders', priorPayment.orderId).catch(() => null);
      if (priorOrder) {
        return { order: priorOrder, payment: priorPayment, clientAction: { type: 'none', message: 'Idempotent replay.' }, reused: true };
      }
    }
  }
  const cart = await db.findOne('carts', { userId });
  if (!cart || !cart.items.length) throw ApiError.badRequest('Cart is empty');
  const verifiedItems = [];
  for (const line of cart.items) {
    const product = await db.findById('products', line.productId).catch(() => null)
      || await db.findById('code_products', line.productId).catch(() => null);
    if (!product || product.status !== 'published') throw ApiError.badRequest(`Product unavailable: ${line.name || line.productId}`);
    if (product.availability === 'unavailable') throw ApiError.badRequest(`Product is unavailable: ${line.name || line.productId}`);
    const qty = Math.max(1, Math.min(99, Number(line.quantity) || 1));
    const kind = (product.code !== undefined || product.title) ? 'code' : (product.data !== undefined ? 'design' : 'product');
    verifiedItems.push({
      productId: line.productId, productKind: kind,
      name: product.name || product.title || line.name || 'Item',
      unitPrice: Number(product.price), currency: product.currency || line.currency || 'USD', quantity: qty,
    });
  }
  const currencies = new Set(verifiedItems.map((i) => i.currency));
  if (currencies.size > 1) throw ApiError.badRequest('Mixed currencies in cart are not supported');
  const entSvc = require('../services/entitlement.service');
  for (const item of verifiedItems) {
    if (await entSvc.hasEntitlement(userId, item.productKind, item.productId)) {
      throw ApiError.conflict(`You already own: ${item.name}`);
    }
  }
  const { subtotal, currency } = computeTotals(verifiedItems);
  let discount = 0;
  let coupon = null;
  if (couponCode) {
    const coupons = require('../services/coupon.service');
    const preview = await coupons.previewCoupon(couponCode, { userId, subtotal });
    coupon = preview.coupon;
    discount = preview.discount;
  }
  const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
  const order = await db.create('orders', {
    userId, items: verifiedItems,
    subtotal, discount, couponCode: coupon ? coupon.code : '', tax: 0, total,
    currency, status: 'pending', idempotencyKey: key,
  });
  let payment = null;
  let initiation = null;
  try {
    initiation = await providerImpl.initiate({ amount: total, currency, orderId: order.id, userId, config: config.payments });
    if (initiation && (Number(initiation.amount) !== total || String(initiation.currency) !== currency)) {
      throw ApiError.badRequest('Provider amount mismatch');
    }
    payment = await db.create('payments', {
      orderId: order.id, userId, provider: providerName,
      providerRef: initiation.providerRef || '',
      amount: total, currency, status: 'pending', idempotencyKey: key,
      billingDetails: {
        name: String(billingName || '').slice(0, 120),
        country: String(billingCountry || '').slice(0, 60),
      },
    });
    await db.update('orders', order.id, { paymentId: payment.id, status: 'processing' });
    await db.create('payment_events', {
      paymentId: payment.id, orderId: order.id, provider: providerName,
      providerRef: payment.providerRef, kind: 'initiated', status: 'pending', idempotencyKey: key,
    }).catch(() => {});
    if (coupon) {
      const coupons = require('../services/coupon.service');
      await coupons.redeemCoupon(coupon.code, { userId, orderId: order.id, subtotal });
    }
  } catch (err) {
    if (coupon) {
      const coupons = require('../services/coupon.service');
      await coupons.rollbackRedemption(order.id).catch(() => {});
    }
    await db.update('orders', order.id, { status: 'failed' }).catch(() => {});
    if (payment) await db.update('payments', payment.id, { status: 'failed' }).catch(() => {});
    throw err;
  }
  await audit.log({
    actorId: userId, action: 'order_created', category: 'general',
    target: order.id, metadata: { provider: providerName, amount: total, currency, discount, coupon: coupon ? coupon.code : '' },
    ip, userAgent,
  });
  const freshOrder = await db.findById('orders', order.id);
  return { order: freshOrder || order, payment, clientAction: (initiation && initiation.clientAction) || { type: 'none' } };
}

/** POST /api/payments/:id/capture — confirm/settle a payment via its provider. */
exports.capturePayment = asyncHandler(async (req, res) => {
  const payment = await db.findById('payments', req.params.id);
  if (!payment || payment.userId !== req.user.id) throw ApiError.notFound('Payment not found');
  if (['succeeded', 'refunded', 'partially_refunded'].includes(payment.status)) {
    return res.json({ success: true, status: payment.status, reused: true });
  }
  const provider = paymentProviders[payment.provider];
  if (!provider) throw ApiError.badRequest('Provider unavailable');
  if (provider.isLocal) throw ApiError.badRequest('Local payments require admin review — use the submit-reference flow, not capture.');
  const order = await db.findById('orders', payment.orderId);
  if (!order) throw ApiError.notFound('Order not found');
  if (Number(order.total) !== Number(payment.amount) || String(order.currency) !== String(payment.currency)) {
    throw ApiError.badRequest('Order/payment amount mismatch');
  }
  const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
  // Development convenience: the payment owner may settle a MOCK payment
  // outside production so the documented dev flow keeps working. In production
  // a mock/manual capture ALWAYS requires admin approval (plus the env gate).
  const ownerDevCapture = provider.isMock && !config.isProduction && payment.userId === req.user.id;
  if (provider.isMock && !isAdmin && !ownerDevCapture) {
    throw ApiError.forbidden('Manual settlement requires admin approval.');
  }
  if (provider.isMock && config.isProduction && process.env.MANUAL_PAYMENTS_ALLOW !== 'true') {
    throw ApiError.badRequest('Manual settlement is disabled in production.');
  }
  const result = await provider.capture({
    providerRef: payment.providerRef, amount: payment.amount, currency: payment.currency,
    adminApproved: isAdmin || ownerDevCapture,
  });
  const status = result.status === 'succeeded' ? 'succeeded' : (result.status === 'processing' ? 'processing' : 'failed');
  await db.update('payments', payment.id, { status, providerRef: result.providerRef || payment.providerRef });
  await db.update('orders', payment.orderId, { status: status === 'succeeded' ? 'paid' : (status === 'processing' ? 'processing' : 'failed') });
  if (status === 'succeeded') {
    // Entitlements are created ONLY here — after a confirmed (captured) payment.
    const entSvc = require('../services/entitlement.service');
    await entSvc.grantEntitlements({ userId: payment.userId, order, payment }).catch(() => {});
    // Activate pending subscriptions tied to this order.
    const subs = await db.find('subscriptions', { orderId: order.id, status: 'pending' }, { limit: 10 });
    for (const s of subs.docs) {
      const d = new Date();
      d.setDate(d.getDate() + (s.cadence === 'weekly' ? 7 : 30));
      await db.update('subscriptions', s.id, {
        status: 'active', startedAt: new Date().toISOString(), renewsAt: d.toISOString(),
      }).catch(() => {});
    }
    await db.updateOne('carts', { userId: req.user.id }, { items: [] }).catch(() => {});
  }
  if (status === 'failed' && order.couponCode) {
    // A failed purchase must not consume coupon usage.
    const coupons = require('../services/coupon.service');
    await coupons.rollbackRedemption(order.id).catch(() => {});
  }
  await db.create('payment_events', {
    paymentId: payment.id, orderId: payment.orderId, provider: payment.provider,
    providerRef: result.providerRef || payment.providerRef, kind: 'capture', status,
  }).catch(() => {});
  await audit.log({
    actorId: req.user.id, action: 'payment_recorded', category: 'general',
    target: payment.id, metadata: { status, provider: payment.provider, mock: Boolean(provider.isMock) },
  });

  // Notify the customer (email + SMS, best effort) on terminal states.
  try {
    const user = await db.findById('users', req.user.id);
    const templates = require('../services/mail-templates');
    const tpl = templates.paymentResult(user, payment, status === 'succeeded');
    await mail.sendMail({ to: user?.email, subject: tpl.subject, text: tpl.text });
    if (user?.phone && status === 'succeeded') {
      await sms.sendSms({ to: user.phone, message: `CNW: your payment of ${payment.amount} ${payment.currency} is confirmed. Thank you!` });
    }
  } catch { /* notifications must never break the response */ }

  res.json({ success: true, status });
});

exports.myOrders = asyncHandler(async (req, res) => {
  const result = await db.find('orders', { userId: req.user.id }, {
    page: parseInt(req.query.page, 10) || 1, limit: 20, sort: '-createdAt',
  });
  res.json({ success: true, ...result });
});

exports.myPayments = asyncHandler(async (req, res) => {
  const result = await db.find('payments', { userId: req.user.id }, {
    page: parseInt(req.query.page, 10) || 1, limit: 20, sort: '-createdAt',
  });
  // publicFields strip billing details (encrypted at rest anyway).
  res.json({
    success: true, ...result,
    docs: result.docs.map((p) => db.publicView('payments', p)),
  });
});

/** Admin: list all payments (admin permission enforced at route level). */
exports.allPayments = asyncHandler(async (req, res) => {
  const result = await db.find('payments', {}, {
    page: parseInt(req.query.page, 10) || 1, limit: 50, sort: '-createdAt',
  });
  res.json({
    success: true, ...result,
    docs: result.docs.map((p) => db.publicView('payments', p)),
  });
});
/** GET /api/orders/:id — owner or admin only (IDOR guard). */
exports.getOrder = asyncHandler(async (req, res) => {
  const order = await db.findById('orders', req.params.id);
  const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
  if (!order || (order.userId !== req.user.id && !isAdmin)) throw ApiError.notFound('Order not found');
  res.json({ success: true, order });
});

/** GET /api/entitlements/mine — the signed-in user's owned products. */
exports.myEntitlements = asyncHandler(async (req, res) => {
  const result = await db.find('entitlements', { userId: req.user.id, status: 'active' }, {
    page: parseInt(req.query.page, 10) || 1, limit: 50, sort: '-createdAt',
  });
  res.json({ success: true, ...result });
});

/**
 * GET /api/downloads/code/:id — deliver paid source code.
 * Entitlement (or free price, or admin) required; every access is logged.
 */
exports.downloadCode = asyncHandler(async (req, res) => {
  const doc = await db.findById('code_products', req.params.id);
  if (!doc || doc.status !== 'published') throw ApiError.notFound('Code product not found');
  const entSvc = require('../services/entitlement.service');
  const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
  const free = Number(doc.price) === 0;
  const ent = free ? null : await db.findOne('entitlements', {
    userId: req.user.id, productKind: 'code', productId: doc.id, status: 'active',
  });
  if (!free && !ent && !isAdmin) throw ApiError.forbidden('Purchase required to download this code');
  await entSvc.logDownload({
    userId: req.user.id, productKind: 'code', productId: doc.id,
    entitlementId: ent ? ent.id : null, ip: req.ip, userAgent: req.get('user-agent') || '',
  });
  await audit.log({ actorId: req.user.id, action: 'download', category: 'general', target: doc.id, metadata: { kind: 'code' } });
  res.json({ success: true, doc });
});

/**
 * GET /api/downloads/design/:id — deliver full design canvas.
 * Free/active designs are open; paid or draft designs require an entitlement
 * or admin role. Canvas data is sanitized (no script/html passthrough).
 */
exports.downloadDesign = asyncHandler(async (req, res) => {
  const doc = await db.findById('designs', req.params.id);
  if (!doc) throw ApiError.notFound('Design not found');
  const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
  const entSvc = require('../services/entitlement.service');
  const free = Number(doc.price || 0) === 0 && doc.status === 'active';
  const ent = free ? null : await db.findOne('entitlements', {
    userId: req.user.id, productKind: 'design', productId: doc.id, status: 'active',
  });
  if (!free && !ent && !isAdmin) throw ApiError.forbidden('Purchase required to access this design');
  await entSvc.logDownload({
    userId: req.user.id, productKind: 'design', productId: doc.id,
    entitlementId: ent ? ent.id : null, ip: req.ip, userAgent: req.get('user-agent') || '',
  });
  await audit.log({ actorId: req.user.id, action: 'download', category: 'general', target: doc.id, metadata: { kind: 'design' } });
  const { sanitizeValue } = require('../security/sanitize');
  res.json({ success: true, doc: { ...doc, data: sanitizeValue(doc.data || {}) } });
});

/**
 * POST /api/payments/webhook/:provider — provider callback entry point.
 * Every payload MUST pass provider.verifyWebhook (signature/replay checks).
 * Unverified or unknown events are rejected and audited — never trusted.
 */
exports.webhook = asyncHandler(async (req, res) => {
  const providerName = String(req.params.provider || '');
  const provider = paymentProviders[providerName];
  if (!provider || typeof provider.verifyWebhook !== 'function') {
    throw ApiError.badRequest('Unknown provider');
  }
  const verification = await provider.verifyWebhook({
    body: req.body, signature: req.get('x-signature') || '', raw: req.rawBody,
  });
  if (!verification.valid) {
    await audit.log({
      action: 'payment_recorded', category: 'security', success: false,
      metadata: { provider: providerName, reason: verification.reason || 'invalid webhook signature' },
    });
    throw ApiError.badRequest('Invalid webhook');
  }
  const payment = await db.findOne('payments', { provider: providerName, providerRef: verification.providerRef });
  if (!payment) throw ApiError.notFound('Payment not found');
  if (['succeeded', 'failed', 'refunded', 'partially_refunded'].includes(payment.status)) {
    return res.json({ success: true, status: payment.status, reused: true });
  }
  const status = verification.status === 'succeeded' ? 'succeeded' : (verification.status === 'processing' ? 'processing' : 'failed');
  if (verification.amount != null && Number(verification.amount) !== Number(payment.amount)) {
    throw ApiError.badRequest('Webhook amount mismatch');
  }
  await db.update('payments', payment.id, { status });
  await db.update('orders', payment.orderId, { status: status === 'succeeded' ? 'paid' : (status === 'processing' ? 'processing' : 'failed') });
  await db.create('payment_events', {
    paymentId: payment.id, orderId: payment.orderId, provider: providerName,
    providerRef: verification.providerRef, kind: 'webhook', status,
    idempotencyKey: verification.idempotencyKey || '',
  }).catch(() => {});
  if (status === 'succeeded') {
    const order = await db.findById('orders', payment.orderId);
    const entSvc = require('../services/entitlement.service');
    await entSvc.grantEntitlements({ userId: payment.userId, order, payment }).catch(() => {});
  }
  await audit.log({
    action: 'payment_recorded', category: 'general', target: payment.id,
    metadata: { via: 'webhook', provider: providerName, status },
  });
  res.json({ success: true, status });
});

/**
 * POST /api/payments/:id/refund — admin-only refund flow.
 * Validates the original payment, prevents duplicate/over refunds, records the
 * refund, updates payment + order states and revokes entitlements on full refund.
 */
exports.refundPayment = asyncHandler(async (req, res) => {
  const payment = await db.findById('payments', req.params.id);
  if (!payment) throw ApiError.notFound('Payment not found');
  if (payment.status !== 'succeeded' && payment.status !== 'partially_refunded') {
    throw ApiError.badRequest('Only succeeded payments can be refunded');
  }
  const order = await db.findById('orders', payment.orderId);
  if (!order) throw ApiError.notFound('Order not found');
  const provider = paymentProviders[payment.provider];
  if (!provider || typeof provider.refund !== 'function') throw ApiError.badRequest('Provider does not support refunds');

  const alreadyRefunded = Number(payment.refundedAmount || 0);
  const maxRefundable = Math.round((Number(payment.amount) - alreadyRefunded) * 100) / 100;
  if (maxRefundable <= 0) throw ApiError.badRequest('Payment is already fully refunded');
  const requested = req.body.amount !== undefined ? Math.round(Number(req.body.amount) * 100) / 100 : maxRefundable;
  if (!Number.isFinite(requested) || requested <= 0 || requested > maxRefundable) {
    throw ApiError.badRequest(`Refund amount must be between 0 and ${maxRefundable}`);
  }
  const idempotencyKey = String(req.body.idempotencyKey || '').slice(0, 64);
  if (idempotencyKey) {
    const prior = await db.findOne('refunds', { idempotencyKey, paymentId: payment.id });
    if (prior) return res.json({ success: true, reused: true, refund: prior });
  }
  const providerResult = await provider.refund({ providerRef: payment.providerRef, amount: requested, currency: payment.currency });
  if (providerResult.status !== 'succeeded') throw ApiError.badRequest('Provider refund failed');

  const refund = await db.create('refunds', {
    paymentId: payment.id, orderId: payment.orderId, userId: payment.userId,
    amount: requested, reason: String(req.body.reason || '').slice(0, 500),
    status: 'succeeded', providerRef: providerResult.providerRef || '', idempotencyKey,
  });
  const totalRefunded = Math.round((alreadyRefunded + requested) * 100) / 100;
  const fully = totalRefunded >= Number(payment.amount);
  await db.update('payments', payment.id, {
    refundedAmount: totalRefunded,
    status: fully ? 'refunded' : 'partially_refunded',
  });
  await db.update('orders', payment.orderId, { status: fully ? 'refunded' : 'partially_refunded' });
  if (fully) {
    const entSvc = require('../services/entitlement.service');
    await entSvc.revokeByOrder(payment.orderId, 'refund').catch(() => {});
  }
  await audit.log({
    actorId: req.user.id, actorEmail: req.user.email, action: 'payment_refunded',
    category: 'admin', target: payment.id,
    metadata: { amount: requested, fullyRefunded: fully, orderId: payment.orderId },
  });
  res.json({ success: true, refund, paymentStatus: fully ? 'refunded' : 'partially_refunded' });
});

// Exposed so the AI agent performs the exact same secure checkout as the UI.
exports.executeCheckout = executeCheckout;

// ---- Admin review endpoints for local payment methods (InstaPay / e-wallet) ----
// Customers using local providers submit a transfer reference after checkout.
// These endpoints let admins verify and approve/reject those submissions.

/**
 * GET /api/admin/payments/pending-review
 * List payments from local providers that are awaiting admin review.
 * Visible to anyone with approve:payments permission.
 */
exports.pendingReviewList = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const filter = {
    provider: { $in: ['instapay', 'wallet'] },
    reviewStatus: { $in: ['none', 'submitted'] },
  };
  if (req.query.status) filter.status = String(req.query.status);
  const result = await db.find('payments', filter, { page, limit, sort: '-createdAt' });
  res.json({
    success: true, ...result,
    docs: result.docs.map((p) => ({
      ...db.publicView('payments', p),
      reviewStatus: p.reviewStatus,
      customerReference: p.customerReference || '',
      payerName: p.payerName || '',
      submittedAt: p.submittedAt || null,
      proofName: p.proofName || '',
      orderTotal: p.amount,
      orderCurrency: p.currency,
    })),
  });
});

/**
 * POST /api/admin/payments/:id/approve
 * Approve a local-payment submission: move reviewStatus to 'approved' and
 * transition the payment/order to 'succeeded', grant entitlements.
 */
exports.approvePayment = asyncHandler(async (req, res) => {
  const payment = await db.findById('payments', req.params.id);
  if (!payment) throw ApiError.notFound('Payment not found');
  if (!['instapay', 'wallet'].includes(payment.provider)) {
    throw ApiError.badRequest('Only local payment submissions can be approved via this endpoint');
  }
  if (payment.reviewStatus === 'approved') {
    return res.json({ success: true, status: payment.status, alreadyApproved: true });
  }
  if (payment.reviewStatus === 'rejected') {
    throw ApiError.badRequest('This payment was previously rejected. The customer must submit a new reference.');
  }
  const order = await db.findById('orders', payment.orderId);
  if (!order) throw ApiError.notFound('Order not found');
  if (Number(order.total) !== Number(payment.amount) || String(order.currency) !== String(payment.currency)) {
    throw ApiError.badRequest('Order/payment amount mismatch');
  }
  if (payment.status === 'succeeded' || payment.status === 'refunded') {
    throw ApiError.badRequest(`Payment is already in terminal state: ${payment.status}`);
  }

  const now = new Date().toISOString();
  await db.update('payments', payment.id, {
    reviewStatus: 'approved',
    reviewedBy: req.user.id,
    reviewedAt: now,
    status: 'succeeded',
  });
  await db.update('orders', payment.orderId, { status: 'paid' });

  // Grant entitlements (same as capturePayment success path).
  const entSvc = require('../services/entitlement.service');
  await entSvc.grantEntitlements({ userId: payment.userId, order, payment }).catch(() => {});
  const subs = await db.find('subscriptions', { orderId: order.id, status: 'pending' }, { limit: 10 });
  for (const s of subs.docs) {
    const d = new Date();
    d.setDate(d.getDate() + (s.cadence === 'weekly' ? 7 : 30));
    await db.update('subscriptions', s.id, {
      status: 'active', startedAt: new Date().toISOString(), renewsAt: d.toISOString(),
    }).catch(() => {});
  }
  await db.updateOne('carts', { userId: payment.userId }, { items: [] }).catch(() => {});

  await db.create('payment_events', {
    paymentId: payment.id, orderId: payment.orderId, provider: payment.provider,
    providerRef: payment.providerRef, kind: 'capture', status: 'succeeded',
    idempotencyKey: payment.idempotencyKey || '',
  }).catch(() => {});

  await audit.log({
    actorId: req.user.id, actorEmail: req.user.email, action: 'payment_approved',
    category: 'admin', target: payment.id,
    metadata: { provider: payment.provider, orderId: payment.orderId, amount: payment.amount },
  });

  // Notify customer on approval (best-effort).
  try {
    const user = await db.findById('users', payment.userId);
    if (user) {
      const templates = require('../services/mail-templates');
      const tpl = templates.paymentResult(user, payment, true);
      await mail.sendMail({ to: user.email, subject: tpl.subject, text: tpl.text });
      if (user.phone) {
        await sms.sendSms({ to: user.phone, message: `CNW: your payment of ${payment.amount} ${payment.currency} has been approved. Thank you!` });
      }
    }
  } catch { /* notifications must never break the response */ }

  res.json({ success: true, status: 'succeeded', paymentId: payment.id });
});

/**
 * POST /api/admin/payments/:id/reject
 * Reject a local-payment submission with a reason and mark its order failed.
 */
exports.rejectPayment = asyncHandler(async (req, res) => {
  const payment = await db.findById('payments', req.params.id);
  if (!payment) throw ApiError.notFound('Payment not found');
  if (!['instapay', 'wallet'].includes(payment.provider)) {
    throw ApiError.badRequest('Only local payment submissions can be rejected via this endpoint');
  }
  if (payment.reviewStatus === 'approved') {
    throw ApiError.badRequest('Already approved payments cannot be rejected via this endpoint. Use refund instead.');
  }

  const reason = String(req.body.reason || '').slice(0, 500);
  if (!reason) throw ApiError.badRequest('A rejection reason is required');

  const now = new Date().toISOString();
  await db.update('payments', payment.id, {
    reviewStatus: 'rejected',
    rejectionReason: reason,
    reviewedBy: req.user.id,
    reviewedAt: now,
    status: 'failed',
  });
  await db.update('orders', payment.orderId, { status: 'failed' });

  // Roll back any coupon that was redeemed for this order.
  const order = await db.findById('orders', payment.orderId);
  if (order && order.couponCode) {
    const coupons = require('../services/coupon.service');
    await coupons.rollbackRedemption(order.id).catch(() => {});
  }

  await db.create('payment_events', {
    paymentId: payment.id, orderId: payment.orderId, provider: payment.provider,
    providerRef: payment.providerRef, kind: 'capture', status: 'failed',
    idempotencyKey: payment.idempotencyKey || '',
  }).catch(() => {});

  await audit.log({
    actorId: req.user.id, actorEmail: req.user.email, action: 'payment_rejected',
    category: 'admin', target: payment.id,
    metadata: { provider: payment.provider, orderId: payment.orderId, reason },
  });

  res.json({ success: true, status: 'failed', paymentId: payment.id });
});

/**
 * GET /api/admin/payments/:id/proof
 * Download the proof attachment (receipt image / PDF) uploaded by the customer
 * when submitting their transfer reference. Requires manage:files permission.
 * Returns 404 if no proof was uploaded.
 */
exports.downloadPaymentProof = asyncHandler(async (req, res) => {
  const payment = await db.findById('payments', req.params.id);
  if (!payment) throw ApiError.notFound('Payment not found');
  if (!payment.proofStorageKey) throw ApiError.notFound('No proof attached to this payment');
  const storage = require('../services/storage.service');
  const file = await storage.getFile(payment.proofStorageKey);
  if (!file) throw ApiError.notFound('Proof file not found on disk');
  res.setHeader('Content-Type', payment.proofMime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${payment.proofName || 'proof'}"`);
  res.setHeader('Content-Length', String(file.length));
  res.send(file);
});
