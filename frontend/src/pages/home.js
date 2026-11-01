/** Home / landing page — hero (3D), about, services, design cards, pricing preview, testimonials, contact. */
import { createHeroScene } from '../three/hero-scene.js';
import { registerCleanup } from '../lifecycle.js';
import { attachTilt, attachMagnetic } from '../interactions/cards.js';
import { api } from '../api/client.js';
import { formatPrice, escapeHtml } from '../utils/toast.js';
import { href } from '../links.js';

const DESIGN_TYPES = [
  { slug: 'formal', name: 'Formal Design', icon: '🏛️', color: '#1e3a5f', desc: 'Clean corporate layouts with strong typography and structure.' },
  { slug: '3d', name: '3D Design', icon: '🧊', color: '#667eea', desc: 'Immersive Three.js scenes, interactive models and lighting.' },
  { slug: '3d-animation', name: '3D Animation', icon: '✨', color: '#f093fb', desc: 'GSAP + Three.js motion, particles, bloom and scroll storytelling.' },
  { slug: 'interactive', name: 'Interactive Design', icon: '🎛️', color: '#4facfe', desc: 'Rich micro-interactions, smooth scrolling and live effects.' },
];

// Animated counter helper
function animateCounter(el, target, suffix = '') {
  const duration = 2000;
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.floor(eased * target) + suffix;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export async function render(page) {
  let products = [];
  try {
    const res = await api.get('/products');
    products = res.docs || [];
  } catch { /* backend offline — show static content */ }

  page.innerHTML = `
    <section class="hero">
      <div id="hero-canvas"></div>
      <div class="container">
        <div class="hero-content">
          <span class="hero-badge">✦ Professional Web Studio</span>
          <h1>Create a <span class="gradient-text">New Website</span> that stands out</h1>
          <p>CNW builds formal, 3D, animated and interactive web experiences — engineered with modern technology, optimized for every device.</p>
          <div style="display:flex;gap:14px;flex-wrap:wrap">
            <a href="${href('/designs')}" class="btn btn-primary" data-magnetic>Explore Designs</a>
            <a href="${href('/pricing')}" class="btn btn-ghost" data-magnetic>See Pricing</a>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="about">
      <div class="container">
        <h2 class="section-title" data-animate>About CNW</h2>
        <p class="section-sub" data-animate>We are a full-stack web studio combining solid engineering (Node.js, Express, secure authentication, MongoDB) with cutting-edge visuals (Three.js, GSAP, postprocessing). Every project ships responsive, fast and secure by design.</p>
        <div class="grid grid-3" data-stagger>
          <div class="card" data-tilt><div class="icon-wrap">🔒</div><h3>Secure by Design</h3><p>Argon2id password hashing, AES-256-GCM encryption, rate limiting and audit logging built in.</p></div>
          <div class="card" data-tilt><div class="icon-wrap">⚡</div><h3>Performance First</h3><p>Code splitting, lazy loading, optimized 3D rendering and animation cleanup.</p></div>
          <div class="card" data-tilt><div class="icon-wrap">🧩</div><h3>Modular & Extensible</h3><p>Plugin architecture and AI agents that grow with your website.</p></div>
        </div>
      </div>
    </section>

    <section class="section" id="services" style="background:var(--bg-2)">
      <div class="container">
        <h2 class="section-title" data-animate>Our Design Types</h2>
        <p class="section-sub" data-animate>Click a design type to explore examples, capabilities and pricing in detail.</p>
        <div class="grid grid-4" id="design-cards" data-stagger>
          ${DESIGN_TYPES.map((d) => `
            <a href="${href(`/designs/${d.slug}`)}" class="card" data-tilt style="text-decoration:none;color:inherit">
              <div class="icon-wrap">${d.icon}</div>
              <h3>${d.name}</h3>
              <p>${d.desc}</p>
              <p style="margin-top:14px;color:var(--primary-2)">Explore →</p>
            </a>`).join('')}
        </div>
      </div>
    </section>

    <section class="section" id="pricing-preview">
      <div class="container">
        <h2 class="section-title" data-animate>Pricing</h2>
        <p class="section-sub" data-animate>Transparent packages for every design type.</p>
        <div class="grid grid-4" data-stagger>
          ${products.slice(0, 4).map((p) => `
            <div class="card" data-tilt>
              <h3>${escapeHtml(p.name)}</h3>
              <div class="price gradient-text">${formatPrice(p.price, p.currency)}</div>
              <ul class="features">${(p.features || []).slice(0, 3).map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
              <span class="tag ${p.availability === 'available' ? 'ok' : p.availability === 'limited' ? 'warn' : 'off'}">${escapeHtml(p.availability)}</span>
              <a href="${href('/pricing')}" class="btn btn-sm" style="margin-top:14px">Details</a>
            </div>`).join('') || '<p style="color:var(--muted)">Packages will appear here once the backend is running.</p>'}
        </div>
        <div style="margin-top:30px"><a href="${href('/pricing')}" class="btn btn-ghost" data-magnetic>Full pricing →</a></div>
      </div>
    </section>

    <section class="section" id="contact" style="background:var(--bg-2)">
      <div class="container" style="text-align:center">
        <h2 class="section-title" data-animate>Ready to create your website?</h2>
        <p class="section-sub" data-animate style="margin:0 auto 30px">Tell us about your project and we'll craft the perfect design approach.</p>
        <a href="${href('/contact')}" class="btn btn-primary" data-magnetic>Contact Us</a>
      </div>
    </section>`;

  // 3D hero
  const canvasHost = page.querySelector('#hero-canvas');
  const dispose = createHeroScene(canvasHost);
  registerCleanup(dispose);

  attachTilt(page);
  attachMagnetic(page);
}
