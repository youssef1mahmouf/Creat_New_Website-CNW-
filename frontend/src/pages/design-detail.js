/** Design detail view — larger, selected card with examples, capabilities, pricing, add-to-cart. */
import { api } from '../api/client.js';
import { getUser } from '../auth/store.js';
import { getCart, setCart } from '../utils/cart-store.js';
import { toast, formatPrice, escapeHtml } from '../utils/toast.js';
import { attachTilt } from '../interactions/cards.js';
import { createHeroScene } from '../three/hero-scene.js';
import { registerCleanup } from '../lifecycle.js';
import { href, go } from '../links.js';

const META = {
  formal: { icon: '🏛️', examples: ['Corporate sites', 'Portfolios', 'Landing pages'], capabilities: ['Responsive grid systems', 'Typography-driven layout', 'Accessibility first', 'SEO-friendly markup'] },
  '3d': { icon: '🧊', examples: ['Product showcases', 'Interactive logos', '3D heroes'], capabilities: ['Three.js scenes', 'Interactive 3D models', 'Lighting & camera movement', 'Mouse-driven interaction'] },
  '3d-animation': { icon: '✨', examples: ['Scroll stories', 'Animated explainers', 'Cinematic intros'], capabilities: ['GSAP scroll animations', 'Particles & bloom', 'Camera fly-throughs', 'Micro-interactions'] },
  interactive: { icon: '🎛️', examples: ['Dashboards', 'Configurators', 'Interactive infographics'], capabilities: ['Live UI feedback', 'Smooth scrolling (Lenis)', 'Postprocessing effects', 'Draggable components'] },
};

export async function render(page) {
  // In the multi-page site the design slug arrives as ?design=slug.
  const slug = new URLSearchParams(location.search).get('design') || 'formal';
  const meta = META[slug] || META.formal;

  let pkg = null;
  try {
    const res = await api.get('/products');
    pkg = (res.docs || []).find((p) => p.designType === slug) || null;
  } catch { /* offline */ }

  page.innerHTML = `
    <section class="section">
      <div class="container">
        <a href="${href('/designs')}" style="color:var(--muted)">← All designs</a>
        <div class="card selected" style="margin-top:18px" data-tilt>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:30px" class="detail-grid">
            <div>
              <div class="icon-wrap" style="font-size:2.4rem;width:80px;height:80px">${meta.icon}</div>
              <h1 class="section-title">${slug === '3d' ? '3D Design' : slug === '3d-animation' ? '3D Animation' : slug === 'interactive' ? 'Interactive Design' : 'Formal Design'}</h1>
              <p style="color:var(--muted)">${pkg ? escapeHtml(pkg.description) : 'Premium design experience.'}</p>
              <h3 style="margin:22px 0 10px">Capabilities</h3>
              <ul class="features">${meta.capabilities.map((c) => `<li>${c}</li>`).join('')}</ul>
              <h3 style="margin:22px 0 10px">Examples</h3>
              <div style="display:flex;gap:8px;flex-wrap:wrap">${meta.examples.map((e) => `<span class="tag">${e}</span>`).join('')}</div>
            </div>
            <div>
              <div id="detail-canvas" style="height:280px;border-radius:14px;overflow:hidden;border:1px solid var(--border)"></div>
              ${pkg ? `
                <div class="price gradient-text" style="font-size:2.2rem">${formatPrice(pkg.price, pkg.currency)}</div>
                <p><span class="tag ${pkg.availability === 'available' ? 'ok' : pkg.availability === 'limited' ? 'warn' : 'off'}">${escapeHtml(pkg.availability)}</span>
                   <span class="tag">access: ${escapeHtml(pkg.access || 'public')}</span></p>
                <ul class="features">${(pkg.features || []).map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
                <button class="btn btn-primary" id="use-design" data-magnetic style="width:100%">Select / Use this design</button>
              ` : `<p style="color:var(--muted);margin-top:20px">Pricing will be available when the backend is running.</p>`}
            </div>
          </div>
        </div>
      </div>
    </section>
    <style>@media(max-width:820px){.detail-grid{grid-template-columns:1fr !important}}</style>`;

  const dispose = createHeroScene(page.querySelector('#detail-canvas'));
  registerCleanup(dispose);
  attachTilt(page);

  page.querySelector('#use-design')?.addEventListener('click', () => {
    if (!pkg) return;
    if (!getUser()) {
      toast('Please sign in to use this design', 'error');
      go('/login');
      return;
    }
    if (pkg.access === 'admin' && !['admin', 'super_admin'].includes(getUser().role)) {
      toast('This design requires admin access', 'error');
      return;
    }
    // Add to local cart; server cart syncs on checkout page.
    const cart = getCart();
    const existing = cart.find((it) => it.productId === pkg.id);
    if (existing) existing.quantity += 1;
    else cart.push({ productId: pkg.id, name: pkg.name, unitPrice: pkg.price, currency: pkg.currency, quantity: 1 });
    setCart(cart);
    toast(`"${pkg.name}" added to your cart`);
    go('/cart');
  });
}
