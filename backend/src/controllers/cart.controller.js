/** Cart controller — server-side cart persisted per user (never trusted from client). */
const db = require('../services/db.service');
const ApiError = require('../utils/api-error');
const asyncHandler = require('../utils/async-handler');

async function getOrCreateCart(userId) {
  let cart = await db.findOne('carts', { userId });
  if (!cart) cart = await db.create('carts', { userId, items: [] });
  return cart;
}

function computeTotals(items) {
  const subtotal = items.reduce((sum, it) => sum + Number(it.unitPrice) * Number(it.quantity), 0);
  return { subtotal: Math.round(subtotal * 100) / 100, currency: items[0]?.currency || 'USD' };
}

exports.getCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  res.json({ success: true, cart, totals: computeTotals(cart.items) });
});

exports.addItem = asyncHandler(async (req, res) => {
  const { productId, quantity } = req.body;
  // Resolve the item from the products catalog OR the code store (snippets
  // are sellable too). Without the fallback, store snippets could never be
  // purchased — the cart add failed with "Product not found".
  let product = await db.findById('products', productId);
  if (!product || product.status !== 'published') {
    product = await db.findById('code_products', productId);
  }
  if (!product || product.status !== 'published') throw ApiError.notFound('Product not found');
  if (product.availability === 'unavailable') throw ApiError.badRequest('Product is unavailable');
  // code_products use `title`; products use `name` — normalize for the cart line.
  const displayName = product.name || product.title || 'Item';

  const cart = await getOrCreateCart(req.user.id);
  const qty = Math.max(1, Math.min(99, parseInt(quantity, 10) || 1));
  const existing = cart.items.find((it) => it.productId === productId);
  if (existing) existing.quantity = Math.min(99, existing.quantity + qty);
  else {
    cart.items.push({
      productId,
      name: displayName,
      unitPrice: product.price,
      currency: product.currency,
      quantity: qty,
    });
  }
  const updated = await db.update('carts', cart.id, { items: cart.items });
  res.json({ success: true, cart: updated, totals: computeTotals(updated.items) });
});

exports.updateItem = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  const item = cart.items.find((it) => it.productId === req.params.productId);
  if (!item) throw ApiError.notFound('Item not in cart');
  const qty = parseInt(req.body.quantity, 10);
  if (!Number.isFinite(qty) || qty < 0 || qty > 99) throw ApiError.badRequest('Invalid quantity');
  if (qty === 0) cart.items = cart.items.filter((it) => it.productId !== req.params.productId);
  else item.quantity = qty;
  const updated = await db.update('carts', cart.id, { items: cart.items });
  res.json({ success: true, cart: updated, totals: computeTotals(updated.items) });
});

exports.removeItem = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  cart.items = cart.items.filter((it) => it.productId !== req.params.productId);
  const updated = await db.update('carts', cart.id, { items: cart.items });
  res.json({ success: true, cart: updated, totals: computeTotals(updated.items) });
});

exports.clearCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  const updated = await db.update('carts', cart.id, { items: [] });
  res.json({ success: true, cart: updated });
});

exports.computeTotals = computeTotals;
exports.getOrCreateCart = getOrCreateCart;
