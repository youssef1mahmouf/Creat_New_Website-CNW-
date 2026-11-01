// Writer part 1 — writes payment-review.test.js (header + auth gate tests + approve test)
const fs = require('fs');
const L = (s) => out.push(s);
const out = [];

L('/** Integration test: InstaPay / wallet admin review flow. */');
L("const { test, describe } = require('node:test');");
L('const assert = require("node:assert");');
L('const { db, startApp, api, registerAndLogin } = require("./helpers");');
L('');
L('describe("InstaPay / wallet admin review flow", () => {');
L('  test("pending-review list requires auth", async () => {');
L('    const ctx = await startApp();');
L('    const res = await api(ctx.baseUrl, "GET", "/admin/payments/pending-review");');
L('    assert.equal(res.status, 401);');
L('    ctx.server.close(); await db.flush();');
L('  });');
L('');
L('  test("approve requires auth", async () => {');
L('    const ctx = await startApp();');
L('    const payment = await db.create("payments", { orderId: "o1", userId: "u1", provider: "instapay", providerRef: "I1", amount: 599, currency: "USD", status: "pending", reviewStatus: "submitted" });');
L('    await db.create("orders", { userId: "u1", items: [{ productId: "p1", productKind: "product", name: "T", unitPrice: 599, currency: "USD", quantity: 1 }], subtotal: 599, discount: 0, total: 599, currency: "USD", status: "pending", paymentId: payment.id });');
L('    const res = await api(ctx.baseUrl, "POST", "/admin/payments/" + payment.id + "/approve", { body: {} });');
L('    assert.equal(res.status, 401);');
L('    ctx.server.close(); await db.flush();');
L('  });');
L('');
L('  test("reject requires auth", async () => {');
L('    const ctx = await startApp();');
L('    const payment = await db.create("payments", { orderId: "o2", userId: "u2", provider: "wallet", providerRef: "W1", amount: 299, currency: "USD", status: "pending", reviewStatus: "submitted" });');
L('    await db.create("orders", { userId: "u2", items: [{ productId: "p2", productKind: "product", name: "T2", unitPrice: 299, currency: "USD", quantity: 1 }], subtotal: 299, discount: 0, total: 299, currency: "USD", status: "pending", paymentId: payment.id });');
L('    const res = await api(ctx.baseUrl, "POST", "/admin/payments/" + payment.id + "/reject", { body: { reason: "test" } });');
L('    assert.equal(res.status, 401);');
L('    ctx.server.close(); await db.flush();');
L('  });');
L('');

// Admin approves instapay payment (uses order-first pattern)
L('  test("admin can approve an instapay payment", async () => {');
L('    const ctx = await startApp();');
L('    const { token, userId } = await registerAndLogin(ctx.baseUrl);');
L('    await db.update("users", userId, { role: "admin", accountType: "admin" });');
L('    const order = await db.create("orders", { userId, items: [{ productId: "p-app", productKind: "product", name: "Approved Pkg", unitPrice: 599, currency: "USD", quantity: 1 }], subtotal: 599, discount: 0, total: 599, currency: "USD", status: "pending", couponCode: "" });');
L('    const payment = await db.create("payments", { orderId: order.id, userId, provider: "instapay", providerRef: "I-APPROVE", amount: 599, currency: "USD", status: "pending", reviewStatus: "submitted", customerReference: "TXN-001" });');
L('    const res = await api(ctx.baseUrl, "POST", "/admin/payments/" + payment.id + "/approve", { token, body: {} });');
L('    assert.equal(res.status, 200);');
L('    assert.equal(res.json.status, "succeeded");');
L('    const up = await db.findById("payments", payment.id);');
L('    assert.equal(up.status, "succeeded");');
L('    assert.equal(up.reviewStatus, "approved");');
L('    assert.ok(up.reviewedBy && up.reviewedAt);');
L('    const uo = await db.findById("orders", order.id);');
L('    assert.equal(uo.status, "paid");');
L('    const ents = await db.find("entitlements", { userId, productKind: "product", productId: "p-app" }, { limit: 1 });');
L('    assert.ok(ents.docs.length > 0, "entitlement granted on approve");');
L('    ctx.server.close(); await db.flush();');
L('  });');
L('');

// Admin rejects wallet payment (uses order-first pattern)
L('  test("admin can reject a wallet payment", async () => {');
L('    const ctx = await startApp();');
L('    const { token, userId } = await registerAndLogin(ctx.baseUrl);');
L('    await db.update("users", userId, { role: "admin", accountType: "admin" });');
L('    await db.create("coupons", { code: "TST", percent: 10, status: "active", createdBy: userId });');
L('    const order = await db.create("orders", { userId, items: [{ productId: "p-rej", productKind: "product", name: "Rejected Pkg", unitPrice: 299, currency: "USD", quantity: 1 }], subtotal: 299, discount: 0, total: 299, currency: "USD", status: "pending", couponCode: "TST" });');
L('    const payment = await db.create("payments", { orderId: order.id, userId, provider: "wallet", providerRef: "W-REJECT", amount: 299, currency: "USD", status: "pending", reviewStatus: "submitted" });');
L('    const res = await api(ctx.baseUrl, "POST", "/admin/payments/" + payment.id + "/reject", { token, body: { reason: "Transfer not received" } });');
L('    assert.equal(res.status, 200);');
L('    assert.equal(res.json.status, "failed");');
L('    const up = await db.findById("payments", payment.id);');
L('    assert.equal(up.status, "failed");');
L('    assert.equal(up.reviewStatus, "rejected");');
L('    assert.equal(up.rejectionReason, "Transfer not received");');
L('    const uo = await db.findById("orders", order.id);');
L('    assert.equal(uo.status, "failed");');
L('    ctx.server.close(); await db.flush();');
L('  });');

// Write part 1
fs.writeFileSync('d:/cnw/Creat_New_Website(CNW)/backend/tests/payment-review.test.js', out.join('\n') + '\n');
console.log('PART1 OK:', out.length, 'lines');
