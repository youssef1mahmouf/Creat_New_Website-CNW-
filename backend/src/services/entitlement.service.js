/**
 * Entitlement service — the single source of truth for "user owns product".
 * Created only after a payment reaches `succeeded`; revoked on full refund.
 * Downloads verify entitlement and are logged per access.
 */
const db = require('./db.service');

function kindForProduct(product) {
  if (!product) return 'code';
  if (product.code !== undefined || product.previewHtml !== undefined || product.title) return 'code';
  if (product.data !== undefined || product.designType) return 'design';
  return 'product';
}

async function grantEntitlements({ userId, order, payment }) {
  const granted = [];
  for (const item of order.items || []) {
    const productKind = item.productKind || 'code';
    // Subscriptions are not download entitlements — they activate on capture
    // via the subscription controller's pending rows.
    if (productKind === 'subscription') continue;
    const existing = await db.findOne('entitlements', {
      userId, productKind, productId: item.productId, status: 'active',
    });
    if (existing) {
      granted.push(existing);
      continue;
    }
    granted.push(await db.create('entitlements', {
      userId, productKind, productId: item.productId,
      orderId: order.id, paymentId: payment ? payment.id : null,
      status: 'active',
    }));
  }
  return granted;
}

async function hasEntitlement(userId, productKind, productId) {
  const row = await db.findOne('entitlements', { userId, productKind, productId, status: 'active' });
  return Boolean(row);
}

async function revokeByOrder(orderId, reason = 'refund') {
  const { docs } = await db.find('entitlements', { orderId }, { limit: 200 });
  for (const e of docs) {
    if (e.status === 'active') {
      await db.update('entitlements', e.id, { status: reason === 'refund' ? 'refunded' : 'revoked' }).catch(() => {});
    }
  }
  return docs.length;
}

async function logDownload({ userId, productKind, productId, entitlementId, ip, userAgent }) {
  await db.create('download_logs', {
    userId, productKind, productId, entitlementId: entitlementId || null, ip: ip || '', userAgent: userAgent || '',
  }).catch(() => {});
  const ent = entitlementId ? await db.findById('entitlements', entitlementId).catch(() => null) : null;
  if (ent) {
    await db.update('entitlements', ent.id, {
      downloadCount: Number(ent.downloadCount || 0) + 1,
      lastDownloadAt: new Date().toISOString(),
    }).catch(() => {});
  }
}

module.exports = { kindForProduct, grantEntitlements, hasEntitlement, revokeByOrder, logDownload };