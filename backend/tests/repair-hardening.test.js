/**
 * Repair & hardening test suite — covers the Phase 1-27 fixes:
 * password change, email verification, coupons end-to-end, idempotent +
 * duplicate-proof checkout, entitlements/downloads, refunds, webhooks,
 * subscription activation, draft protection, admin system/settings, backups,
 * and safe file delivery (SVG forced download).
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { db, startApp, api, registerAndLogin } = require('./helpers');
const { hashPassword } = require('../src/security/password');

let ctx;
let admin; // { email, password, token, userId }

async function makeAdmin() {
  const email = `admin${Date.now()}@test.local`;
  const password = 'Str0ngPass!word';
  await db.create('users', {
    name: 'Repair Admin', email, role: 'super_admin', accountType: 'super_admin',
    passwordHash: await hashPassword(password), status: 'active', permissions: [],
  });
  const login = await api(ctx.baseUrl, 'POST', '/auth/login', { body: { email, password } });
  assert.equal(login.status, 200, 'admin login should succeed');
  return { email, password, token: login.json.accessToken, userId: login.json.user.id };
}

before(async () => {
  ctx = await startApp();
  admin = await makeAdmin();
});

after(async () => { ctx.server.close(); await db.flush(); });

describe('password change (contract fix)', () => {
  test('wrong current password is rejected', async () => {
    const u = await registerAndLogin(ctx.baseUrl);
    const res = await api(ctx.baseUrl, 'POST', '/auth/change-password', {
      token: u.token, body: { currentPassword: 'WrongPass!99', newPassword: 'NewStr0ngPass!99' },
    });
    assert.equal(res.status, 400);
  });

  test('correct change works, old password stops working, sessions revoked', async () => {
    const u = await registerAndLogin(ctx.baseUrl);
    const res = await api(ctx.baseUrl, 'POST', '/auth/change-password', {
      token: u.token, body: { currentPassword: u.password, newPassword: 'NewStr0ngPass!99' },
    });
    assert.equal(res.status, 200);
    const oldLogin = await api(ctx.baseUrl, 'POST', '/auth/login', {
      body: { email: u.email, password: u.password },
    });
    assert.equal(oldLogin.status, 401, 'old password must stop working');
    const newLogin = await api(ctx.baseUrl, 'POST', '/auth/login', {
      body: { email: u.email, password: 'NewStr0ngPass!99' },
    });
    assert.equal(newLogin.status, 200);
    const me = await api(ctx.baseUrl, 'GET', '/auth/me', { token: u.token });
    assert.equal(me.status, 401, 'existing session must be revoked after password change');
  });
});

describe('email verification', () => {
  test('request returns dev token in test env, verify succeeds once, replay rejected', async () => {
    const u = await registerAndLogin(ctx.baseUrl);
    const req = await api(ctx.baseUrl, 'POST', '/auth/verify-request', { token: u.token, body: {} });
    assert.equal(req.status, 200);
    assert.ok(req.json.devToken, 'test env should expose the dev token');
    const verify = await api(ctx.baseUrl, 'POST', '/auth/verify-email', { body: { token: req.json.devToken } });
    assert.equal(verify.status, 200);
    const user = await db.findById('users', u.userId);
    assert.equal(user.emailVerified, true);
    const replay = await api(ctx.baseUrl, 'POST', '/auth/verify-email', { body: { token: req.json.devToken } });
    assert.equal(replay.status, 400, 'single-use token must be rejected on replay');
  });
});

describe('coupons + checkout hardening', () => {
  test('admin creates coupon, checkout applies discount, idempotency replays, duplicate purchase blocked', async () => {
    const u = await registerAndLogin(ctx.baseUrl);
    const created = await api(ctx.baseUrl, 'POST', '/admin/coupons', {
      token: admin.token,
      body: { code: 'REPAIR10', percent: 10, maxUses: 5, perUserLimit: 2 },
    });
    assert.equal(created.status, 201);

    const products = await api(ctx.baseUrl, 'GET', '/products');
    const product = products.json.docs.find((p) => p.status === 'published');
    await api(ctx.baseUrl, 'POST', '/cart/items', { token: u.token, body: { productId: product.id, quantity: 1 } });

    const checkout = await api(ctx.baseUrl, 'POST', '/orders/checkout', {
      token: u.token,
      body: { provider: 'manual', couponCode: 'REPAIR10', idempotencyKey: 'idem-repair-1' },
    });
    assert.equal(checkout.status, 201);
    assert.equal(checkout.json.order.couponCode, 'REPAIR10');
    assert.ok(checkout.json.order.discount > 0);
    assert.equal(checkout.json.order.total, Math.round((product.price * 0.9) * 100) / 100);

    const replay = await api(ctx.baseUrl, 'POST', '/orders/checkout', {
      token: u.token,
      body: { provider: 'manual', couponCode: 'REPAIR10', idempotencyKey: 'idem-repair-1' },
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.json.reused, true);
    assert.equal(replay.json.order.id, checkout.json.order.id, 'idempotent replay returns the original order');

    const capture = await api(ctx.baseUrl, 'POST', `/payments/${checkout.json.payment.id}/capture`, { token: u.token, body: {} });
    assert.equal(capture.status, 200);
    assert.equal(capture.json.status, 'succeeded');

    const order = await db.findById('orders', checkout.json.order.id);
    assert.equal(order.status, 'paid');
    const coupon = (await db.find('coupons', { code: 'REPAIR10' })).docs[0];
    assert.equal(coupon.usedCount, 1, 'coupon usage must be incremented on successful checkout');

    await api(ctx.baseUrl, 'POST', '/cart/items', { token: u.token, body: { productId: product.id, quantity: 1 } });
    const dup = await api(ctx.baseUrl, 'POST', '/orders/checkout', {
      token: u.token, body: { provider: 'manual' },
    });
    assert.equal(dup.status, 409, 'duplicate purchase must be rejected');

    const ents = await api(ctx.baseUrl, 'GET', '/entitlements/mine', { token: u.token });
    assert.ok(ents.json.docs.some((e) => e.productId === product.id && e.status === 'active'));
  });

  test('expired coupon is rejected', async () => {
    const u = await registerAndLogin(ctx.baseUrl);
    const created = await api(ctx.baseUrl, 'POST', '/admin/coupons', {
      token: admin.token,
      body: { code: 'OLDCODE', percent: 5, expiresAt: '2000-01-01T00:00:00.000Z' },
    });
    assert.equal(created.status, 201);
    const res = await api(ctx.baseUrl, 'POST', '/coupons/validate', { token: u.token, body: { code: 'OLDCODE' } });
    assert.equal(res.status, 400);
  });

  test('per-user limit blocks repeat redemption', async () => {
    const u = await registerAndLogin(ctx.baseUrl);
    const created = await api(ctx.baseUrl, 'POST', '/admin/coupons', {
      token: admin.token, body: { code: 'ONCEONLY', percent: 20, perUserLimit: 1 },
    });
    assert.equal(created.status, 201);
    const ok = await api(ctx.baseUrl, 'POST', '/coupons/validate', { token: u.token, body: { code: 'ONCEONLY' } });
    assert.equal(ok.status, 200);
    await db.create('coupon_redemptions', { couponId: created.json.coupon.id, code: 'ONCEONLY', userId: u.userId, amount: 1 });
    const again = await api(ctx.baseUrl, 'POST', '/coupons/validate', { token: u.token, body: { code: 'ONCEONLY' } });
    assert.equal(again.status, 400, 'per-user limit must block reuse');
  });
});

describe('code purchase, entitlement download, refund revocation, webhook', () => {
  test('full cycle: buy code -> download -> refund -> download revoked; webhook rejected', async () => {
    const u = await registerAndLogin(ctx.baseUrl);
    const list = await api(ctx.baseUrl, 'GET', '/code-products');
    const snippet = list.json.docs[0];
    assert.ok(snippet, 'seeded code products should exist');
    await api(ctx.baseUrl, 'POST', '/cart/items', { token: u.token, body: { productId: snippet.id, quantity: 1 } });
    const checkout = await api(ctx.baseUrl, 'POST', '/orders/checkout', {
      token: u.token, body: { provider: 'manual', idempotencyKey: 'code-repair-1' },
    });
    assert.equal(checkout.status, 201);
    const capture = await api(ctx.baseUrl, 'POST', `/payments/${checkout.json.payment.id}/capture`, { token: u.token, body: {} });
    assert.equal(capture.json.status, 'succeeded');

    const dl = await api(ctx.baseUrl, 'GET', `/downloads/code/${snippet.id}`, { token: u.token });
    assert.equal(dl.status, 200);
    assert.ok(dl.json.doc.code, 'entitled buyer receives the source code');

    const ent = (await db.find('entitlements', { userId: u.userId, productKind: 'code', productId: snippet.id })).docs[0];
    assert.ok(ent, 'entitlement created on capture');

    const hook = await api(ctx.baseUrl, 'POST', '/payments/webhook/manual', { body: { providerRef: 'whatever' } });
    assert.equal(hook.status, 400, 'unverified webhook must be rejected');

    const payment = checkout.json.payment;
    const refund = await api(ctx.baseUrl, 'POST', `/payments/${payment.id}/refund`, {
      token: admin.token, body: { reason: 'repair-test' },
    });
    assert.equal(refund.status, 200);
    assert.equal(refund.json.paymentStatus, 'refunded');
    const revoked = await db.findById('entitlements', ent.id);
    assert.equal(revoked.status, 'refunded');
    const dl2 = await api(ctx.baseUrl, 'GET', `/downloads/code/${snippet.id}`, { token: u.token });
    assert.equal(dl2.status, 403, 'revoked entitlement must not download');
    const reRefund = await api(ctx.baseUrl, 'POST', `/payments/${payment.id}/refund`, { token: admin.token, body: {} });
    assert.equal(reRefund.status, 400, 'double refund must be rejected');
  });
});

describe('subscriptions activate only on capture', () => {
  test('subscribe -> pending; capture -> active; duplicate blocked', async () => {
    const u = await registerAndLogin(ctx.baseUrl);
    const sub = await api(ctx.baseUrl, 'POST', '/subscriptions/subscribe', {
      token: u.token, body: { planId: 'starter-weekly', provider: 'manual' },
    });
    assert.equal(sub.status, 201);
    assert.equal(sub.json.subscription.status, 'pending');
    assert.equal(sub.json.order.status, 'processing');
    const mine1 = await api(ctx.baseUrl, 'GET', '/subscriptions/mine', { token: u.token });
    assert.ok(mine1.json.docs.every((s) => s.status !== 'active'), 'no active subscription before capture');
    const capture = await api(ctx.baseUrl, 'POST', `/payments/${sub.json.payment.id}/capture`, { token: u.token, body: {} });
    assert.equal(capture.json.status, 'succeeded');
    const mine2 = await api(ctx.baseUrl, 'GET', '/subscriptions/mine', { token: u.token });
    assert.ok(mine2.json.docs.some((s) => s.status === 'active' && s.renewsAt));
    const again = await api(ctx.baseUrl, 'POST', '/subscriptions/subscribe', {
      token: u.token, body: { planId: 'starter-weekly', provider: 'manual' },
    });
    assert.equal(again.status, 409, 'duplicate active subscription blocked');
  });
});

describe('draft protection + admin surfaces', () => {
  test('admin-created users require a strong password and consistent account type', async () => {
    const weak = await api(ctx.baseUrl, 'POST', '/admin/users', {
      token: admin.token,
      body: { name: 'Weak Admin User', email: `weak-admin-${Date.now()}@test.local`, password: 'weakpassword1', role: 'user', accountType: 'super_admin' },
    });
    assert.equal(weak.status, 400);

    const created = await api(ctx.baseUrl, 'POST', '/admin/users', {
      token: admin.token,
      body: { name: 'Strong Admin User', email: `strong-admin-${Date.now()}@test.local`, password: 'StrongPassword1', role: 'user', accountType: 'super_admin' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.user.role, 'user');
    assert.equal(created.json.user.accountType, 'user');
  });

  test('projects are isolated by owner and ignore forged ownerId', async () => {
    const first = await registerAndLogin(ctx.baseUrl);
    const second = await registerAndLogin(ctx.baseUrl);
    const created = await api(ctx.baseUrl, 'POST', '/projects', {
      token: first.token,
      body: { name: 'Private project', ownerId: second.userId, plan: {} },
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.doc.ownerId, first.userId, 'server must assign project ownership');

    const hiddenList = await api(ctx.baseUrl, 'GET', '/projects', { token: second.token });
    assert.equal(hiddenList.status, 200);
    assert.ok(!hiddenList.json.docs.some((project) => project.id === created.json.doc.id));

    const hiddenGet = await api(ctx.baseUrl, 'GET', `/projects/${created.json.doc.id}`, { token: second.token });
    assert.equal(hiddenGet.status, 404);
    const hiddenUpdate = await api(ctx.baseUrl, 'PUT', `/projects/${created.json.doc.id}`, {
      token: second.token, body: { name: 'Hijacked' },
    });
    assert.equal(hiddenUpdate.status, 404);
    const hiddenDelete = await api(ctx.baseUrl, 'DELETE', `/projects/${created.json.doc.id}`, { token: second.token });
    assert.equal(hiddenDelete.status, 404);
  });

  test('draft products are hidden from public list and direct GET', async () => {
    const created = await api(ctx.baseUrl, 'POST', '/products', {
      token: admin.token, body: { name: 'Secret Draft', price: 123, status: 'draft', currency: 'USD' },
    });
    assert.equal(created.status, 201);
    const anonGet = await api(ctx.baseUrl, 'GET', `/products/${created.json.doc.id}`);
    assert.equal(anonGet.status, 404, 'drafts must not leak via direct ID');
    const anonList = await api(ctx.baseUrl, 'GET', '/products');
    assert.ok(!anonList.json.docs.some((p) => p.id === created.json.doc.id));
    const adminGet = await api(ctx.baseUrl, 'GET', `/products/${created.json.doc.id}`, { token: admin.token });
    assert.equal(adminGet.status, 200, 'admins may read drafts');
  });

  test('mass assignment is blocked on generic create', async () => {
    const created = await api(ctx.baseUrl, 'POST', '/products', {
      token: admin.token,
      body: { name: 'MassTest', price: 5, currency: 'USD', status: 'published', passwordHash: 'x', role: 'admin', createdAt: '1999-01-01', id: 'forged-id' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.doc.passwordHash, undefined, 'sensitive fields rejected');
    assert.equal(created.json.doc.role, undefined, 'role escalation rejected');
    assert.notEqual(created.json.doc.id, 'forged-id', 'forged id rejected (server generates UUID)');
    assert.notEqual(created.json.doc.createdAt, '1999-01-01', 'client-controlled createdAt rejected');
  });

  test('admin system status + settings; user forbidden', async () => {
    const user = await registerAndLogin(ctx.baseUrl);
    const sysUser = await api(ctx.baseUrl, 'GET', '/admin/system', { token: user.token });
    assert.equal(sysUser.status, 403);
    const sys = await api(ctx.baseUrl, 'GET', '/admin/system', { token: admin.token });
    assert.equal(sys.status, 200);
    assert.equal(sys.json.system.db.type, 'json');
    assert.ok(sys.json.system.redis);
    const put = await api(ctx.baseUrl, 'PUT', '/admin/settings', {
      token: admin.token, body: { settings: { maintenance: { enabled: false } } },
    });
    assert.equal(put.status, 200);
    const get = await api(ctx.baseUrl, 'GET', '/admin/settings', { token: admin.token });
    assert.deepEqual(get.json.settings.maintenance, { enabled: false });
    const putUser = await api(ctx.baseUrl, 'PUT', '/admin/settings', {
      token: user.token, body: { settings: { hack: true } },
    });
    assert.equal(putUser.status, 403, 'settings writes are permission-gated');
  });

  test('orders admin list is scoped to admins', async () => {
    const user = await registerAndLogin(ctx.baseUrl);
    const forbidden = await api(ctx.baseUrl, 'GET', '/admin/orders', { token: user.token });
    assert.equal(forbidden.status, 403);
    const ok = await api(ctx.baseUrl, 'GET', '/admin/orders', { token: admin.token });
    assert.equal(ok.status, 200);
  });
});

describe('backups report per-table results', () => {
  test('restore returns perTable detail instead of a silent partial success', async () => {
    const created = await api(ctx.baseUrl, 'POST', '/admin/backup', { token: admin.token, body: {} });
    assert.equal(created.status, 201);
    const restored = await api(ctx.baseUrl, 'POST', '/admin/backups/restore', {
      token: admin.token, body: { name: created.json.backup.name },
    });
    assert.equal(restored.status, 200);
    assert.ok(restored.json.result.perTable, 'per-table report required');
    assert.equal(typeof restored.json.result.skipped, 'number');
  });
});

describe('file storage safety', () => {
  test('SVG upload is stored on disk and delivered as attachment (never inline)', async () => {
    const u = await registerAndLogin(ctx.baseUrl);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>').toString('base64');
    const up = await api(ctx.baseUrl, 'POST', '/chat/attachments', {
      token: u.token,
      body: { name: 'evil.svg', mime: 'image/svg+xml', dataUrl: `data:image/svg+xml;base64,${svg}` },
    });
    assert.equal(up.status, 201);
    const attachment = await db.findById('chat_attachments', up.json.attachment.id);
    assert.ok(attachment.storageKey, 'bytes stored on disk, not inline');
    const raw = await fetch(`${ctx.baseUrl}/chat/attachments/${up.json.attachment.id}`, {
      headers: { Authorization: `Bearer ${u.token}` },
    });
    assert.equal(raw.status, 200);
    assert.match(String(raw.headers.get('content-disposition')), /^attachment/i, 'SVG must download, never render inline');
    assert.equal(raw.headers.get('x-content-type-options'), 'nosniff');
  });

  test('oversized upload is rejected', async () => {
    const u = await registerAndLogin(ctx.baseUrl);
    const big = 'A'.repeat(3 * 1024 * 1024);
    const up = await api(ctx.baseUrl, 'POST', '/chat/attachments', {
      token: u.token, body: { name: 'big.png', mime: 'image/png', dataUrl: `data:image/png;base64,${big}` },
    });
    assert.equal(up.status, 400);
  });
});
