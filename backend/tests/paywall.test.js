/**
 * Code-store paywall & purchase regression tests (audit follow-up).
 * Guards the fixes from the full audit:
 *  1. store list/detail never leak code/previewHtml to non-buyers
 *  2. code snippets are purchasable (cart resolves code_products)
 *  3. ownership unlocks the source code after a paid order
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startApp, api, registerAndLogin } = require('./helpers');

let ctx;

before(async () => { ctx = await startApp(); });
after(async () => { ctx.server.close(); await db.flush(); });

/** First published paid snippet id (seeds on first listing call). */
async function firstPaidSnippetId() {
  const res = await api(ctx.baseUrl, 'GET', '/code-products');
  assert.equal(res.status, 200);
  const paid = res.json.docs.find((d) => Number(d.price) > 0);
  assert.ok(paid, 'store seed must contain at least one paid snippet');
  return paid.id;
}

function assertNoLeak(doc) {
  assert.ok(!('code' in doc), 'code must not be present on locked card');
  assert.ok(!('previewHtml' in doc), 'previewHtml must not be present on locked card');
}

describe('code store paywall', () => {
  test('public listing never includes source code or preview HTML', async () => {
    const res = await api(ctx.baseUrl, 'GET', '/code-products');
    assert.equal(res.status, 200);
    assert.ok(res.json.docs.length > 0);
    for (const card of res.json.docs) assertNoLeak(card);
  });

  test('guest detail is locked and contains no code', async () => {
    const id = await firstPaidSnippetId();
    const res = await api(ctx.baseUrl, 'GET', `/code-products/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.locked, true);
    assertNoLeak(res.json.doc);
  });

  test('authenticated non-buyer detail is locked and contains no code', async () => {
    const id = await firstPaidSnippetId();
    const { token } = await registerAndLogin(ctx.baseUrl);
    const res = await api(ctx.baseUrl, 'GET', `/code-products/${id}`, { token });
    assert.equal(res.status, 200);
    assert.equal(res.json.locked, true);
    assertNoLeak(res.json.doc);
  });

  test('admin can view the source code without purchasing', async () => {
    const id = await firstPaidSnippetId();
    const { token, userId } = await registerAndLogin(ctx.baseUrl);
    await db.update('users', userId, { role: 'admin', accountType: 'admin' });
    const res = await api(ctx.baseUrl, 'GET', `/code-products/${id}`, { token });
    assert.equal(res.status, 200);
    assert.notEqual(res.json.locked, true);
    assert.ok(res.json.doc.code && res.json.doc.code.length > 0, 'admin sees the code');
  });
});
describe('code product purchase flow — cart → checkout → capture → unlock', () => {
  test('snippet can be added to cart and purchased (code_products fallback)', async () => {
    const { token } = await registerAndLogin(ctx.baseUrl);
    const listing = await api(ctx.baseUrl, 'GET', '/code-products');
    assert.equal(listing.status, 200);
    const snippet = listing.json.docs.find((d) => Number(d.price) > 0);
    assert.ok(snippet, 'paid snippet exists');

    const add = await api(ctx.baseUrl, 'POST', '/cart/items', {
      token,
      body: { productId: snippet.id, quantity: 1 },
    });
    assert.equal(add.status, 200, 'cart add must succeed for a code product');
    assert.ok(add.json.cart.items.some((it) => it.productId === snippet.id), 'item is in cart');

    const checkout = await api(ctx.baseUrl, 'POST', '/orders/checkout', {
      token,
      body: { provider: 'manual', billingName: 'Test Buyer' },
    });
    assert.equal(checkout.status, 201, 'checkout creates order + payment');
    const paymentId = checkout.json.payment.id;
    assert.ok(paymentId, 'payment id present');

    // Capture settles the manual payment.
    const capture = await api(ctx.baseUrl, 'POST', `/payments/${paymentId}/capture`, { token });
    assert.equal(capture.status, 200);
    assert.equal(capture.json.status, 'succeeded');

    const order = await api(ctx.baseUrl, 'GET', '/orders', { token });
    assert.equal(order.json.docs[0].status, 'paid', 'order becomes paid after capture');
  });

  test('purchaser now sees the source code (ownership unlocks)', async () => {
    const { token } = await registerAndLogin(ctx.baseUrl);
    const listing = await api(ctx.baseUrl, 'GET', '/code-products');
    const snippet = listing.json.docs.find((d) => Number(d.price) > 0);
    assert.ok(snippet);

    // Add, checkout, capture in one go.
    await api(ctx.baseUrl, 'POST', '/cart/items', {
      token,
      body: { productId: snippet.id, quantity: 1 },
    });
    const checkout = await api(ctx.baseUrl, 'POST', '/orders/checkout', {
      token,
      body: { provider: 'manual', billingName: 'Test Buyer' },
    });
    const paymentId = checkout.json.payment.id;
    await api(ctx.baseUrl, 'POST', `/payments/${paymentId}/capture`, { token });

    const detail = await api(ctx.baseUrl, 'GET', `/code-products/${snippet.id}`, { token });
    assert.equal(detail.status, 200);
    assert.notEqual(detail.json.locked, true, 'lock is cleared after purchase');
    assert.ok(detail.json.doc.code && detail.json.doc.code.length > 0, 'code is delivered to buyer');
    assert.ok(detail.json.doc.previewHtml && detail.json.doc.previewHtml.length > 0, 'preview rendered');
  });

  test('two different buyers each unlock only their own snippet', async () => {
    const buyerA = await registerAndLogin(ctx.baseUrl);
    const buyerB = await registerAndLogin(ctx.baseUrl);
    const listing = await api(ctx.baseUrl, 'GET', '/code-products');
    const snippets = listing.json.docs.filter((d) => Number(d.price) > 0);
    assert.ok(snippets.length >= 2, 'need at least two paid snippets for this test');

    const aId = snippets[0].id;
    const bId = snippets[1].id;

    const addA = await api(ctx.baseUrl, 'POST', '/cart/items', {
      token: buyerA.token,
      body: { productId: aId, quantity: 1 },
    });
    assert.equal(addA.status, 200);
    const buyA = await api(ctx.baseUrl, 'POST', '/orders/checkout', {
      token: buyerA.token,
      body: { provider: 'manual', billingName: 'Buyer A' },
    });
    await api(ctx.baseUrl, 'POST', `/payments/${buyA.json.payment.id}/capture`, {
      token: buyerA.token,
    });

    // A purchased A only; B purchased nothing yet.
    const aLockedBefore = await api(ctx.baseUrl, 'GET', `/code-products/${aId}`, {
      token: buyerB.token,
    });
    assert.equal(aLockedBefore.json.locked, true, "B still sees A locked");
    const aUnlockedA = await api(ctx.baseUrl, 'GET', `/code-products/${aId}`, {
      token: buyerA.token,
    });
    assert.notEqual(aUnlockedA.json.locked, true, "A sees A unlocked after purchase");

    // Now B buys B.
    const addB = await api(ctx.baseUrl, 'POST', '/cart/items', {
      token: buyerB.token,
      body: { productId: bId, quantity: 1 },
    });
    assert.equal(addB.status, 200);
    const buyB = await api(ctx.baseUrl, 'POST', '/orders/checkout', {
      token: buyerB.token,
      body: { provider: 'manual', billingName: 'Buyer B' },
    });
    await api(ctx.baseUrl, 'POST', `/payments/${buyB.json.payment.id}/capture`, {
      token: buyerB.token,
    });

    const bUnlockedB = await api(ctx.baseUrl, 'GET', `/code-products/${bId}`, {
      token: buyerB.token,
    });
    assert.notEqual(bUnlockedB.json.locked, true, "B sees B unlocked after purchase");
    assert.ok(bUnlockedB.json.doc.code.length > 0, 'B receives code for B');

    const aStillLockedB = await api(ctx.baseUrl, 'GET', `/code-products/${aId}`, {
      token: buyerB.token,
    });
    assert.equal(aStillLockedB.json.locked, true, "B still cannot see A's code");
  });
});
