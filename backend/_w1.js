const fs = require('fs');
const out = [];
const W = (s) => out.push(s);

W('/**');
W(' * Integration test: InstaPay / wallet admin review flow.');
W(' * Verifies the new admin payment review endpoints work correctly');
W(' * with proper authentication and state transitions.');
W(' */');
W("const { test, describe } = require('node:test');");
W("const assert = require('node:assert');");
W("const { db, startApp, api, registerAndLogin } = require('./helpers');");
W('');
W("describe('InstaPay / wallet admin review flow', () => {");

// auth gate tests
W("  test('pending-review list requires auth', async () => {");
W('    const ctx = await startApp();');
W("    const res = await api(ctx.baseUrl, 'GET', '/admin/payments/pending-review');");
W('    assert.equal(res.status, 401);');
W('    ctx.server.close(); await db.flush();');
W('  });');
W('');
W("  test('approve requires auth', async () => {");
W('    const ctx = await startApp();');
W("    const payment = await db.create('payments', { orderId: 'o1', userId: 'u1', provider: 'instapay', providerRef: 'I1', amount: 599, currency: 'USD', status: 'pending', reviewStatus: 'submitted' });");
W("    await db.create('orders', { userId: 'u1', items: [{ productId: 'p1', productKind: 'product', name: 'T', unitPrice: 599, currency: 'USD', quantity: 1 }], subtotal: 599, discount: 0, total: 599, currency: 'USD', status: 'pending', paymentId: payment.id });");
W("    const res = await api(ctx.baseUrl, 'POST', '/admin/payments/' + payment.id + '/approve', { body: {} });");
W('    assert.equal(res.status, 401);');
W('    ctx.server.close(); await db.flush();');
W('  });');
W('');
W("  test('reject requires auth', async () => {");
W('    const ctx = await startApp();');
W("    const payment = await db.create('payments', { orderId: 'o2', userId: 'u2', provider: 'wallet', providerRef: 'W1', amount: 299, currency: 'USD', status: 'pending', reviewStatus: 'submitted' });");
W("    await db.create('orders', { userId: 'u2', items: [{ productId: 'p2', productKind: 'product', name: 'T2', unitPrice: 299, currency: 'USD', quantity: 1 }], subtotal: 299, discount: 0, total: 299, currency: 'USD', status: 'pending', paymentId: payment.id });");
W("    const res = await api(ctx.baseUrl, 'POST', '/admin/payments/' + payment.id + '/reject', { body: { reason: 'test' } });");
W('    assert.equal(res.status, 401);');
W('    ctx.server.close(); await db.flush();');
W('  });');

fs.writeFileSync('d:/cnw/Creat_New_Website(CNW)/backend/tests/payment-review.test.js', out.join('\n') + '\n');
console.log('Wrote', out.length, 'lines (part 1)');
