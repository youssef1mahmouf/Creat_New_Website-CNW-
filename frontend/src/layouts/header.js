/** Global site header — Tohama-style professional header: gradient brand mark,
 * glass sticky bar, role-aware nav, profile dropdown with counters (cart,
 * orders, unread chat), theme + language controls, mobile drawer. */
import { getUser, isAdmin, logout } from '../auth/store.js';
import { getCartCount } from '../utils/cart-store.js';
import { renderIcons } from '../components/icons.js';
import { t, setLocale } from '../utils/i18n.js';
import { href } from '../links.js';
import { api } from '../api/client.js';

export function renderHeader() {
  const header = document.getElementById('site-header');
  const user = getUser();
  const cartCount = getCartCount();
  header.innerHTML = `
    <div class="pro-topbar">
      <div class="container pro-topbar-inner">
        <span class="pro-topbar-item">🔒 Secure checkout</span>
        <span class="pro-topbar-item">💬 <a href="${href('/chat')}">Live chat support</a></span>
        <span class="pro-topbar-item pro-topbar-right">🌍 <button class="linklike" id="lang-btn" title="${t('lang.label')}">${t('lang.switch')}</button></span>
      </div>
    </div>
    <div class="container nav pro-nav">
      <a href="${href('/')}" class="logo pro-logo"><span class="logo-mark">C</span>
        <span class="pro-logo-text">CNW <small>Create New Website</small></span></a>
      <button class="nav-toggle" aria-label="Menu"><i data-lucide="menu"></i></button>
      <ul class="nav-links" id="nav-links">
        <li><a href="${href('/')}" data-nav><i data-lucide="home"></i> ${t('nav.home')}</a></li>
        <li><a href="${href('/designs')}" data-nav>${t('nav.designs')}</a></li>
        <li><a href="${href('/store')}" data-nav>Code Store</a></li>
        <li><a href="${href('/pricing')}" data-nav>${t('nav.pricing')}</a></li>
        <li><a href="${href('/about')}" data-nav>${t('nav.about')}</a></li>
        <li><a href="${href('/contact')}" data-nav>${t('nav.contact')}</a></li>
        ${user ? `<li class="pro-chat-link"><a href="${href('/chat')}" data-nav>💬 Chat <span class="pro-badge" id="chat-unread-badge" hidden></span></a></li>` : ''}
        ${isAdmin() ? `<li><a href="${href('/admin')}" data-nav class="pro-admin-link">🛡️ ${t('nav.admin')}</a></li>` : ''}
        ${user ? `<li><a href="${href('/dashboard')}" data-nav>${t('nav.dashboard')}</a></li>` : ''}
      </ul>
      <div class="nav-actions">
        <a href="${href('/cart')}" class="btn btn-sm btn-ghost pro-cart" aria-label="${t('nav.cart')}">
          <i data-lucide="shopping-cart"></i>${cartCount ? ` <b class="pro-count">${cartCount}</b>` : ''}</a>
        ${user
          ? `<div class="pro-profile" id="profile-wrap">
               <a class="pro-profile-btn" href="${href('/profile')}"><span class="pro-avatar"><i data-lucide="user"></i></span><span class="pro-profile-name">${t('nav.profile')}</span></a>
               <button class="btn btn-sm btn-ghost" id="logout-btn" type="button"><i data-lucide="log-out"></i> ${t('nav.signout')}</button>
             </div>`
          : `<a href="${href('/login')}" class="btn btn-sm btn-ghost"><i data-lucide="log-in"></i> ${t('nav.signin')}</a>
             <a href="${href('/register')}" class="btn btn-sm btn-primary">${t('nav.signup')}</a>`}
      </div>
    </div>`;

  renderIcons(header);

  header.querySelector('.nav-toggle')?.addEventListener('click', () => {
    header.querySelector('#nav-links').classList.toggle('open');
  });

  // (Profile dropdown card deleted — header uses direct Profile link + Sign out.)

  // Live counters: unread chat badge in the nav.
  if (user) {
    api.get('/chat/unread').then(({ total }) => {
      const badge = header.querySelector('#chat-unread-badge');
      if (total > 0) {
        if (badge) { badge.hidden = false; badge.textContent = total > 99 ? '99+' : String(total); }
      }
    }).catch(() => {});
  }

  // Highlight the nav link matching the current real page (MPA-aware).
  const norm = (p) => (p.replace(/index\.html$/, '').replace(/\/+$/, '') || '/');
  const current = norm(location.pathname);
  header.querySelectorAll('[data-nav]').forEach((a) => {
    const target = norm(new URL(a.getAttribute('href'), location.origin).pathname);
    if (target === current) a.classList.add('active');
  });

  header.querySelector('#logout-btn')?.addEventListener('click', async () => {
    await logout();
    location.href = href('/');
    renderHeader();
  });

  header.querySelector('#lang-btn')?.addEventListener('click', async () => {
    await setLocale(t('lang.switch') === 'English' ? 'en' : 'ar');
  });
}
