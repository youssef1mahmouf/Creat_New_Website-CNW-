/** Authorization, validation, cart/checkout integration tests. */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startApp, api, registerAndLogin } = require('./helpers');

let ctx;
before(async () => { ctx = await startApp(); });
after(async () => { ctx.server.close(); await db.flush(); });

describe('authorization & role enforcement', () => {
  test('regular user cannot access admin endpoints', async () => {
    const { token } = await registerAndLogin(ctx.baseUrl);
    const res = await api(ctx.baseUrl, 'GET', '/admin/overview', { token });
    assert.equal(res.status, 403);
  });

  test('regular user cannot create products', async () => {
    const { token } = await registerAndLogin(ctx.baseUrl);
    const res = await api(ctx.baseUrl, 'POST', '/products', {
      token,
      body: { name: 'Hack Product', price: 1 },
    });
    assert.equal(res.status, 403);
  });

  test('admin can access admin endpoints', async () => {
    const { token, userId } = await registerAndLogin(ctx.baseUrl);
    await db.update('users', userId, { role: 'admin', accountType: 'admin' });
    const res = await api(ctx.baseUrl, 'GET', '/admin/overview', { token });
    assert.equal(res.status, 200);
    assert.ok(res.json.stats);
  });

  test('cart data is per-user (no cross-user leakage)', async () => {
    const a = await registerAndLogin(ctx.baseUrl);
    const b = await registerAndLogin(ctx.baseUrl);
    const products = await api(ctx.baseUrl, 'GET', '/products');
    const productId = products.json.docs[0].id;
    await api(ctx.baseUrl, 'POST', '/cart/items', { token: a.token, body: { productId, quantity: 2 } });
    const cartB = await api(ctx.baseUrl, 'GET', '/cart', { token: b.token });
    assert.equal(cartB.json.cart.items.length, 0);
  });
});

describe('input validation', () => {
  test('invalid email rejected on register', async () => {
    const res = await api(ctx.baseUrl, 'POST', '/auth/register', {
      body: { name: 'Bad Email', email: 'not-an-email', password: 'GoodPassword1' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, 'BAD_REQUEST');
  });

  test('cart item requires valid productId', async () => {
    const { token } = await registerAndLogin(ctx.baseUrl);
    const res = await api(ctx.baseUrl, 'POST', '/cart/items', { token, body: { productId: '' } });
    assert.equal(res.status, 400);
  });
});

describe('cart & checkout flow', () => {
  test('add to cart -> checkout -> capture -> order paid', async () => {
    const { token } = await registerAndLogin(ctx.baseUrl);
    const products = await api(ctx.baseUrl, 'GET', '/products');
    const product = products.json.docs.find((p) => p.availability !== 'unavailable');
    const add = await api(ctx.baseUrl, 'POST', '/cart/items', {
      token, body: { productId: product.id, quantity: 1 },
    });
    assert.equal(add.status, 200);

    const checkout = await api(ctx.baseUrl, 'POST', '/orders/checkout', {
      token, body: { provider: 'manual', billingName: 'Test Buyer' },
    });
    assert.equal(checkout.status, 201);
    const paymentId = checkout.json.payment.id;
    assert.ok(!JSON.stringify(checkout.json).includes('billingDetails'), 'PII not exposed in payment view');

    const capture = await api(ctx.baseUrl, 'POST', `/payments/${paymentId}/capture`, { token });
    assert.equal(capture.status, 200);
    assert.equal(capture.json.status, 'succeeded');

    const orders = await api(ctx.baseUrl, 'GET', '/orders', { token });
    assert.equal(orders.json.docs[0].status, 'paid');
  });

  test('checkout with unknown provider is rejected', async () => {
    const { token } = await registerAndLogin(ctx.baseUrl);
    const res = await api(ctx.baseUrl, 'POST', '/orders/checkout', {
      token, body: { provider: 'does-not-exist' },
    });
    assert.equal(res.status, 400);
  });
});
