/** Cart page. */
import { api } from '../api/client.js';
import { getUser } from '../auth/store.js';
import { getCart, setCart } from '../utils/cart-store.js';
import { toast, formatPrice, escapeHtml } from '../utils/toast.js';
import { href } from '../links.js';

export async function render(page) {
  let items = getCart();

  // Logged-in users use the server cart (authoritative & secure).
  if (getUser()) {
    try {
      // Push local items into server cart once.
      for (const it of items) {
        await api.post('/cart/items', { productId: it.productId, quantity: it.quantity }).catch(() => {});
      }
      setCart([]);
      const res = await api.get('/cart');
      items = res.cart.items;
      setCart(items.map((it) => ({ productId: it.productId, name: it.name, unitPrice: it.unitPrice, currency: it.currency, quantity: it.quantity })));
    } catch { /* keep local cart on API failure */ }
  }

  const total = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);

  if (!items.length) {
    page.innerHTML = `
      <section class="section"><div class="container" style="text-align:center">
        <h1 class="section-title">Your cart is empty</h1>
        <p class="section-sub" style="margin:0 auto 24px">Explore our design packages to get started.</p>
        <a href="${href('/designs')}" class="btn btn-primary">Browse designs</a>
      </div></section>`;
    return;
  }

  page.innerHTML = `
    <section class="section">
      <div class="container">
        <h1 class="section-title" data-animate>Your Cart</h1>
        <div class="table-wrap" data-animate>
          <table>
            <thead><tr><th>Item</th><th>Price</th><th>Quantity</th><th>Subtotal</th><th></th></tr></thead>
            <tbody>
              ${items.map((it) => `
                <tr>
                  <td>${escapeHtml(it.name)}</td>
                  <td>${formatPrice(it.unitPrice, it.currency)}</td>
                  <td>
                    <input type="number" min="1" max="99" value="${it.quantity}" data-qty="${it.productId}"
                      style="width:80px" ${getUser() ? '' : ''} />
                  </td>
                  <td>${formatPrice(it.unitPrice * it.quantity, it.currency)}</td>
                  <td><button class="btn btn-sm btn-danger" data-remove="${it.productId}">Remove</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="card" style="margin-top:24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px">
          <div>
            <h3>Total: <span class="gradient-text" style="font-size:1.6rem">${formatPrice(total, items[0]?.currency || 'USD')}</span></h3>
          </div>
          <div style="display:flex;gap:12px">
            <button class="btn btn-ghost" id="clear-cart">Clear cart</button>
            <a href="${href('/payment')}" class="btn btn-primary">Continue to payment →</a>
          </div>
        </div>
      </div>
    </section>`;

  const updateLocal = (productId, qty) => {
    const cart = getCart();
    const it = cart.find((x) => x.productId === productId);
    if (it) it.quantity = qty;
    setCart(cart);
    render(page); // re-render
  };

  page.querySelectorAll('[data-qty]').forEach((input) => {
    input.addEventListener('change', async () => {
      const productId = input.dataset.qty;
      const qty = Math.max(1, Math.min(99, parseInt(input.value, 10) || 1));
      if (getUser()) {
        try {
          await api.put(`/cart/items/${productId}`, { quantity: qty });
          updateLocal(productId, qty);
        } catch (e) { toast(e.message, 'error'); }
      } else updateLocal(productId, qty);
    });
  });

  page.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const productId = btn.dataset.remove;
      if (getUser()) { try { await api.del(`/cart/items/${productId}`); } catch { /* offline */ } }
      setCart(getCart().filter((x) => x.productId !== productId));
      render(page);
    });
  });

  page.querySelector('#clear-cart').addEventListener('click', async () => {
    if (getUser()) { try { await api.del('/cart'); } catch { /* offline */ } }
    setCart([]);
    render(page);
  });
}
