/** Designs overview — the four interactive design-type cards. */
import { attachTilt } from '../interactions/cards.js';
import { api } from '../api/client.js';
import { formatPrice, escapeHtml } from '../utils/toast.js';
import { href } from '../links.js';

const TYPES = [
  { slug: 'formal', name: 'Formal Design', icon: '🏛️', gradient: 'linear-gradient(135deg, #1e3a5f, #2d5a87)' },
  { slug: '3d', name: '3D Design', icon: '🧊', gradient: 'linear-gradient(135deg, #667eea, #764ba2)' },
  { slug: '3d-animation', name: '3D Animation', icon: '✨', gradient: 'linear-gradient(135deg, #f093fb, #f5576c)' },
  { slug: 'interactive', name: 'Interactive Design', icon: '🎛️', gradient: 'linear-gradient(135deg, #4facfe, #00f2fe)' },
];

export async function render(page) {
  let products = [];
  try { products = (await api.get('/products')).docs || []; } catch { /* offline */ }

  page.innerHTML = `
    <section class="section">
      <div class="container">
        <h1 class="section-title" data-animate>Our Design Types</h1>
        <p class="section-sub" data-animate>Four signature design approaches. Each tailored for different business needs and visual preferences.</p>
        <div class="grid grid-2" data-stagger id="design-grid">
          ${TYPES.map((t) => {
            const pkg = products.find((p) => p.designType === t.slug);
            return `
            <a href="${href(`/designs/${t.slug}`)}" class="card design-type-card" data-tilt style="text-decoration:none;color:inherit">
              <div class="design-preview" style="height:100px;background:${t.gradient};border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:2.5rem;color:white">${t.icon}</div>
              <h3>${t.name}</h3>
              <p>${pkg ? escapeHtml(pkg.description || `Professional ${t.name.toLowerCase()} design solutions.`) : `Explore our ${t.name.toLowerCase()} capabilities.`}</p>
              ${pkg ? `
                <div class="price gradient-text" style="font-size:1.4rem">${formatPrice(pkg.price, pkg.currency)}</div>
                <div style="margin-top:10px">
                  <span class="tag ${pkg.availability === 'available' ? 'ok' : pkg.availability === 'limited' ? 'warn' : 'off'}">${escapeHtml(pkg.availability)}</span>
                  <span class="tag">${escapeHtml(pkg.access || 'public')} access</span>
                </div>` : ''}
              <div style="margin-top:16px;display:flex;gap:8px;align-items:center">
                <span style="color:var(--primary-2)">View details</span>
                <span style="color:var(--primary)">→</span>
              </div>
            </a>`;
          }).join('')}
        </div>
      </div>
    </section>`;

  attachTilt(page);
}
