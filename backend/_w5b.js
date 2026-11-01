// Append guard + list tests
const fs = require('fs');
const ex = fs.readFileSync('d:/cnw/Creat_New_Website(CNW)/backend/tests/payment-review.test.js', 'utf8');
const b = `
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
`;
fs.writeFileSync('d:/cnw/Creat_New_Website(CNW)/backend/tests/payment-review.test.js', ex + b);
console.log('appended part B');
