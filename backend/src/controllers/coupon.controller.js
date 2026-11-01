/**
 * Coupon controller — discount codes with full lifecycle.
 * Admins create/update/delete; customers validate before checkout and the
 * checkout flow redeems atomically (see coupon.service).
 */
const db = require('../services/db.service');
const coupons = require('../services/coupon.service');
const ApiError = require('../utils/api-error');
const asyncHandler = require('../utils/async-handler');
const audit = require('../services/audit.service');

exports.list = asyncHandler(async (req, res) => {
  const result = await db.find('coupons', {}, { limit: 200, sort: '-createdAt' });
  res.json({ success: true, ...result });
});

exports.create = asyncHandler(async (req, res) => {
  const code = coupons.norm(req.body.code);
  const percent = req.body.percent !== undefined ? parseInt(req.body.percent, 10) : 0;
  const amountOff = req.body.amountOff !== undefined ? Number(req.body.amountOff) : 0;
  if (!/^[A-Z0-9-]{2,24}$/.test(code)) throw ApiError.badRequest('Code must be 2-24 chars (letters, digits, dashes)');
  if (percent && (!Number.isFinite(percent) || percent < 1 || percent > 90)) throw ApiError.badRequest('percent must be 1-90');
  if (!percent && !(amountOff > 0)) throw ApiError.badRequest('Provide percent (1-90) or amountOff (>0)');
  if (amountOff < 0 || amountOff > 100000) throw ApiError.badRequest('amountOff out of range');
  const existing = await db.findOne('coupons', { code });
  if (existing) throw ApiError.conflict('Coupon code already exists');
  const coupon = await db.create('coupons', {
    code,
    percent: percent || 0,
    amountOff: amountOff || 0,
    maxUses: req.body.maxUses !== undefined ? Math.max(1, parseInt(req.body.maxUses, 10)) : null,
    usedCount: 0,
    perUserLimit: req.body.perUserLimit !== undefined ? Math.max(1, parseInt(req.body.perUserLimit, 10)) : 1,
    minOrder: req.body.minOrder !== undefined ? Math.max(0, Number(req.body.minOrder)) : 0,
    maxDiscount: req.body.maxDiscount !== undefined && req.body.maxDiscount !== null ? Math.max(0, Number(req.body.maxDiscount)) : null,
    expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt).toISOString() : null,
    status: 'active',
    createdBy: req.user.id,
  });
  await audit.log({
    actorId: req.user.id, actorEmail: req.user.email, action: 'coupon_created',
    category: 'admin', target: coupon.id, metadata: { op: 'coupon_create', code },
  });
  res.status(201).json({ success: true, coupon });
});

exports.update = asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body.status !== undefined) {
    if (!['active', 'disabled'].includes(req.body.status)) throw ApiError.badRequest('Invalid status');
    patch.status = req.body.status;
  }
  for (const key of ['maxUses', 'perUserLimit']) {
    if (req.body[key] !== undefined) patch[key] = Math.max(1, parseInt(req.body[key], 10));
  }
  for (const key of ['minOrder', 'maxDiscount', 'amountOff']) {
    if (req.body[key] !== undefined && req.body[key] !== null) patch[key] = Math.max(0, Number(req.body[key]));
  }
  if (req.body.percent !== undefined) {
    const percent = parseInt(req.body.percent, 10);
    if (!Number.isFinite(percent) || percent < 0 || percent > 90) throw ApiError.badRequest('percent must be 0-90');
    patch.percent = percent;
  }
  if (req.body.expiresAt !== undefined) {
    patch.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt).toISOString() : null;
  }
  const doc = await db.update('coupons', req.params.id, patch);
  if (!doc) throw ApiError.notFound('Coupon not found');
  await audit.log({
    actorId: req.user.id, actorEmail: req.user.email, action: 'coupon_created',
    category: 'admin', target: doc.id, metadata: { op: 'coupon_update', fields: Object.keys(patch) },
  });
  res.json({ success: true, coupon: doc });
});

exports.remove = asyncHandler(async (req, res) => {
  const ok = await db.delete('coupons', req.params.id);
  if (!ok) throw ApiError.notFound('Coupon not found');
  res.json({ success: true });
});

/** Customer: check a code is usable (returns the discount, nothing else). */
exports.validate = asyncHandler(async (req, res) => {
  const subtotal = req.body.subtotal !== undefined ? Number(req.body.subtotal) : undefined;
  const { coupon, discount } = await coupons.previewCoupon(req.body.code, {
    userId: req.user ? req.user.id : null, subtotal,
  });
  res.json({ success: true, coupon: { code: coupon.code, percent: coupon.percent, amountOff: coupon.amountOff }, discount });
});
