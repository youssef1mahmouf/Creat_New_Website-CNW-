// Concise writer for payment-review.test.js
const fs = require('fs');
const L = (a, b) => [a, b].join('\n');
const T = (...args) => args.join('\n');

const header = T(
  '/** Integration test: InstaPay / wallet admin review flow. */',
  "const { test, describe } = require('node:test');",
  "const assert = require('node:assert');",
  "const { db, startApp, api, registerAndLogin } = require('./helpers');",
  '',
  "describe('InstaPay / wallet admin review flow', () => {"
);

const authTests = T(
  "  test('pending-review list requires auth', async () => {",
  '    const ctx = await startApp();',
  "    const res = await api(ctx.baseUrl, 'GET', '/admin/payments/pending-review');",
  '    assert.equal(res.status, 401);',
  '    ctx.server.close(); await db.flush();',
  '  });',
  '',
  "  test('approve requires auth', async () => {",
  '    const ctx = await startApp();',
  "    const payment = await db.create('payments', { orderId: 'o1', userId: 'u1', provider: 'instapay', providerRef: 'I1', amount: 599, currency: 'USD', status: 'pending', reviewStatus: 'submitted' });",
  "    await db.create('orders', { userId: 'u1', items: [{ productId: 'p1', productKind: 'product', name: 'T', unitPrice: 599, currency: 'USD', quantity: 1 }], subtotal: 599, discount: 0, total: 599, currency: 'USD', status: 'pending', paymentId: payment.id });",
  "    const res = await api(ctx.baseUrl, 'POST', '/admin/payments/' + payment.id + '/approve', { body: {} });",
  '    assert.equal(res.status, 401);',
  '    ctx.server.close(); await db.flush();',
  '  });',
  '',
  "  test('reject requires auth', async () => {",
  '    const ctx = await startApp();',
  "    const payment = await db.create('payments', { orderId: 'o2', userId: 'u2', provider: 'wallet', providerRef: 'W1', amount: 299, currency: 'USD', status: 'pending', reviewStatus: 'submitted' });",
  "    await db.create('orders', { userId: 'u2', items: [{ productId: 'p2', productKind: 'product', name: 'T2', unitPrice: 299, currency: 'USD', quantity: 1 }], subtotal: 299, discount: 0, total: 299, currency: 'USD', status: 'pending', paymentId: payment.id });",
  "    const res = await api(ctx.baseUrl, 'POST', '/admin/payments/' + payment.id + '/reject', { body: { reason: 'test' } });",
  '    assert.equal(res.status, 401);',
  '    ctx.server.close(); await db.flush();',
  '  });'
);

const approveTest = T(
  '',
  "  test('admin can approve an instapay payment', async () => {",
  '    const ctx = await startApp();',
  '    const { token, userId } = await registerAndLogin(ctx.baseUrl);',
  "    await db.update('users', userId, { role: 'admin', accountType: 'admin' });",
  "    const payment = await db.create('payments', { orderId: 'o-approve', userId, provider: 'instapay', providerRef: 'I-APPROVE', amount: 599, currency: 'USD', status: 'pending', reviewStatus: 'submitted', customerReference: 'TXN-001' });",
  "    const order = await db.create('orders', { userId, items: [{ productId: 'p-app', productKind: 'product', name: 'Approved Pkg', unitPrice: 599, currency: 'USD', quantity: 1 }], subtotal: 599, discount: 0, total: 599, currency: 'USD', status: 'pending', paymentId: payment.id, couponCode: '' });",
  "    const res = await api(ctx.baseUrl, 'POST', '/admin/payments/' + payment.id + '/approve', { token, body: {} });",
  '    assert.equal(res.status, 200);',
  "    assert.equal(res.json.status, 'succeeded');",
  "    const up = await db.findById('payments', payment.id);",
  "    assert.equal(up.status, 'succeeded');",
  "    assert.equal(up.reviewStatus, 'approved');",
  '    assert.ok(up.reviewedBy && up.reviewedAt);',
  "    const uo = await db.findById('orders', order.id);",
  "    assert.equal(uo.status, 'paid');",
  "    const ents = await db.find('entitlements', { userId, productKind: 'product', productId: 'p-app' }, { limit: 1 });",
  "    assert.ok(ents.docs.length > 0, 'entitlement granted on approve');",
  '    ctx.server.close(); await db.flush();',
  '  });'
);

const content = [header, authTests, approveTest, '}'].join('\n') + '\n';
fs.writeFileSync('d:/cnw/Creat_New_Website(CNW)/backend/tests/payment-review.test.js', content);
console.log('OK:', content.split('\n').length, 'lines');
