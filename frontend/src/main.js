/**
 * CNW frontend — shared bootstrap for every page of the multi-page site.
 * Each HTML page (root, /user/*, /admin/*) calls startApp(pageRender) with its
 * own page module; everything shared (styles, session, i18n, header/footer,
 * smooth scroll, error reporting, cleanup) is handled here.
 */
import './styles/main.css';
import { initSmoothScroll, destroySmoothScroll } from './animations/scroll.js';
import { fetchMe } from './auth/store.js';
import { renderHeader } from './layouts/header.js';
import { renderFooter } from './layouts/footer.js';
import { api } from './api/client.js';
import { initI18n, onLocaleChange } from './utils/i18n.js';
import { runCleanups } from './lifecycle.js';
import { resolveLegacyHash } from './links.js';

export { registerCleanup } from './lifecycle.js';
export { href, go } from './links.js';

/**
 * Boot the shared shell, then render the page module passed by the HTML entry.
 * Legacy `#/route` hash links from the old SPA are redirected to the real page.
 */
export async function startApp(renderPage) {
  const legacy = resolveLegacyHash(location.hash);
  if (legacy) {
    location.replace(legacy.target + (legacy.query ? `?${legacy.query}` : ''));
    return;
  }

  initSmoothScroll();
  window.addEventListener('pagehide', () => {
    runCleanups();
    destroySmoothScroll();
  });

  // ---- Client error reporting → backend error log (best-effort, throttled) ----
  let lastReport = 0;
  const reportClientError = (message, extra = {}) => {
    const now = Date.now();
    if (now - lastReport < 5000) return; // throttle to 1 report / 5s
    lastReport = now;
    api.post('/errors/client', {
      message: String(message).slice(0, 2000),
      stack: String(extra.stack || '').slice(0, 8000),
      path: location.pathname + (location.hash || ''),
      metadata: { kind: extra.kind || 'js', page: location.pathname },
    }).catch(() => { /* never loop error reporting */ });
  };
  window.addEventListener('error', (e) => reportClientError(e.message, { stack: e.error?.stack }));
  window.addEventListener('unhandledrejection', (e) => reportClientError(`Unhandled rejection: ${e.reason}`, { kind: 'promise' }));

  // Restore session if a valid token exists, then render the page.
  await fetchMe().catch(() => { /* offline or invalid token — continue as guest */ });
  await initI18n();
  renderHeader();
  renderFooter();
  await renderPage(document.getElementById('page'));

  // Re-render chrome + page when the language changes.
  onLocaleChange(() => {
    renderHeader();
    renderFooter();
    renderPage(document.getElementById('page'));
  });

  // Keep the header in sync when auth state changes in another tab/window
  // (e.g. user signs in on the home page → every open page flips to My Profile).
  window.addEventListener('storage', (e) => {
    if (e.key === 'cnw_user') renderHeader();
  });
  // Same-tab auth events (login/logout without a full page reload).
  window.addEventListener('cnw:auth', () => renderHeader());
}
