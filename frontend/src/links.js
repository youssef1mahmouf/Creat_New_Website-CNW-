/**
 * Route map — the single source of truth for navigation in the multi-page site.
 * Canonical SPA-style paths are mapped to the real HTML pages (user/ and admin/
 * are separated into their own folders, like the Tohama reference structure).
 */

const PAGES = {
  '/': '/index.html',
  '/about': '/user/about.html',
  '/contact': '/user/contact.html',
  '/login': '/user/login.html',
  '/register': '/user/register.html',
  '/forgot': '/user/forgot.html',
  '/reset': '/user/forgot.html',
  '/logout': '/user/login.html',
  '/designs': '/user/designs.html',
  '/pricing': '/user/pricing.html',
  '/cart': '/user/cart.html',
  '/payment': '/user/payment.html',
  '/dashboard': '/user/dashboard.html',
  '/architect': '/user/architect.html',
  '/store': '/user/store.html',
  '/chat': '/user/chat.html',
  '/profile': '/user/profile.html',
  '/subscriptions': '/user/subscriptions.html',
  '/ai-builder': '/admin/ai-builder.html',
  '/editor': '/admin/editor.html',
  '/admin': '/admin/index.html',
  '/admin/login': '/user/login.html',
};

const DESIGN_SLUGS = ['formal', '3d', '3d-animation', 'interactive'];

/** Canonical path → real page URL. Accepts '/designs/3d', '/dashboard/users', '/admin/users'… */
export function href(path = '/') {
  const clean = String(path || '/').split('?')[0].replace(/\/+$/, '') || '/';

  if (clean.startsWith('/designs/')) {
    const slug = clean.split('/')[2];
    if (DESIGN_SLUGS.includes(slug)) return `/user/design-detail.html?design=${encodeURIComponent(slug)}`;
    return PAGES['/designs'];
  }
  if (clean.startsWith('/dashboard/')) {
    const section = clean.split('/')[2] || 'overview';
    return `/user/dashboard.html#${encodeURIComponent(section)}`;
  }
  if (clean.startsWith('/admin/')) {
    const section = clean.split('/')[2] || 'overview';
    return `/admin/index.html#${encodeURIComponent(section)}`;
  }
  return PAGES[clean] || clean;
}

/** JS navigation to a canonical path (replaces `location.hash = '#/x'`). */
export function go(path) {
  window.location.href = href(path);
}

/**
 * Legacy compatibility: old SPA links looked like `#/designs/3d`.
 * Returns { target, query } when the hash points to another page, else null.
 */
export function resolveLegacyHash(hash) {
  if (!hash || !hash.startsWith('#/')) return null;
  const [route, query = ''] = hash.slice(1).split('?');
  const target = href(route);
  // Same-page hashes (e.g. '#/reset?token=…' opened on forgot.html) are kept.
  const targetPath = target.split('#')[0].split('?')[0].toLowerCase();
  if (location.pathname.toLowerCase().endsWith(targetPath)) return null;
  return { target, query };
}