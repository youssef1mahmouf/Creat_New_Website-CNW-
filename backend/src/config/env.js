/**
 * CNW — Centralized, validated environment configuration.
 * Secrets are NEVER logged or exposed to the frontend.
 */
const path = require('path');
const dotenv = require('dotenv');

// quiet: true — dotenv's own banner/tips are replaced by the CNW startup report.
const dotenvResult = dotenv.config({ quiet: true });
const DOTENV_PATH = path.resolve(__dirname, '..', '..', '.env');

const crypto = require('crypto');

function env(key, fallback = '') {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function requiredInProduction(key) {
  if (env(key) === '' && process.env.NODE_ENV === 'production') {
    // Printed via the dependency-free terminal layer (this runs before anything
    // else is loaded): reason -> location -> action, with no secret exposure.
    // eslint-disable-next-line global-require
    const terminal = require('../utils/terminal');
    terminal.print(terminal.banner('STARTUP FAILED'));
    terminal.print(terminal.line('err', `Missing required environment variable: ${key}`));
    terminal.print('');
    terminal.print('Reason:');
    terminal.print('  Production mode requires this value; no safe fallback may be generated.');
    terminal.print('Location:');
    terminal.print('  backend/.env  (validated by backend/src/config/env.js)');
    terminal.print('Suggested action:');
    terminal.print(`  Add ${key}=<value> to backend/.env, then start the server again.`);
    terminal.print('  Generate a strong value with:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    terminal.print('');
    terminal.print(terminal.paint('Server was NOT started.', 'red', 'bold'));
    terminal.print(terminal.rule());
    process.exit(1);
  }
  return env(key);
}

const config = {
  port: parseInt(env('PORT', '5000'), 10),
  nodeEnv: env('NODE_ENV', 'development'),
  isProduction: env('NODE_ENV') === 'production',
  isTest: env('NODE_ENV') === 'test',

  db: {
    // "json" (dev/fallback) or "mongodb" (production)
    type: env('DB_TYPE', 'json').toLowerCase() === 'mongodb' ? 'mongodb' : 'json',
    mongoUri: requiredInProduction('MONGODB_URI'),
    mongoDbName: env('MONGODB_DB_NAME', 'cnw'),
    jsonDir: env('JSON_DB_DIR', ''),
  },

  secrets: {
    jwt: requiredInProduction('JWT_SECRET'),
    session: requiredInProduction('SESSION_SECRET'),
    pepper: env('PASSWORD_PEPPER'),
    encryptionKeys: {
      // key version -> base64 or hex key. Only current + previous kept for rotation.
      1: env('ENCRYPTION_KEY_CURRENT'),
      0: env('ENCRYPTION_KEY_PREVIOUS'),
    },
    backup: env('BACKUP_ENCRYPTION_KEY'),
  },

  openai: {
    apiKey: env('OPENAI_API_KEY'),
    model: env('OPENAI_MODEL', 'gpt-4o-mini'),
  },

  // Google AI (Gemini) fallback provider — used when no OpenAI key is set.
  // The canonical env name is GOOGLE_API_KEY / GOOGLE_MODEL. The legacy
  // lowercase `google_API_KEY` name is accepted as an alias so existing
  // installations keep working on case-sensitive (Linux) systems too.
  // Only `configured: true|false` is ever reported — never the value.
  google: {
    apiKey: env('GOOGLE_API_KEY') || env('google_API_KEY'),
    model: env('GOOGLE_MODEL') || env('google_Model') || 'gemini-1.5-flash',
  },

  cors: {
    origins: env('CORS_ORIGINS', 'http://localhost:5173,http://localhost:4173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },

  clientUrl: env('CLIENT_URL', 'http://localhost:5173'),

  jwt: {
    accessTtl: env('JWT_ACCESS_TTL', '30m'),
    refreshTtlDays: parseInt(env('JWT_REFRESH_TTL_DAYS', '7'), 10),
  },

  passwordReset: {
    ttlMinutes: parseInt(env('RESET_TOKEN_TTL_MINUTES', '30'), 10),
  },

  // ---- Email delivery (SMTP) ----
  mail: {
    from: env('MAIL_FROM', 'CNW <no-reply@cnw.local>'),
    host: env('MAIL_HOST', ''),
    port: parseInt(env('MAIL_PORT', '587'), 10),
    user: env('MAIL_USER', ''),
    pass: env('MAIL_PASS', ''),
    secure: env('MAIL_SECURE', 'false') === 'true',
    enabled: env('MAIL_ENABLED', 'false') === 'true',
    // Dev-only token exposure: NEVER enable in production. When true (and not
    // production), password/verify flows may return a devToken for tests.
    devTokens: (env('MAIL_DEV_TOKENS', process.env.NODE_ENV === 'test' ? 'true' : 'false') === 'true'),
    retryMax: parseInt(env('MAIL_RETRY_MAX', '3'), 10),
  },

  // ---- SMS delivery (provider-agnostic) ----
  sms: {
    provider: env('SMS_PROVIDER', 'log'), // log | twilio | custom
    twilioSid: env('TWILIO_ACCOUNT_SID', ''),
    twilioToken: env('TWILIO_AUTH_TOKEN', ''),
    twilioFrom: env('TWILIO_FROM', ''),
    customUrl: env('SMS_CUSTOM_URL', ''),
    customApiKey: env('SMS_CUSTOM_API_KEY', ''),
  },

  // ---- Notifications ----
  notify: {
    adminEmail: env('ADMIN_EMAIL', env('SEED_ADMIN_EMAIL', 'admin@cnw.local')),
    adminPhone: env('ADMIN_PHONE', ''),
  },

  // ---- Languages / i18n ----
  i18n: {
    defaultLocale: env('I18N_DEFAULT_LOCALE', 'en'),
    supported: (env('I18N_SUPPORTED', 'en,ar') || 'en,ar')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  },

  // ---- Feature flags ----
  features: {
    aiUserChat: env('FEATURE_AI_USER_CHAT', 'true') === 'true',
    aiAdminChat: env('FEATURE_AI_ADMIN_CHAT', 'true') === 'true',
    aiBuilder: env('FEATURE_AI_BUILDER', 'true') === 'true',
    codeStore: env('FEATURE_CODE_STORE', 'true') === 'true',
    subscriptions: env('FEATURE_SUBSCRIPTIONS', 'true') === 'true',
    chat: env('FEATURE_CHAT', 'true') === 'true',
    reports: env('FEATURE_REPORTS', 'true') === 'true',
  },

  // ---- Error reporting ----
  errors: {
    // Cap how many client-side error reports one IP may send per window.
    clientErrorLimit: parseInt(env('CLIENT_ERROR_LIMIT', '20'), 10),
  },

  // ---- Shared volatile state (rate limits, brute-force counters) ----
  // Single-node: leave REDIS_ENABLED unset -> in-memory adapter (no dependency
  // on a Redis server for local development). Multi-node: set
  // REDIS_ENABLED=true + REDIS_URL so every instance shares counters.
  // Never stores business/persistent data — the database layer owns that.
  redis: {
    enabled: env('REDIS_ENABLED', 'false').toLowerCase() === 'true',
    url: env('REDIS_URL', ''),
    // Connection name prefix so several apps can share one Redis safely.
    prefix: env('REDIS_PREFIX', 'cnw'),
  },

  // ---- Business payment methods (manual / customer-submitted flows) ----
  // InstaPay and Egyptian e-wallets have no REST API integration here:
  // customers transfer to the configured business account and submit the
  // payment reference; an ADMIN verifies and approves. The destination below
  // is what customers are told to pay to — never put private secrets here.
  payments: {
    instapay: {
      enabled: env('INSTAPAY_ENABLED', 'false') === 'true',
      accountName: env('INSTAPAY_ACCOUNT_NAME', ''),
      identifier: env('INSTAPAY_IDENTIFIER', ''), // InstaPay address (P2P alias/mobile)
      instructions: env('INSTAPAY_INSTRUCTIONS', ''),
    },
    wallet: {
      enabled: env('WALLET_ENABLED', 'false') === 'true',
      provider: env('WALLET_PROVIDER', ''), // e.g. vodafone-cash / etisalat-cash / orange-cash
      accountName: env('WALLET_ACCOUNT_NAME', ''),
      identifier: env('WALLET_IDENTIFIER', ''), // wallet number customers pay to
      instructions: env('WALLET_INSTRUCTIONS', ''),
    },
  },

  // ---- Plugins ----
  plugins: {
    // Route mounting for activated plugins is OFF by default and must be
    // explicitly enabled. Even when enabled, only ACTIVE plugins that were
    // granted `http:route` and registered non-colliding routes are served.
    routesEnabled: env('PLUGINS_ROUTES_ENABLED', 'false') === 'true',
  },
};

/** Generate a dev-safe fallback secret for local development only. */
function devSecret(seed) {
  if (config.isProduction) return '';
  // Stable per-machine dev secret (must NOT include the port — the backend
  // can fall back to another port on restart, and tokens must stay valid).
  // Never used in production.
  return crypto.createHash('sha256').update(`cnw-dev-${seed}`).digest('hex');
}

// Provide dev fallbacks so local development works out of the box.
const devFallbackKeys = [];
if (!config.isProduction) {
  if (!config.secrets.jwt) { config.secrets.jwt = devSecret('jwt'); devFallbackKeys.push('JWT_SECRET'); }
  if (!config.secrets.session) { config.secrets.session = devSecret('session'); devFallbackKeys.push('SESSION_SECRET'); }
  if (!config.secrets.encryptionKeys[1]) {
    config.secrets.encryptionKeys[1] = devSecret('enc-current');
    devFallbackKeys.push('ENCRYPTION_KEY_CURRENT');
  }
}

/**
 * Runtime environment metadata for startup diagnostics.
 * Only NAMES are exposed — never values.
 */
config.dotenv = {
  loaded: !dotenvResult.error && Boolean(dotenvResult.parsed),
  path: DOTENV_PATH,
  varCount: dotenvResult.parsed ? Object.keys(dotenvResult.parsed).length : 0,
  keys: dotenvResult.parsed ? Object.keys(dotenvResult.parsed) : [],
  error: dotenvResult.error ? dotenvResult.error.code || 'unreadable' : null,
};

/** True when generated development secrets are in use (never in production). */
config.secrets.usingDevFallback = devFallbackKeys.length > 0;
config.secrets.devFallbackKeys = devFallbackKeys;

module.exports = config;
