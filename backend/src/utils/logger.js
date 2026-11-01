/**
 * CNW logger — structured, readable, secret-safe.
 *
 * SECURITY RULE (unchanged): passwords, hashes, API keys, tokens, cookies and
 * connection strings are NEVER printed. Sensitive metadata is redacted before
 * it reaches stdout, and startup diagnostics only ever report `configured`.
 *
 * Two renderers:
 *  - pretty (development, default): `[HH:MM:SS] [CATEGORY] [LEVEL] Message`
 *                                   plus aligned, indented detail rows.
 *  - json  (production, opt-in):    the original one-line JSON record, so log
 *                                   collectors keep working unchanged.
 *
 * Controls (all optional):
 *  LOG_FORMAT=pretty|json|off            output renderer
 *  LOG_LEVEL=debug|info|warn|error|off   minimum level
 *  CNW_DEBUG=1 | --debug                 shorthand for LOG_LEVEL=debug
 */
const terminal = require('./terminal');

const LEVELS = { debug: 10, info: 20, ok: 25, warn: 30, error: 40, off: 99 };
const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS = [
  /password/i, /hash/i, /secret/i, /token/i, /api[_-]?key/i, /authorization/i,
  /cookie/i, /credential/i, /pepper/i, /encryption[_-]?key/i, /cvv/i, /card[_-]?number/i,
  /openai/i, /mongoose/i, /mongodb(\+srv)?:\/\//i,
];

/** True when a metadata/env key name looks like it holds a secret. */
function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(String(key)));
}

// Config-ish suffixes that are NOT secrets (a secret NAME never ends with these).
const NON_SECRET_SUFFIXES = /(_MODEL|_TTL|_DAYS|_MINUTES|_MS|_LIMIT|_ENABLED|_PROVIDER|_DIR|_URL|_FROM|_PORT|_HOST|_TYPE|_NAME|_COUNT|_LOCALE|_SECURE)$/i;

/**
 * Precise "this variable holds a credential" test, used by the startup report so
 * it lists real secrets (OPENAI_API_KEY, JWT_SECRET, ...) and not settings such
 * as OPENAI_MODEL or RESET_TOKEN_TTL_MINUTES.
 */
function isCredentialName(key) {
  const name = String(key);
  if (NON_SECRET_SUFFIXES.test(name)) return false;
  return /(PASSWORD|PASS|SECRET|TOKEN|API_?KEY|PEPPER|ENCRYPTION_KEY|CREDENTIAL|AUTH|MONGO(DB)?_(URI|URL)|DATABASE_URL)/i.test(name);
}

function redactValue(value) {
  if (typeof value === 'string') {
    // Redact connection strings / bearer tokens appearing inside strings.
    return value
      .replace(/(mongodb(\+srv)?:\/\/)[^\s]+/gi, '$1[REDACTED]')
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]');
  }
  return REDACTED;
}

