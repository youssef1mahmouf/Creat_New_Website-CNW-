// Fix the payment-review.test.js - correct order of order/payment creation
const fs = require('fs');
const path = 'd:/cnw/Creat_New_Website(CNW)/backend/tests/payment-review.test.js';
let c = fs.readFileSync(path, 'utf8');

// Fix 1: Admin can approve - swap to order-first pattern
const old1 = `    const payment = await db.create('payments', { orderId: 'o-approve', userId, provider: 'instapay', providerRef: 'I-APPROVE', amount: 599, currency: 'USD', status: 'pending', reviewStatus: 'submitted', customerReference: 'TXN-001' });
    const order = await db.create('orders', { userId, items: [{ productId: 'p-app', productKind: 'product', name: 'Approved Pkg', unitPrice: 599, currency: 'USD', quantity: 1 }], subtotal: 599, discount: 0, total: 599, currency: 'USD', status: 'pending', paymentId: payment.id, couponCode: '' });`;

const new1 = `    const order = await db.create('orders', { userId, items: [{ productId: 'p-app', productKind: 'product', name: 'Approved Pkg', unitPrice: 599, currency: 'USD', quantity: 1 }], subtotal: 599, discount: 0, total: 599, currency: 'USD', status: 'pending', couponCode: '' });
    const payment = await db.create('payments', { orderId: order.id, userId, provider: 'instapay', providerRef: 'I-APPROVE', amount: 599, currency: 'USD', status: 'pending', reviewStatus: 'submitted', customerReference: 'TXN-001' });`;

if (c.includes(old1)) {
  c = c.replace(old1, new1);
  console.log('Fixed approve test');
} else {
  console.log('Approve test already fixed or not found');
}

// Fix 2: Admin can reject - swap to order-first pattern with coupon
const old2 = `    const pm = await db.create('payments', { orderId: 'o-rej', userId, provider: 'wallet', providerRef: 'WR', amount: 299, currency: 'USD', status: 'pending', reviewStatus: 'submitted' });
    await db.create('orders', { userId, items: [{ productId: 'pr', productKind: 'product', name: 'R', unitPrice: 299, currency: 'USD', quantity: 1 }], subtotal: 299, discount: 0, total: 299, currency: 'USD', status: 'pending', paymentId: pm.id });`;

const new2 = `    await db.create('coupons', { code: 'TST', percent: 10, status: 'active', createdBy: userId });
    const order = await db.create('orders', { userId, items: [{ productId: 'pr', productKind: 'product', name: 'R', unitPrice: 299, currency: 'USD', quantity: 1 }], subtotal: 299, discount: 0, total: 299, currency: 'USD', status: 'pending', couponCode: 'TST' });
    const payment = await db.create('payments', { orderId: order.id, userId, provider: 'wallet', providerRef: 'WR', amount: 299, currency: 'USD', status: 'pending', reviewStatus: 'submitted' });`;

if (c.includes(old2)) {
  c = c.replace(old2, new2);
  console.log('Fixed reject test');
} else {
  console.log('Reject test pattern not found - searching...');
  // Try to find what the reject test actually looks like
  const start = c.indexOf("test('admin can reject a wallet payment'");
  if (start >= 0) {
    const end = c.indexOf("\n  });\n", start + 10);
    if (end > 0) {
      console.log('Current reject test content:');
      console.log(c.substring(start, end + 5));
    }
  }
}

fs.writeFileSync(path, c);
console.log('Done. File size:', c.length);
