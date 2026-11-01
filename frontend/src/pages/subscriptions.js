/**
 * Subscriptions — paid update/care options (renews weekly or monthly).
 * Subscribing creates a real order + payment, then shows renewal dates.
 */
import { api } from '../api/client.js';
import { getUser } from '../auth/store.js';
import { getCart, setCart } from '../utils/cart-store.js';
import { toast, formatPrice, formatDate, escapeHtml } from '../utils/toast.js';
import { go } from '../links.js';

export async function render(page) {
  let plans = [];
  let mine = [];
  try {
    plans = (await api.get('/subscriptions/plans')).plans || [];
  } catch { /* backend offline */ }
  if (getUser()) {
    try { mine = (await api.get('/subscriptions/mine')).docs || []; } catch { /* offline */ }
  }

  const active = new Map(mine.filter((s) => s.status === 'active').map((s) => [s.planId, s]));

  page.innerHTML = `
    <section class="section">
      <div class="container">
        <h1 class="section-title" data-animate>Update Subscriptions</h1>
        <p class="section-sub" data-animate>Keep your website fresh — pick an update cadence: <b>every week</b> or <b>every month</b>. Cancel anytime.</p>

        <div class="grid grid-3" data-stagger>
          ${plans.map((p) => `
            <div class="card sub-card ${active.has(p.id) ? 'sub-active' : ''}" data-tilt>
              ${active.has(p.id) ? '<span class="tag ok" style="position:absolute;top:14px;right:14px">ACTIVE</span>' : ''}
              <h3>${escapeHtml(p.name)}</h3>
              <div class="price gradient-text">${formatPrice(p.price, p.currency)}<span class="sub-per"> / ${p.cadence === 'weekly' ? 'week' : 'month'}</span></div>
              <p class="lbl">Updates: ${p.cadence === 'weekly' ? 'every week' : 'every month (bundled)'}</p>
              <ul class="features">${p.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
              <button class="btn btn-primary" data-sub="${p.id}" style="width:100%;margin-top:14px" data-magnetic>
                ${active.has(p.id) ? 'Renew now' : 'Subscribe & pay'}
              </button>
            </div>`).join('') || '<p style="color:var(--muted)">Start the backend to load plans.</p>'}
        </div>

        ${mine.length ? `
          <h2 class="section-title" style="margin-top:48px;font-size:1.5rem">My subscriptions</h2>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Plan</th><th>Cadence</th><th>Price</th><th>Status</th><th>Started</th><th>Renews</th><th></th></tr></thead>
              <tbody>
                ${mine.map((s) => `
                  <tr>
                    <td>${escapeHtml(s.planName)}</td>
                    <td>${s.cadence}</td>
                    <td>${formatPrice(s.price, s.currency)}</td>
                    <td><span class="tag ${s.status === 'active' ? 'ok' : 'off'}">${s.status}</span></td>
                    <td>${formatDate(s.startedAt)}</td>
                    <td>${formatDate(s.renewsAt)}</td>
                    <td>${s.status === 'active' ? `<button class="btn btn-sm btn-danger" data-cancel="${s.id}">Cancel</button>` : ''}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : ''}
      </div>
    </section>`;

  page.querySelectorAll('[data-sub]').forEach((btn) => btn.addEventListener('click', async () => {
    const plan = plans.find((p) => p.id === btn.dataset.sub);
    if (!plan) return;
    if (!getUser()) { toast('Please sign in to subscribe', 'error'); go('/login'); return; }
    btn.disabled = true;
    try {
      // Put the plan in the cart for a consistent checkout record, then subscribe directly.
      const cart = getCart();
      cart.push({ productId: plan.id, name: `${plan.name} (${plan.cadence})`, unitPrice: plan.price, currency: plan.currency, quantity: 1 });
      setCart(cart);
      await api.post('/subscriptions/subscribe', { planId: plan.id, provider: 'manual' });
      setCart(getCart().filter((it) => it.productId !== plan.id)); // subscription paid directly
      toast(`${plan.name} activated! Updates every ${plan.cadence === 'weekly' ? 'week' : 'month'}.`);
      render(page);
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
    }
  }));

  page.querySelectorAll('[data-cancel]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Cancel this subscription?')) return;
    try {
      await api.post(`/subscriptions/${btn.dataset.cancel}/cancel`);
      toast('Subscription cancelled');
      render(page);
    } catch (e) { toast(e.message, 'error'); }
  }));
}