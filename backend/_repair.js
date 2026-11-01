// repair-payment-review-tests.js
// Fixes order of order/payment creation in payment-review.test.js
const fs = require('fs');
const path = 'd:/cnw/Creat_New_Website(CNW)/backend/tests/payment-review.test.js';
let content = fs.readFileSync(path, 'utf8');

// Fix 1: "admin can approve an instapay payment"
// Old: payment created with orderId:'o-approve', THEN order created
// New: order created first, THEN payment with order.id
const approveOld = `    const payment = await db.create('payments', { orderId: 'o-approve', userId, provider: 'instapay', providerRef: 'I-APPROVE', amount: 599, currency: 'USD', status: 'pending', reviewStatus: 'submitted', customerReference: 'TXN-001' });
    const order = await db.create('orders', { userId, items: [{ productId: 'p-app', productKind: 'product', name: 'Approved Pkg', unitPrice: 599, currency: 'USD', quantity: 1 }], subtotal: 599, discount: 0, total: 599, currency: 'USD', status: 'pending', paymentId: payment.id, couponCode: '' });`;

const approveNew = `    const order = await db.create('orders', { userId, items: [{ productId: 'p-app', productKind: 'product', name: 'Approved Pkg', unitPrice: 599, currency: 'USD', quantity: 1 }], subtotal: 599, discount: 0, total: 599, currency: 'USD', status: 'pending', couponCode: '' });
    const payment = await db.create('payments', { orderId: order.id, userId, provider: 'instapay', providerRef: 'I-APPROVE', amount: 599, currency: 'USD', status: 'pending', reviewStatus: 'submitted', customerReference: 'TXN-001' });`;

if (content.includes(approveOld)) {
  content = content.replace(approveOld, approveNew);
  console.log('FIXED: admin can approve');
} else {
  console.log('NOT FOUND: approve block');
}

// Fix 2: "admin can reject a wallet payment"
const rejectOld = `    await db.update('users', userId, { role: 'admin', accountType: 'admin' });
    await db.create('coupons', { code: 'TST', percent: 10, status: 'active', createdBy: userId });
    const order = await db.create('orders', { userId, items: [{ productId: 'p-rej', productKind: 'product', name: 'Rejected Pkg', unitPrice: 299, currency: 'USD', quantity: 1 }], subtotal: 299, discount: 0, total: 299, currency: 'USD', status: 'pending', couponCode: 'TST' });
    const payment = await db.create('payments', { orderId: order.id, userId, provider: 'wallet', providerRef: 'W-REJECT', amount: 299, currency: 'USD', status: 'pending', reviewStatus: 'submitted' });`;

// Check what the reject block actually looks like
const rejectStartIdx = content.indexOf("test('admin can reject a wallet payment'");
if (rejectStartIdx >= 0) {
  const rejectBlock = content.substring(rejectStartIdx, rejectStartIdx + 600);
  console.log('REJECT BLOCK START:');
  console.log(rejectBlock);
}

fs.writeFileSync(path, content);
console.log('DONE');
