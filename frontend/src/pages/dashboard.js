/**
 * Dashboard shell — sidebar navigation + section rendering.
 * Shared by the user dashboard (user/dashboard.html) and the admin dashboard
 * (admin/index.html); sections switch via in-page hash navigation (#section).
 */
import { getUser, isAdmin } from '../auth/store.js';
import { renderHeader } from '../layouts/header.js';
import { renderSection } from './dashboard-sections.js';
import { toast, escapeHtml } from '../utils/toast.js';
import { go } from '../links.js';

const SECTIONS = [
  ['overview', '📊 Overview'], ['users', '👥 Users'], ['products', '📦 Products'],
  ['orders', '🧾 Orders'], ['payments', '💳 Payments'], ['pages', '📄 Pages'],
  ['designs', '🎨 Designs'], ['projects', '🗂️ Projects'], ['plugins', '🧩 Plugins'],
  ['ai', '🤖 AI'], ['security', '🛡️ Security'], ['store', '🛒 Code Store'],
  ['messages', '✉️ Messages'], ['coupons', '🎟️ Coupons'], ['reports', '📑 Reports'],
  ['settings', '⚙️ Settings'],
];

const ADMIN_ONLY = ['users', 'payments', 'security', 'plugins', 'store', 'messages', 'coupons', 'reports'];

/** Current section: accepts '#users', '#/dashboard/users' and '#/admin/users'. */
function currentSection() {
  return decodeURIComponent(
    location.hash.replace(/^#\/?(?:dashboard|admin)?\/?/, ''),
  ) || 'overview';
}

export async function render(page, { isAdminArea = false } = {}) {
  const user = getUser();
  if (!user) {
    toast('Please sign in first', 'error');
    go('/login');
    return;
  }
  if (isAdminArea && !isAdmin()) {
    toast('This area requires an admin role', 'error');
    go('/dashboard');
    return;
  }

  const section = currentSection();
  const adminOnly = ADMIN_ONLY.includes(section);

  page.innerHTML = `
    <div class="container dash">
      <nav class="dash-nav">
        ${SECTIONS
          .filter(([key]) => (user.role === 'user' ? !adminOnly || key === 'overview' : true))
          .map(([key, label]) => `<a href="#${key}" class="${key === section ? 'active' : ''}">${label}</a>`)
          .join('')}
      </nav>
      <div id="dash-content"><p style="color:var(--muted)">Loading…</p></div>
    </div>`;

  const content = page.querySelector('#dash-content');

  if (adminOnly && !isAdmin()) {
    content.innerHTML = `<div class="card"><h3>Access denied</h3><p style="color:var(--muted)">This section requires an admin role.</p></div>`;
    return;
  }

  try {
    await renderSection(content, section, user);
  } catch (e) {
    content.innerHTML = `<div class="card"><h3>Something went wrong</h3><p style="color:var(--muted)">${escapeHtml(e.message)}</p></div>`;
  }

  // In-page section switching: re-render on hash change (single shared listener).
  if (!render._sectionNavBound) {
    render._sectionNavBound = true;
    window.addEventListener('hashchange', () => {
      if (document.body.contains(page)) render(page, { isAdminArea });
    });
  }

  const { renderIcons } = await import('../components/icons.js');
  renderIcons(content);
  renderHeader();
}
