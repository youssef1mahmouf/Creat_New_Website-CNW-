/** Payment page — provider-agnostic checkout (no raw card data ever handled). */
import { api } from '../api/client.js';
import { getUser } from '../auth/store.js';
import { toast, formatPrice, escapeHtml } from '../utils/toast.js';
import { go } from '../links.js';

export async function render(page) {
  if (!getUser()) {
    toast('Please sign in to continue to payment', 'error');
    go('/login');
    return;
  }

  let cart, providers;
  try {
    cart = (await api.get('/cart')).cart;
    providers = (await api.get('/payments/providers')).providers;
  } catch (e) {
    page.innerHTML = `<section class="section"><div class="container"><p class="error-text">${escapeHtml(e.message)}</p></div></section>`;
    return;
  }

  const total = cart.items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);

  page.innerHTML = `
    <section class="section">
      <div class="container" style="max-width:640px">
        <h1 class="section-title" data-animate>Payment</h1>
        <p class="section-sub" data-animate>Secure checkout. CNW never stores raw card numbers or CVV — providers handle payment data directly.</p>
        <div class="card" data-animate>
          <h3>Order summary</h3>
          <ul class="features">
            ${cart.items.map((it) => `<li>${it.quantity} × ${it.name} — ${formatPrice(it.unitPrice * it.quantity, it.currency)}</li>`).join('')}
          </ul>
          <h3 style="margin-bottom:12px">Total: <span class="gradient-text">${formatPrice(total, cart.items[0]?.currency || 'USD')}</span></h3>
          <form class="form" id="pay-form" style="max-width:none">
            <label>Payment provider
              <select name="provider">${providers.map((p) => `<option value="${p}">${p}</option>`).join('')}</select>
            </label>
            <label>Billing name <input name="billingName" required maxlength="120" /></label>
            <label>Billing country <input name="billingCountry" maxlength="60" /></label>
            <button class="btn btn-primary" type="submit">Place order</button>
            <p class="error-text" id="pay-error"></p>
          </form>
        </div>
      </div>
    </section>`;

  page.querySelector('#pay-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = page.querySelector('#pay-error');
    errEl.textContent = '';
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const fd = new FormData(e.target);
      const res = await api.post('/orders/checkout', {
        provider: fd.get('provider'),
        billingName: fd.get('billingName'),
        billingCountry: fd.get('billingCountry'),
      });
      toast(`Order placed (${res.order.status}). Confirming payment…`);
      // Capture with the selected provider
      await api.post(`/payments/${res.payment.id}/capture`);
      toast('Payment confirmed! Thank you.');
      go('/dashboard');
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
    }
  });
}
