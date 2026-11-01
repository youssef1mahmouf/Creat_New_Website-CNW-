process.env.NODE_ENV = 'test';
const { createApp } = require('./src/app');
const db = require('./src/services/db.service');

(async () => {
  const app = createApp();
  const srv = app.listen(0);
  await new Promise(r => srv.on('listening', r));
  const p = srv.address().port;
  const base = 'http://127.0.0.1:' + p + '/api';

  // Create a test payment with instapay provider and reviewStatus 'submitted'
  const payment = await db.create('payments', {
    orderId: 't1', userId: 'u1', provider: 'instapay',
    providerRef: 'I1', amount: 599, currency: 'USD',
    status: 'pending', reviewStatus: 'submitted',
  });
  await db.create('orders', {
    userId: 'u1',
    items: [{ productId: 'p1', productKind: 'product', name: 'T', unitPrice: 599, currency: 'USD', quantity: 1 }],
    subtotal: 599, discount: 0, total: 599, currency: 'USD',
    status: 'pending', paymentId: payment.id,
  });
  console.log('payment created:', payment.id);

  // Test approve endpoint with NO auth → expect 401
  const r1 = await fetch(base + '/admin/payments/' + payment.id + '/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  console.log('approve NO-auth status:', r1.status, '(expect 401)');

  // Test reject endpoint with NO auth → expect 401
  const r2 = await fetch(base + '/admin/payments/' + payment.id + '/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'test' }),
  });
  console.log('reject NO-auth status:', r2.status, '(expect 401)');

  // Test approve endpoint with admin auth + valid reason → expect 200
  const r3 = await fetch(base + '/admin/payments/' + payment.id + '/approve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer fake-admin-token',
    },
    body: JSON.stringify({}),
  });
  const j3 = await r3.json();
  console.log('approve WITH-auth status:', r3.status, 'body:', JSON.stringify(j3));

  // Verify payment status changed to succeeded
  const updated = await db.findById('payments', payment.id);
  console.log('payment status after approve:', updated.status, '(expect succeeded)');
  console.log('reviewStatus after approve:', updated.reviewStatus, '(expect approved)');

  // Test reject on an already-approved payment → expect 400
  const r4 = await fetch(base + '/admin/payments/' + payment.id + '/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'too late' }),
  });
  console.log('reject on approved status:', r4.status, '(expect 400)');

  // Test pending-review list endpoint with no auth → expect 401
  const r5 = await fetch(base + '/admin/payments/pending-review');
  console.log('pending-review NO-auth status:', r5.status, '(expect 401)');

  srv.close();
  console.log('ALL CHECKS DONE');
})().catch(e => { console.log('ERROR:', e.message); srv && srv.close(); });
