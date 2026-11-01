/** Simple client-side cart persistence (server cart is authoritative when logged in). */
const KEY = 'cnw_cart';
const listeners = new Set();

export function getCart() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export function setCart(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
  listeners.forEach((fn) => fn(items.length));
}

export function getCartCount() {
  return getCart().reduce((n, it) => n + it.quantity, 0);
}

export function onCartChange(fn) { listeners.add(fn); }
