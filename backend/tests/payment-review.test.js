/** Integration test: InstaPay / wallet admin review flow. */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { db, startApp, api, registerAndLogin } = require('./helpers');

describe('InstaPay / wallet admin review flow', () => {
  test('pending-review list requires auth', async () => {
    const ctx = await startApp();
    const res = await api(ctx.baseUrl, 'GET', '/admin/payments/pending-review');
    assert.equal(res.status, 401);
    ctx.server.close(); await db.flush();
  });

  test('approve requires auth', async () => {
    const ctx = await startApp();
    const payment = await db.create('payments', { orderId: 'o1', userId: 'u1', provider: 'instapay', providerRef: 'I1', amount: 599, currency: 'USD', status: 'pending', reviewStatus: 'submitted' });
    await db.create('orders', { userId: 'u1', items: [{ productId: 'p1', productKind: 'product', name: 'T', unitPrice: 599, currency: 'USD', quantity: 1 }], subtotal: 599, discount: 0, total: 599, currency: 'USD', status: 'pending', paymentId: payment.id });
    const res = await api(ctx.baseUrl, 'POST', '/admin/payments/' + payment.id + '/approve', { body: {} });
    assert.equal(res.status, 401);
    ctx.server.close(); await db.flush();
  });

  test('reject requires auth', async () => {
    const ctx = await startApp();
    const payment = await db.create('payments', { orderId: 'o2', userId: 'u2', provider: 'wallet', providerRef: 'W1', amount: 299, currency: 'USD', status: 'pending', reviewStatus: 'submitted' });
    await db.create('orders', { userId: 'u2', items: [{ productId: 'p2', productKind: 'product', name: 'T2', unitPrice: 299, currency: 'USD', quantity: 1 }], subtotal: 299, discount: 0, total: 299, currency: 'USD', status: 'pending', paymentId: payment.id });
    const res = await api(ctx.baseUrl, 'POST', '/admin/payments/' + payment.id + '/reject', { body: { reason: 'test' } });
    assert.equal(res.status, 401);
    ctx.server.close(); await db.flush();
  });

  test('admin can approve an instapay payment', async () => {
    const ctx = await startApp();
    const { token, userId } = await registerAndLogin(ctx.baseUrl);
    await db.update('users', userId, { role: 'admin', accountType: 'admin' });
    const order = await db.create('orders', { userId, items: [{ productId: 'p-app', productKind: 'product', name: 'Approved Pkg', unitPrice: 599, currency: 'USD', quantity: 1 }], subtotal: 599, discount: 0, total: 599, currency: 'USD', status: 'pending', couponCode: '' });
    const payment = await db.create('payments', { orderId: order.id, userId, provider: 'instapay', providerRef: 'I-APPROVE', amount: 599, currency: 'USD', status: 'pending', reviewStatus: 'submitted', customerReference: 'TXN-001' });
    const res = await api(ctx.baseUrl, 'POST', '/admin/payments/' + payment.id + '/approve', { token, body: {} });
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'succeeded');
    const up = await db.findById('payments', payment.id);
    assert.equal(up.status, 'succeeded');
    assert.equal(up.reviewStatus, 'approved');
    assert.ok(up.reviewedBy && up.reviewedAt);
    const uo = await db.findById('orders', order.id);
    assert.equal(uo.status, 'paid');
    const ents = await db.find('entitlements', { userId, productKind: 'product', productId: 'p-app' }, { limit: 1 });
    assert.ok(ents.docs.length > 0, 'entitlement granted on approve');
    ctx.server.close(); await db.flush();
  });
  test('admin can reject a wallet payment', async () => {
    const ctx = await startApp();
    const { token, userId } = await registerAndLogin(ctx.baseUrl);
    await db.update('users', userId, { role: 'admin', accountType: 'admin' });
    const order = await db.create('orders', { userId, items: [{ productId: 'pr', productKind: 'product', name: 'R', unitPrice: 299, currency: 'USD', quantity: 1 }], subtotal: 299, discount: 0, total: 299, currency: 'USD', status: 'pending', couponCode: 'TST' });
    const pm = await db.create('payments', { orderId: order.id, userId, provider: 'wallet', providerRef: 'WR', amount: 299, currency: 'USD', status: 'pending', reviewStatus: 'submitted' });
    await db.update('orders', order.id, { paymentId: pm.id });
    await db.create('coupons', { code: 'TST', percent: 10, status: 'active', createdBy: userId });
    const res = await api(ctx.baseUrl, 'POST', '/admin/payments/' + pm.id + '/reject', { token, body: { reason: 'Transfer not received' } });
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'failed');
    const up = await db.findById('payments', pm.id);
    assert.equal(up.status, 'failed');
    assert.equal(up.reviewStatus, 'rejected');
    assert.equal(up.rejectionReason, 'Transfer not received');
    assert.equal((await db.findById('orders', order.id)).status, 'failed');
    ctx.server.close(); await db.flush();
  });

  test('cannot approve an already-rejected payment', async () => {
    const ctx = await startApp();
    const { token, userId } = await registerAndLogin(ctx.baseUrl);
    await db.update('users', userId, { role: 'admin', accountType: 'admin' });
    const pm = await db.create('payments', { orderId: 'od', userId, provider: 'instapay', providerRef: 'ID', amount: 899, currency: 'USD', status: 'pending', reviewStatus: 'rejected', rejectionReason: 'x' });
    await db.create('orders', { userId, items: [{ productId: 'pd', productKind: 'product', name: 'D', unitPrice: 899, currency: 'USD', quantity: 1 }], subtotal: 899, discount: 0, total: 899, currency: 'USD', status: 'pending', paymentId: pm.id });
    const res = await api(ctx.baseUrl, 'POST', '/admin/payments/' + pm.id + '/approve', { token, body: {} });
    assert.equal(res.status, 400);
    assert.ok(res.json.message.includes('rejected'));
    ctx.server.close(); await db.flush();
  });

  test('cannot reject an already-approved payment', async () => {
    const ctx = await startApp();
    const { token, userId } = await registerAndLogin(ctx.baseUrl);
    await db.update('users', userId, { role: 'admin', accountType: 'admin' });
    const pm = await db.create('payments', { orderId: 'oa', userId, provider: 'instapay', providerRef: 'IA', amount: 599, currency: 'USD', status: 'succeeded', reviewStatus: 'approved' });
    await db.create('orders', { userId, items: [{ productId: 'pa', productKind: 'product', name: 'A', unitPrice: 599, currency: 'USD', quantity: 1 }], subtotal: 599, discount: 0, total: 599, currency: 'USD', status: 'paid', paymentId: pm.id });
    const res = await api(ctx.baseUrl, 'POST', '/admin/payments/' + pm.id + '/reject', { token, body: { reason: 'x' } });
    assert.equal(res.status, 400);
    assert.ok(res.json.message.includes('Already approved'));
    ctx.server.close(); await db.flush();
  });

  test('pending-review list shows local payments', async () => {
    const ctx = await startApp();
    const { token, userId } = await registerAndLogin(ctx.baseUrl);
    await db.update('users', userId, { role: 'admin', accountType: 'admin' });
    await db.create('payments', { orderId: 'pr1', userId, provider: 'instapay', providerRef: 'P1', amount: 599, currency: 'USD', status: 'pending', reviewStatus: 'submitted', customerReference: 'TXN-001' });
    await db.create('payments', { orderId: 'pr2', userId, provider: 'wallet', providerRef: 'P2', amount: 299, currency: 'USD', status: 'pending', reviewStatus: 'none' });
    const res = await api(ctx.baseUrl, 'GET', '/admin/payments/pending-review', { token });
    assert.equal(res.status, 200);
    assert.ok(res.json.docs.length >= 2);
    for (const doc of res.json.docs) {
      assert.ok(['instapay', 'wallet'].includes(doc.provider));
      assert.ok(['none', 'submitted'].includes(doc.reviewStatus));
    }
    ctx.server.close(); await db.flush();
  });

  test('non-admin cannot approve (403)', async () => {
    const ctx = await startApp();
    const { token } = await registerAndLogin(ctx.baseUrl);
    const pm = await db.create('payments', { orderId: 'onp', userId: 'ux', provider: 'instapay', providerRef: 'INP', amount: 599, currency: 'USD', status: 'pending', reviewStatus: 'submitted' });
    await db.create('orders', { userId: 'ux', items: [{ productId: 'px', productKind: 'product', name: 'X', unitPrice: 599, currency: 'USD', quantity: 1 }], subtotal: 599, discount: 0, total: 599, currency: 'USD', status: 'pending', paymentId: pm.id });
    const res = await api(ctx.baseUrl, 'POST', '/admin/payments/' + pm.id + '/approve', { token, body: {} });
    assert.equal(res.status, 403);
    ctx.server.close(); await db.flush();
  });

  test('proof download returns 404 when no proof', async () => {
    const ctx = await startApp();
    const { token, userId } = await registerAndLogin(ctx.baseUrl);
    await db.update('users', userId, { role: 'admin', accountType: 'admin' });
    const pm = await db.create('payments', { orderId: 'opf', userId, provider: 'instapay', providerRef: 'IP', amount: 599, currency: 'USD', status: 'pending', reviewStatus: 'submitted' });
    await db.create('orders', { userId, items: [{ productId: 'ppf', productKind: 'product', name: 'F', unitPrice: 599, currency: 'USD', quantity: 1 }], subtotal: 599, discount: 0, total: 599, currency: 'USD', status: 'pending', paymentId: pm.id });
    const res = await api(ctx.baseUrl, 'GET', '/admin/payments/' + pm.id + '/proof', { token });
    assert.equal(res.status, 404);
    ctx.server.close(); await db.flush();
  });
});