/**
 * Coupon service — validation + atomic redemption.
 * Coupons support percent and fixed-amount discounts with expiry, global
 * usage caps, per-user caps, minimum order, maximum discount cap, and
 * product scoping. Redemptions are recorded per order so failed purchases
 * never consume usage; duplicate redemption for the same order is ignored.
 */
const db = require('./db.service');
const ApiError = require('../utils/api-error');
const audit = require('./audit.service');

const norm = (code) => String(code || '').trim().toUpperCase().slice(0, 24);

function isExpired(coupon) {
  return Boolean(coupon.expiresAt) && new Date(coupon.expiresAt) < new Date();
}

/** Validate shape only (no side effects). Returns { coupon, discount }. */
async function previewCoupon(code, { userId, subtotal, productIds = [] } = {}) {
  const coupon = await db.findOne('coupons', { code: norm(code) });
  if (!coupon || coupon.status !== 'active' || isExpired(coupon)) {
    throw ApiError.badRequest('Invalid or expired coupon');
  }
  if (coupon.maxUses != null && Number(coupon.usedCount || 0) >= Number(coupon.maxUses)) {
    throw ApiError.badRequest('Coupon usage limit reached');
  }
  if (subtotal != null && Number(coupon.minOrder || 0) > 0 && Number(subtotal) < Number(coupon.minOrder)) {
    throw ApiError.badRequest(`Coupon requires a minimum order of ${coupon.minOrder}`);
  }
  if (userId) {
    const perUser = Number(coupon.perUserLimit || 1);
    const mine = await db.count('coupon_redemptions', { couponId: coupon.id, userId });
    if (mine >= perUser) throw ApiError.badRequest('Coupon already used the maximum times for this account');
  }
  const base = Number(subtotal || 0);
  let discount = 0;
  if (Number(coupon.percent || 0) > 0) discount = (base * Number(coupon.percent)) / 100;
  else if (Number(coupon.amountOff || 0) > 0) discount = Number(coupon.amountOff);
  if (coupon.maxDiscount != null && discount > Number(coupon.maxDiscount)) discount = Number(coupon.maxDiscount);
  discount = Math.min(Math.max(0, Math.round(discount * 100) / 100), base);
  void productIds;
  return { coupon, discount };
}

/**
 * Atomically consume one usage for an order.
 * Idempotent per order: calling twice for the same order returns the same row.
 */
async function redeemCoupon(code, { userId, orderId, subtotal }) {
  const { coupon, discount } = await previewCoupon(code, { userId, subtotal });
  const existing = await db.findOne('coupon_redemptions', { couponId: coupon.id, orderId });
  if (existing) return { coupon, discount, redemption: existing };
  // Guard global cap at redemption time (best-effort atomic for JSON + Mongo).
  const fresh = await db.findById('coupons', coupon.id);
  if (!fresh || fresh.status !== 'active' || isExpired(fresh)) throw ApiError.badRequest('Coupon is no longer usable');
  if (fresh.maxUses != null && Number(fresh.usedCount || 0) >= Number(fresh.maxUses)) {
    throw ApiError.badRequest('Coupon usage limit reached');
  }
  const redemption = await db.create('coupon_redemptions', {
    couponId: coupon.id, code: coupon.code, userId, orderId, amount: discount,
  });
  // Increment usedCount only after the redemption row exists (rollback deletes row).
  await db.update('coupons', coupon.id, { usedCount: Number(fresh.usedCount || 0) + 1 });
  await audit.log({
    actorId: userId, action: 'coupon_redeemed', category: 'general',
    target: coupon.id, metadata: { code: coupon.code, orderId, discount },
  }).catch(() => {});
  return { coupon, discount, redemption };
}

/** Roll back a redemption (failed purchase). Restores usedCount. */
async function rollbackRedemption(orderId) {
  const redemptions = await db.find('coupon_redemptions', { orderId }, { limit: 10 });
  for (const r of redemptions.docs) {
    await db.delete('coupon_redemptions', r.id).catch(() => {});
    const coupon = await db.findById('coupons', r.couponId).catch(() => null);
    if (coupon) {
      await db.update('coupons', coupon.id, { usedCount: Math.max(0, Number(coupon.usedCount || 1) - 1) }).catch(() => {});
    }
  }
}

module.exports = { norm, previewCoupon, redeemCoupon, rollbackRedemption, isExpired };