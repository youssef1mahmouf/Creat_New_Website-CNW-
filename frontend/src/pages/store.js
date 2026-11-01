/**
 * Code Store — like the freelance reference store: cards with price +
 * add-to-cart, but the products are CODE (CSS/HTML/JS). Clicking a card
 * opens the code viewer AND a live iframe preview of the result.
 */
import { api } from '../api/client.js';
import { getUser } from '../auth/store.js';
import { getCart, setCart } from '../utils/cart-store.js';
import { toast, formatPrice, escapeHtml } from '../utils/toast.js';
import { href, go } from '../links.js';

const LANG_ICON = { css: '🎨', html: '🧱', js: '⚡', full: '📦' };

export async function render(page) {
  let items = [];
  try {
    const res = await api.get('/code-products');
    items = res.docs || [];
  } catch { /* backend offline */ }

  const params = new URLSearchParams(location.search);
  const openId = params.get('item');

  page.innerHTML = `
    <section class="section">
      <div class="container">
        <h1 class="section-title" data-animate>Code Store</h1>
        <p class="section-sub" data-animate>Ready-to-use code components — CSS effects, HTML blocks and JS widgets.
          Open any card to see the code <b>and its live result</b>, then add it to your cart.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:26px" id="lang-filter">
          ${['all', 'css', 'html', 'js', 'full'].map((l) => `<button class="btn btn-sm ${l === 'all' ? 'btn-primary' : ''}" data-lang="${l}">${LANG_ICON[l] || ''} ${l.toUpperCase()}</button>`).join('')}
        </div>
        <div class="grid grid-3" id="store-grid" data-stagger>
          ${items.map((c) => `
            <article class="store-card" data-id="${c.id}">
              <div class="store-card-top lang-${c.language}">
                <span class="store-lang">${LANG_ICON[c.language] || '📦'} ${escapeHtml(c.language.toUpperCase())}</span>
                <span class="store-price-tag">${formatPrice(c.price, c.currency)}</span>
              </div>
              <div class="store-card-bottom">
                <h3>${escapeHtml(c.title)}</h3>
                <p class="store-desc">${escapeHtml(c.description)}</p>
                <div class="store-tags">${(c.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
                <div class="store-actions">
                  <button class="btn btn-sm btn-ghost" data-view="${c.id}">View code & result</button>
                  <button class="btn btn-sm btn-primary" data-buy="${c.id}">🛒 Add to cart</button>
                </div>
              </div>
            </article>`).join('') || '<p style="color:var(--muted)">Start the backend to load the store.</p>'}
        </div>
        <div id="store-detail" style="margin-top:40px"></div>
      </div>
    </section>`;

  // Language filter
  page.querySelectorAll('[data-lang]').forEach((btn) => btn.addEventListener('click', () => {
    page.querySelectorAll('[data-lang]').forEach((b) => b.classList.remove('btn-primary'));
    btn.classList.add('btn-primary');
    const lang = btn.dataset.lang;
    page.querySelectorAll('.store-card').forEach((card) => {
      const item = items.find((i) => i.id === card.dataset.id);
      card.style.display = (lang === 'all' || item?.language === lang) ? '' : 'none';
    });
  }));

  const wireBuy = (root) => {
    root.querySelectorAll('[data-buy]').forEach((btn) => btn.addEventListener('click', () => {
      const c = items.find((i) => i.id === btn.dataset.buy);
      if (!c) return;
      if (!getUser()) { toast('Please sign in to purchase', 'error'); go('/login'); return; }
      const cart = getCart();
      const existing = cart.find((it) => it.productId === c.id);
      if (existing) existing.quantity += 1;
      else cart.push({ productId: c.id, name: `[Code] ${c.title}`, unitPrice: c.price, currency: c.currency, quantity: 1 });
      setCart(cart);
      toast(`"${c.title}" added to cart`);
      go('/cart');
    }));
  };

  const openDetail = async (id) => {
    const detail = page.querySelector('#store-detail');
    try {
      const { doc: c, locked } = await api.get(`/code-products/${id}`);
      detail.scrollIntoView({ behavior: 'smooth' });
      detail.innerHTML = `
        <div class="card" style="padding:24px">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;align-items:center">
            <h2 style="margin:0">${LANG_ICON[c.language] || '📦'} ${escapeHtml(c.title)}</h2>
            <span class="price gradient-text" style="font-size:1.5rem">${formatPrice(c.price, c.currency)}</span>
          </div>
          <p style="color:var(--muted);margin:10px 0 18px">${escapeHtml(c.description)}</p>
          <div class="store-detail-grid">
            <div>
              <h4 style="margin-bottom:10px">📝 The code</h4>
              <pre class="store-code">${escapeHtml(c.code)}</pre>
              <button class="btn btn-sm" id="copy-code" style="margin-top:10px">📋 Copy code</button>
              <button class="btn btn-sm btn-primary" data-buy="${c.id}" style="margin-top:10px">🛒 Add to cart</button>
            </div>
            <div>
              <h4 style="margin-bottom:10px">👀 Live result</h4>
              <iframe class="store-preview" sandbox="allow-scripts" title="Live preview"
                srcdoc="${escapeHtml(c.previewHtml || `<html><body style='font-family:sans-serif;padding:16px'>${c.code}</body></html>`)}"></iframe>
            </div>
          </div>
        </div>`;
      detail.querySelector('#copy-code').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(c.code); toast('Code copied!'); }
        catch { toast('Copy failed — select the code manually', 'error'); }
      });
      if (locked) {
        const pre = detail.querySelector('.store-code');
        if (pre) pre.textContent = 'Purchase this snippet to unlock the source code.';
        const copyBtn = detail.querySelector('#copy-code');
        if (copyBtn) copyBtn.remove();
        const iframe = detail.querySelector('.store-preview');
        if (iframe) {
          const ph = document.createElement('div');
          ph.className = 'store-preview';
          ph.style.cssText = 'display:grid;place-items:center;color:var(--muted)';
          ph.textContent = 'Preview available after purchase';
          iframe.replaceWith(ph);
        }
      }
      wireBuy(detail);
    } catch (e) {
      detail.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
    }
  };

  page.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => openDetail(btn.dataset.view)));
  wireBuy(page);
  if (openId) openDetail(openId);
}