/** Pricing page — editable by admin from the dashboard. */
import { api } from '../api/client.js';
import { getUser } from '../auth/store.js';
import { getCart, setCart } from '../utils/cart-store.js';
import { toast, formatPrice, escapeHtml } from '../utils/toast.js';
import { attachTilt, attachMagnetic } from '../interactions/cards.js';
import { go } from '../links.js';

export async function render(page) {
  let products = [];
  try { products = (await api.get('/products')).docs || []; } catch { /* offline */ }

  page.innerHTML = `
    <section class="section">
      <div class="container">
        <h1 class="section-title" data-animate>Transparent Pricing</h1>
        <p class="section-sub" data-animate>Choose the perfect package for your project. All plans include responsive design, security features and professional support.</p>
        
        <div class="pricing-toggle" style="display:flex;align-items:center;justify-content:center;gap:12px;margin:30px 0">
          <span style="font-weight:500">One-time payment</span>
          <div class="toggle-switch" data-mode="one-time" style="position:relative;width:60px;height:30px;background:var(--muted);border-radius:20px;cursor:pointer">
            <div style="position:absolute;top:3px;left:3px;width:24px;height:24px;background:white;border-radius:50%;transition:transform 0.3s"></div>
          </div>
          <span style="font-weight:500">Subscription</span>
        </div>

        <div class="grid grid-4" data-stagger id="pricing-grid">
          ${products.map((p) => `
            <div class="card pricing-card-feature" data-tilt>
              <div class="pricing-header">
                <h3>${escapeHtml(p.name)}</h3>
                <div class="pricing-meta">
                  <span class="tag ${p.availability === 'available' ? 'ok' : p.availability === 'limited' ? 'warn' : 'off'}">${escapeHtml(p.availability)}</span>
                  <span class="tag">${escapeHtml(p.designType)}</span>
                </div>
              </div>
              <p class="pricing-desc">${escapeHtml(p.description || '')}</p>
              <div class="price gradient-text" style="font-size:2rem;margin:16px 0">${formatPrice(p.price, p.currency)}</div>
              <ul class="features-list">
                ${(p.features || []).map((f) => `<li class="feature-item">✓ ${escapeHtml(f)}</li>`).join('')}
                <li class="feature-item">✓ Responsive Design</li>
                <li class="feature-item">✓ Security Setup</li>
                <li class="feature-item">✓ Performance Optimization</li>
              </ul>
              <button class="btn btn-primary" data-use="${p.id}" data-magnetic style="width:100%;margin-top:14px"
                ${p.availability === 'unavailable' ? 'disabled' : ''}>Select Plan</button>
            </div>`).join('') || '<p style="color:var(--muted)">Start the backend to load pricing data.</p>'}
        </div>

        <div class="section" style="margin-top:50px">
          <h2 class="section-title" data-animate>Frequently Asked Questions</h2>
          <div class="grid grid-2" data-stagger>
            <div class="card faq-card">
              <details class="faq-item" open>
                <summary>What's included in each package?</summary>
                <p style="color:var(--muted);margin-top:10px">Every package includes a complete website with responsive design, security features, performance optimization, and professional styling.</p>
              </details>
              <details class="faq-item">
                <summary>How long does delivery take?</summary>
                <p style="color:var(--muted);margin-top:10px">Formal designs typically ship in 1-2 weeks. 3D and interactive builds take 2-4 weeks depending on scope.</p>
              </details>
              <details class="faq-item">
                <summary>Can I customize after purchase?</summary>
                <p style="color:var(--muted);margin-top:10px">Yes! All packages include a support window for adjustments and ongoing maintenance.</p>
              </details>
            </div>
            <div class="card faq-card">
              <details class="faq-item">
                <summary>Do you provide hosting?</summary>
                <p style="color:var(--muted);margin-top:10px">We deliver complete website code optimized for deployment. We can recommend hosting providers and help with setup.</p>
              </details>
              <details class="faq-item">
                <summary>Is there a refund policy?</summary>
                <p style="color:var(--muted);margin-top:10px">We stand behind our work. If you're not satisfied within the first week, we'll address concerns or provide a full refund.</p>
              </details>
              <details class="faq-item">
                <summary>Can I upgrade later?</summary>
                <p style="color:var(--muted);margin-top:10px">Absolutely! You can start with a basic package and upgrade anytime. We'll prorate the difference.</p>
              </details>
            </div>
          </div>
        </div>
      </div>
    </section>`;

  attachTilt(page);
  attachMagnetic(page);

  // Pricing toggle interaction
  const toggle = document.querySelector('.toggle-switch');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const isSub = toggle.dataset.mode === 'subscription';
      toggle.dataset.mode = isSub ? 'one-time' : 'subscription';
      toggle.style.background = isSub ? 'var(--muted)' : 'var(--primary)';
      toggle.querySelector('div').style.transform = isSub ? 'translateX(0)' : 'translateX(30px)';
    });
  }

  page.querySelectorAll('[data-use]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pkg = products.find((p) => p.id === btn.dataset.use);
      if (!pkg) return;
      if (!getUser()) {
        toast('Please sign in to purchase', 'error');
        go('/login');
        return;
      }
      if (pkg.access === 'admin' && !['admin', 'super_admin'].includes(getUser().role)) {
        toast('This package requires admin access', 'error');
        return;
      }
      const cart = getCart();
      const existing = cart.find((it) => it.productId === pkg.id);
      if (existing) existing.quantity += 1;
      else cart.push({ productId: pkg.id, name: pkg.name, unitPrice: pkg.price, currency: pkg.currency, quantity: 1 });
      setCart(cart);
      toast(`"${pkg.name}" added to cart`);
      go('/cart');
    });
  });
}