/** Recursively redact sensitive keys inside a metadata object. */
function sanitize(meta) {
  if (meta === null || meta === undefined) return meta;
  if (typeof meta !== 'object') return meta;
  const out = Array.isArray(meta) ? [] : {};
  for (const [k, v] of Object.entries(meta)) {
    if (isSensitiveKey(k)) {
      out[k] = REDACTED;
    } else if (v && typeof v === 'object') {
      out[k] = sanitize(v);
    } else if (typeof v === 'string') {
      out[k] = redactValue(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** `database_connected` -> `Database connected`. */
function humanizeMessage(key) {
  const text = String(key).replace(/[_-]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `database_connected` -> `DATABASE`; an explicit meta.category wins. */
function deriveCategory(key, meta) {
  if (meta && typeof meta.category === 'string' && meta.category) return meta.category.toUpperCase();
  const first = String(key).split(/[_\s]/)[0];
  if (!first) return 'SERVER';
  return first.toUpperCase().slice(0, 14);
}

/** `nextPort` / `next_port` -> `Next port`. */
function humanizeLabel(key) {
  const spaced = String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function formatValue(value, depth = 0) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 297)}...` : value;
  if (typeof value === 'object') {
    if (depth >= 2) return Array.isArray(value) ? `[${value.length} items]` : '{...}';
    const entries = Object.entries(value).slice(0, 12);
    const inner = entries
      .map(([k, v]) => `${humanizeLabel(k)}=${formatValue(v, depth + 1)}`)
      .join(', ');
    return Array.isArray(value) ? `[${value.length}: ${inner}]` : `{${inner}}`;
  }
  return String(value);
}

const LOG_LEVEL_ENV = String(process.env.LOG_LEVEL || '').toLowerCase();
const DEBUG_REQUESTED = process.env.CNW_DEBUG === '1' || process.argv.includes('--debug');
const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

/** Renderer: pretty (dev), json (production), off (silence). */
function resolveFormat() {
  const requested = String(process.env.LOG_FORMAT || '').toLowerCase();
  if (['pretty', 'json', 'off'].includes(requested)) return requested;
  if (process.env.CNW_LOG_QUIET === '1') return 'off';
  return isProduction ? 'json' : 'pretty';
}

/** Minimum level: explicit LOG_LEVEL > debug flag > per-environment default. */
function resolveMinLevel() {
  if (LOG_LEVEL_ENV && LEVELS[LOG_LEVEL_ENV] !== undefined) return LEVELS[LOG_LEVEL_ENV];
  if (DEBUG_REQUESTED) return LEVELS.debug;
  if (isProduction) return LEVELS.info;
  if (isTest) return LEVELS.warn; // keep `npm test` output clean
  return LEVELS.info;
}

const FORMAT = resolveFormat();
const MIN_LEVEL = resolveMinLevel();
const LEVEL_NAME = Object.keys(LEVELS).find((k) => LEVELS[k] === MIN_LEVEL) || 'info';

function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** True when a level passes the current threshold and output is enabled. */
function enabled(level) {
  const value = LEVELS[level];
  if (value === undefined) return false;
  return FORMAT !== 'off' && value >= MIN_LEVEL;
}

const LEVEL_TAG = {
  debug: ['DEBUG', 'gray'],
  info: ['INFO', 'cyan'],
  ok: [' OK ', 'green'],
  warn: ['WARN', 'yellow'],
  error: ['ERROR', 'red'],
};

/** Detail rows under a pretty log line: aligned, redaction-safe. */
function renderDetails(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const entries = Object.entries(meta).filter(([k]) => k !== 'category');
  if (entries.length === 0) return '';
  const labels = entries.map(([k]) => humanizeLabel(k));
  const labelPad = Math.max(...labels.map((l) => l.length));
  return entries
    .map(([, v], i) => `           ${labels[i].padEnd(labelPad, ' ')} : ${formatValue(v)}`)
    .join('\n');
}

function renderPretty(level, msg, meta) {
  const [tag, color] = LEVEL_TAG[level] || LEVEL_TAG.info;
  const category = deriveCategory(msg, meta);
  const head = `${terminal.paint(`[${timestamp()}]`, 'gray')} `
    + `${terminal.paint(`[${category}]`, 'magenta')} `
    + `${terminal.paint(`[${tag}]`, color)} ${humanizeMessage(msg)}`;
  const details = renderDetails(meta);
  return details ? `${head}\n${details}` : head;
}

function renderJson(level, msg, meta) {
  const line = {
    time: new Date().toISOString(),
    level: level === 'ok' ? 'info' : level,
    msg: typeof msg === 'string' ? redactValue(msg) : String(msg),
  };
  if (meta !== undefined) {
    const clean = { ...meta };
    delete clean.category;
    line.meta = sanitize(clean);
  }
  return JSON.stringify(line);
}

function write(level, msg, meta) {
  if (!enabled(level)) return;
  const text = FORMAT === 'json' ? renderJson(level, msg, meta) : renderPretty(level, msg, meta);
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : 'log'](text);
}

module.exports = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  ok: (msg, meta) => write('ok', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  sanitize,
  isSensitiveKey,
  isCredentialName,
  redactValue,
  humanizeLabel,
  enabled,
  clock: timestamp,
  format: FORMAT,
  minLevel: MIN_LEVEL,
  levelName: LEVEL_NAME,
};
