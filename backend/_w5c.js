// Append permission + proof tests and close describe
const fs = require('fs');
const ex = fs.readFileSync('d:/cnw/Creat_New_Website(CNW)/backend/tests/payment-review.test.js', 'utf8');
const c = `
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
};
`;
fs.writeFileSync('d:/cnw/Creat_New_Website(CNW)/backend/tests/payment-review.test.js', ex + c);
console.log('appended part C - done');
