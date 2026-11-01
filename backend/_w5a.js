// Append reject + guard tests
const fs = require('fs');
const ex = fs.readFileSync('d:/cnw/Creat_New_Website(CNW)/backend/tests/payment-review.test.js', 'utf8');
const a = `
  test('admin can reject a wallet payment', async () => {
    const ctx = await startApp();
    const { token, userId } = await registerAndLogin(ctx.baseUrl);
    await db.update('users', userId, { role: 'admin', accountType: 'admin' });
    const pm = await db.create('payments', { orderId: 'o-rej', userId, provider: 'wallet', providerRef: 'WR', amount: 299, currency: 'USD', status: 'pending', reviewStatus: 'submitted' });
    await db.create('orders', { userId, items: [{ productId: 'pr', productKind: 'product', name: 'R', unitPrice: 299, currency: 'USD', quantity: 1 }], subtotal: 299, discount: 0, total: 299, currency: 'USD', status: 'pending', paymentId: pm.id, couponCode: 'TST' });
    await db.create('coupons', { code: 'TST', percent: 10, status: 'active', createdBy: userId });
    const res = await api(ctx.baseUrl, 'POST', '/admin/payments/' + pm.id + '/reject', { token, body: { reason: 'Transfer not received' } });
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'failed');
    const up = await db.findById('payments', pm.id);
    assert.equal(up.status, 'failed');
    assert.equal(up.reviewStatus, 'rejected');
    assert.equal(up.rejectionReason, 'Transfer not received');
    assert.equal((await db.findById('orders', pm.orderId)).status, 'failed');
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
`;
fs.writeFileSync('d:/cnw/Creat_New_Website(CNW)/backend/tests/payment-review.test.js', ex + a);
console.log('appended part A');
