/**
 * Subscription controller — paid update/care options for CNW clients.
 * Plans renew WEEKLY or MONTHLY (updates delivered every week / month).
 * Subscribing creates a real order + payment record (same manual provider
 * flow as checkout) so admins can see subscriptions in orders & reports.
 */
const db = require('../services/db.service');
const asyncHandler = require('../utils/async-handler');
const ApiError = require('../utils/api-error');
const audit = require('../services/audit.service');

/** The purchasable update plans. Extend here — nothing else changes. */
const PLANS = {
  'starter-weekly': {
    id: 'starter-weekly', name: 'Starter Care', cadence: 'weekly', price: 9, currency: 'USD',
    features: ['Website updates every week', 'Minor content edits', 'Email support (48h reply)'],
  },
  'pro-monthly': {
    id: 'pro-monthly', name: 'Pro Care', cadence: 'monthly', price: 29, currency: 'USD',
    features: ['Website updates every month (bundled)', 'Design tweaks & new sections', 'Email + WhatsApp support (24h reply)'],
  },
  'business-monthly': {
    id: 'business-monthly', name: 'Business Care', cadence: 'monthly', price: 99, currency: 'USD',
    features: ['Updates EVERY week (premium cadence)', 'Priority feature development', 'Monthly performance report', 'Dedicated WhatsApp support'],
  },
};

function renewalDate(cadence) {
  const d = new Date();
  d.setDate(d.getDate() + (cadence === 'weekly' ? 7 : 30));
  return d.toISOString();
}

/** GET /api/subscriptions/plans — public plan catalog. */
exports.plans = (req, res) => {
  res.json({ success: true, plans: Object.values(PLANS) });
};

/** POST /api/subscriptions/subscribe { planId, provider } — create order + PENDING payment.
 *  The subscription activates ONLY after the payment is captured (same secure
 *  flow as checkout): a bare API call can never mark money as received. */
exports.subscribe = asyncHandler(async (req, res) => {
  const plan = PLANS[String(req.body.planId || '')];
  if (!plan) throw ApiError.badRequest('Unknown plan. Choose starter-weekly, pro-monthly or business-monthly.');
  const providerName = ['manual'].includes(req.body.provider) ? req.body.provider : 'manual';

  const active = await db.findOne('subscriptions', { userId: req.user.id, planId: plan.id, status: 'active' });
  if (active) throw ApiError.conflict('You already have an active subscription for this plan');

  // 1) Real order with the plan as its single item (server-side price only).
  const order = await db.create('orders', {
    userId: req.user.id,
    items: [{ productId: plan.id, productKind: 'subscription', name: `${plan.name} (${plan.cadence})`, unitPrice: plan.price, currency: plan.currency, quantity: 1 }],
    subtotal: plan.price, discount: 0, couponCode: '', tax: 0, total: plan.price, currency: plan.currency,
    status: 'pending',
  });

  // 2) Payment stays PENDING until capture (admin approval / dev owner capture).
  const payment = await db.create('payments', {
    orderId: order.id,
    userId: req.user.id,
    provider: providerName,
    providerRef: `SUB-${plan.id}-${Date.now()}`,
    amount: plan.price,
    currency: plan.currency,
    status: 'pending',
    billingDetails: { name: String(req.body.billingName || req.user.name || '').slice(0, 120) },
  });
  await db.update('orders', order.id, { status: 'processing', paymentId: payment.id });

  // 3) The subscription itself starts PENDING and activates on capture.
  const subscription = await db.create('subscriptions', {
    userId: req.user.id,
    planId: plan.id,
    planName: plan.name,
    cadence: plan.cadence,
    price: plan.price,
    currency: plan.currency,
    status: 'pending',
    startedAt: null,
    renewsAt: null,
    orderId: order.id,
    paymentId: payment.id,
  });
  await audit.log({
    actorId: req.user.id, actorEmail: req.user.email, action: 'subscription_started',
    category: 'general', target: subscription.id, metadata: { planId: plan.id, amount: plan.price, status: 'pending' },
  });

  const freshOrder = await db.findById('orders', order.id);
  res.status(201).json({
    success: true,
    subscription, order: freshOrder || order,
    payment: { ...payment, billingDetails: undefined },
    clientAction: { type: 'confirm', message: 'Confirm the payment to activate this subscription (manual settlement requires admin approval in production).' },
  });
});

/** GET /api/subscriptions/mine — the signed-in user's subscriptions. */
exports.mine = asyncHandler(async (req, res) => {
  const { docs } = await db.find('subscriptions', { userId: req.user.id }, { limit: 50, sort: '-createdAt' });
  res.json({ success: true, docs });
});

/** POST /api/subscriptions/:id/cancel — stop auto-renewal. */
exports.cancel = asyncHandler(async (req, res) => {
  const sub = await db.findById('subscriptions', req.params.id);
  if (!sub || sub.userId !== req.user.id) throw ApiError.notFound('Subscription not found');
  const updated = await db.update('subscriptions', req.params.id, { status: 'cancelled' });
  res.json({ success: true, subscription: updated });
});

/** GET /api/admin/subscriptions — all subscriptions (admin). */
exports.adminList = asyncHandler(async (req, res) => {
  const { docs, total } = await db.find('subscriptions', {}, { limit: 200, sort: '-createdAt' });
  res.json({ success: true, docs, total });
});

/** GET /api/admin/subscription-plans — public plan catalog (admin view). */
exports.listPlans = (req, res) => {
  res.json({ success: true, plans: Object.values(PLANS) });
};

/** PUT /api/admin/subscriptions/:id/cancel — admin cancels any subscription. */
exports.adminCancel = asyncHandler(async (req, res) => {
  const sub = await db.findById('subscriptions', req.params.id);
  if (!sub) throw ApiError.notFound('Subscription not found');
  const updated = await db.update('subscriptions', req.params.id, { status: 'cancelled' });
  await audit.log({
    actorId: req.user.id, actorEmail: req.user.email, action: 'subscription_cancelled',
    category: 'admin', target: sub.id, metadata: { userId: sub.userId, planId: sub.planId },
  });
  res.json({ success: true, subscription: updated });
});