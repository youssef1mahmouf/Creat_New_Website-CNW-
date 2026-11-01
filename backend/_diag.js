const { db, startApp, api, registerAndLogin } = require('./tests/helpers');

(async () => {
  const ctx = await startApp();
  const { token, userId } = await registerAndLogin(ctx.baseUrl);
  await db.update('users', userId, { role: 'admin', accountType: 'admin' });

  // Create order FIRST, then use its ID in payment
  const order = await db.create('orders', {
    userId,
    items: [{ productId: 'pa', productKind: 'product', name: 'Pkg', unitPrice: 599, currency: 'USD', quantity: 1 }],
    subtotal: 599, discount: 0, total: 599, currency: 'USD', status: 'pending', couponCode: '',
  });
  console.log('order id:', order.id);

  const pm = await db.create('payments', {
    orderId: order.id, userId,
    provider: 'instapay', providerRef: 'IA',
    amount: 599, currency: 'USD',
    status: 'pending', reviewStatus: 'submitted', customerReference: 'TXN-001',
  });
  console.log('payment id:', pm.id, 'payment.orderId:', pm.orderId);

  const res = await api(ctx.baseUrl, 'POST', '/admin/payments/' + pm.id + '/approve', { token, body: {} });
  console.log('approve status:', res.status, 'body:', JSON.stringify(res.json));

  const up = await db.findById('payments', pm.id);
  console.log('payment status after:', up.status, 'reviewStatus:', up.reviewStatus);

  const uo = await db.findById('orders', order.id);
  console.log('order status after:', uo.status);

  ctx.server.close();
  await db.flush();
})().catch(e => console.log('ERROR:', e.message));
