/** i18n controller — serves the message catalogs + locale negotiation. */
const config = require('../config/env');
const { messages } = require('../config/i18n-strings');

/** Resolve best locale from query ?lang=, header, or stored preference. */
function resolveLocale(req, fallback) {
  const requested = String(req.query.lang || '').split(',')[0].trim().toLowerCase();
  const header = String(req.headers['accept-language'] || '').split(',')[0].trim().toLowerCase().slice(0, 2);
  const supported = config.i18n.supported;
  for (const cand of [requested, header, fallback, config.i18n.defaultLocale]) {
    if (cand && supported.includes(cand)) return cand;
  }
  return config.i18n.defaultLocale;
}

exports.resolveLocale = resolveLocale;

exports.index = (req, res) => {
  const locale = resolveLocale(req, req.user?.locale || null);
  res.set('Vary', 'Accept-Language');
  res.json({
    success: true,
    locale,
    supported: config.i18n.supported,
    defaultLocale: config.i18n.defaultLocale,
    messages: messages[locale] || messages[config.i18n.defaultLocale],
  });
};