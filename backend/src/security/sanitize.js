/** Recursively sanitize user-supplied objects to mitigate stored XSS / injection. */
function sanitizeValue(value, depth = 0) {
  if (depth > 8) return null;
  if (typeof value === 'string') {
    return value
      .replace(/<\s*script/gi, '&lt;script')
      .replace(/<\/\s*script/gi, '&lt;/script')
      .replace(/javascript\s*:/gi, '')
      .replace(/on(error|load|click|mouseover)\s*=/gi, 'data-blocked=');
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, depth + 1));
  if (value && typeof value === 'object') {
    // Prevent prototype pollution via __proto__/constructor keys
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) continue;
      out[k] = sanitizeValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

function sanitizeBody(req, _res, next) {
  if (req.body && typeof req.body === 'object') req.body = sanitizeValue(req.body);
  next();
}

module.exports = { sanitizeValue, sanitizeBody };
