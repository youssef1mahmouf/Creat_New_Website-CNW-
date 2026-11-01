/**
 * Frontend i18n — EN/AR catalogs with an embedded offline fallback.
 * The authoritative catalogs come from GET /api/i18n; the embedded copy
 * below keeps the header/footer/nav working even when the backend is down.
 */
import { api } from '../api/client.js';

const FALLBACK = {
  en: {
    'nav.home': 'Home',
    'nav.designs': 'Designs',
    'nav.pricing': 'Pricing',
    'nav.about': 'About',
    'nav.contact': 'Contact',
    'nav.dashboard': 'My Account',
    'nav.admin': 'Admin Panel',
    'nav.signin': 'Sign In',
    'nav.signup': 'Register',
    'nav.profile': 'My Profile',
    'nav.signout': 'Sign Out',
    'nav.cart': 'Cart',
    'lang.switch': 'العربية',
    'lang.label': 'Language',
    'common.send': 'Send',
    'common.loading': 'Loading…',
    'footer.tagline': 'Create New Website — professional formal, 3D, animated and interactive web experiences.',
    'footer.company': 'Company',
    'footer.services': 'Services',
    'footer.contact': 'Contact',
    'footer.rights': 'All rights reserved.',
    'contact.success': 'Thank you! Your message has been received.',
    'contact.error': 'Could not send the message. Please try again.',
  },
  ar: {
    'nav.home': 'الرئيسية',
    'nav.designs': 'التصاميم',
    'nav.pricing': 'الأسعار',
    'nav.about': 'من نحن',
    'nav.contact': 'اتصل بنا',
    'nav.dashboard': 'حسابي',
    'nav.admin': 'لوحة التحكم',
    'nav.signin': 'تسجيل الدخول',
    'nav.signup': 'Register',
    'nav.profile': 'My Profile',
    'nav.signout': 'تسجيل الخروج',
    'nav.cart': 'السلة',
    'lang.switch': 'English',
    'lang.label': 'اللغة',
    'common.send': 'إرسال',
    'common.loading': 'جارٍ التحميل…',
    'footer.tagline': 'صمم موقعك الجديد — مواقع احترافية كلاسيكية وثلاثية الأبعاد وتفاعلية.',
    'footer.company': 'الشركة',
    'footer.services': 'الخدمات',
    'footer.contact': 'اتصل بنا',
    'footer.rights': 'جميع الحقوق محفوظة.',
    'contact.success': 'شكراً لك! تم استلام رسالتك.',
    'contact.error': 'تعذّر إرسال الرسالة. حاول مرة أخرى.',
  },
};

const RTL_LOCALES = ['ar', 'he', 'fa', 'ur'];

const storedLocale = localStorage.getItem('cnw_locale');
let currentLocale = ['en', 'ar'].includes(storedLocale) ? storedLocale : null;
let catalog = null; // authoritative catalog fetched from the backend
const listeners = new Set();

function catalogFor(locale) {
  return (catalog && catalog[locale]) || FALLBACK[locale] || FALLBACK.en;
}

/** Translate a key in the active locale; falls back to EN then the key itself. */
export function t(key) {
  const dict = catalogFor(currentLocale || 'en');
  return dict[key] ?? FALLBACK.en[key] ?? key;
}

export function getLocale() {
  return currentLocale || 'en';
}

export function isRTL(locale = getLocale()) {
  return RTL_LOCALES.includes(locale);
}

function applyDocumentDir() {
  document.documentElement.dir = isRTL() ? 'rtl' : 'ltr';
  document.documentElement.lang = getLocale();
}

/** Load the authoritative catalog from the backend (best-effort, offline-safe). */
export async function initI18n() {
  const wanted = currentLocale || (navigator.language || 'en').slice(0, 2);
  try {
    const res = await api.get(`/i18n?lang=${encodeURIComponent(wanted)}`);
    catalog = { [res.locale]: res.messages, ...(catalog || {}) };
    currentLocale = res.locale;
    localStorage.setItem('cnw_locale', res.locale);
  } catch {
    if (!FALLBACK[wanted]) currentLocale = 'en';
    else currentLocale = wanted;
  }
  applyDocumentDir();
  listeners.forEach((fn) => { try { fn(currentLocale); } catch { /* ignore */ } });
  return currentLocale;
}

/** Switch locale: refetch the catalog (if backend reachable) and notify UI. */
export async function setLocale(locale) {
  if (!FALLBACK[locale]) return;
  currentLocale = locale;
  localStorage.setItem('cnw_locale', locale);
  try {
    const res = await api.get(`/i18n?lang=${encodeURIComponent(locale)}`);
    catalog = { [res.locale]: res.messages, ...(catalog || {}) };
  } catch { /* offline — embedded fallback covers the UI */ }
  applyDocumentDir();
  listeners.forEach((fn) => { try { fn(currentLocale); } catch { /* ignore */ } });
}

/** Subscribe to locale changes (used by header/footer/pages to re-render). */
export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}