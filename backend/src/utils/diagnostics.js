/**
 * Startup diagnostics & developer-console rendering for the CNW backend.
 *
 * Every value printed here is read from the running process (package.json,
 * config, database service, Express app) — nothing is hardcoded or faked.
 * SECURITY: secrets are reported by NAME only (`OPENAI_API_KEY : configured`),
 * never by value; MongoDB URIs are never printed.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const terminal = require('./terminal');
const logger = require('./logger');
const config = require('../config/env');
const { getMountPath } = require('../routes/mount-registry');

/** backend/ and project root directories. */
const APP_DIR = path.resolve(__dirname, '..', '..');
const ROOT_DIR = path.resolve(APP_DIR, '..');

/** package.json of the backend (name/version/description). */
function packageInfo() {
  try {
    return require(path.join(APP_DIR, 'package.json'));
  } catch {
    return { name: 'cnw-backend', version: '0.0.0', description: '' };
  }
}

function ms(value) {
  if (value === null || value === undefined) return 'n/a';
  return value < 10 ? `${value.toFixed(1)}ms` : `${Math.round(value)}ms`;
}

function safeText(value) {
  return logger.redactValue(String(value === undefined || value === null ? '' : value));
}

// ---------------------------------------------------------------- routes ----

/**
 * Every route the Express app exposes, discovered by walking the router stack.
 * Nested routers resolve their prefix through the mount registry.
 */
function collectRoutes(app) {
  const routes = [];
  const seen = new Set();
  const rootRouter = app && (app.router || app._router);

  const walk = (router, prefix) => {
    const stack = (router && router.stack) || [];
    for (const layer of stack) {
      if (layer.route) {
        const suffix = layer.route.path === '/' ? '' : layer.route.path;
        const full = `${prefix}${suffix}` || '/';
        const handlers = (layer.route.stack || []).map((s) => s.name).filter(Boolean);
        for (const method of Object.keys(layer.route.methods || {})) {
          const key = `${method.toUpperCase()} ${full}`;
          if (seen.has(key)) continue;
          seen.add(key);
          routes.push({ method: method.toUpperCase(), path: full, protected: handlers.includes('authenticate') });
        }
        continue;
      }
      if (layer.handle && Array.isArray(layer.handle.stack)) {
        const mount = getMountPath(layer.handle);
        walk(layer.handle, `${prefix}${mount === null ? '' : mount}`);
      }
    }
  };

  walk(rootRouter, '');
  return routes;
}

/** Global middleware layers + presence of the not-found / error handlers. */
function appShape(app) {
  const stack = (app && (app.router || app._router) || {}).stack || [];
  let middleware = 0;
  let routers = 0;
  let routes = 0;
  for (const layer of stack) {
    if (layer.route) routes += 1;
    else if (layer.handle && Array.isArray(layer.handle.stack)) routers += 1;
    else middleware += 1;
  }
  const names = stack.map((l) => l.name);
  return {
    middleware,
    routers,
    routes,
    errorHandler: names.includes('errorHandler'),
    notFoundHandler: names.includes('notFoundHandler'),
  };
}

/** The API route table as [method, path] rows, protected routes marked. */
function routeRows(routes) {
  return routes.map((r) => [r.method, `${r.path}${r.protected ? '  (auth)' : ''}`]);
}

// ----------------------------------------------------------- boot header ----

/** Title banner + `[BOOT]` block. Call this first, before anything is loaded. */
function printBoot() {
  const pkg = packageInfo();
  terminal.print(terminal.banner('CNW BACKEND SERVER', `${pkg.name} v${pkg.version}`));
  terminal.print(terminal.line('boot', 'Starting backend...'));
  terminal.print(terminal.line('boot', `Application      : ${pkg.name} v${pkg.version}`));
  terminal.print(terminal.line('boot', `Environment      : ${config.nodeEnv}`));
  terminal.print(terminal.line('boot', `Node.js          : ${process.version}`));
  terminal.print(terminal.line('boot', `Process ID       : ${process.pid}`));
  terminal.print(terminal.line('boot', `Server directory : ${APP_DIR}`));
  terminal.print(terminal.line('boot', `Console          : ${logger.format} logs at level ${logger.levelName}`));
}

// ------------------------------------------------------------ environment ---

/** ENVIRONMENT section: .env status, variable count, missing secrets (names only). */
function printEnvironment() {
  const dotenv = config.dotenv || { loaded: false, path: '', varCount: 0, keys: [] };
  const relative = dotenv.path ? path.relative(ROOT_DIR, dotenv.path) : '';
  terminal.print(terminal.section('Environment'));
  terminal.align(['.env file', 'Environment variables', 'Required configuration', 'Secrets']);

  if (dotenv.loaded) {
    terminal.print(terminal.status('ok', '.env file', `${relative || dotenv.path}`));
  } else {
    terminal.print(terminal.status('warn', '.env file', 'not found — using process environment only'));
  }
  terminal.print(terminal.status('ok', 'Environment variables', `${dotenv.varCount} loaded from .env`));

  // Production-required values must exist; in development they have safe fallbacks.
  const required = ['JWT_SECRET', 'SESSION_SECRET'];
  if (config.isProduction) required.push('MONGODB_URI');
  const missingRequired = required.filter((k) => !process.env[k]);
  if (missingRequired.length === 0) {
    terminal.print(terminal.status('ok', 'Required configuration', `checked (${required.join(', ')})`));
  } else if (config.isProduction) {
    missingRequired.forEach((k) => terminal.print(terminal.status('err', 'Required configuration', `${k} is missing — the server cannot start`)));
  } else {
    terminal.print(terminal.status('warn', 'Required configuration', `using generated development secrets for: ${missingRequired.join(', ')}`));
  }

  // Secret inventory: names + configured/not set. Values are never read here.
  // MONGODB_URI is always listed so `DB_TYPE=mongodb` without credentials is obvious.
  const secretKeys = [...new Set([...dotenv.keys, 'JWT_SECRET', 'SESSION_SECRET', 'MONGODB_URI', 'OPENAI_API_KEY'])]
    .filter((k) => logger.isCredentialName(k))
    .sort((a, b) => a.localeCompare(b));
  const configured = secretKeys.filter((k) => process.env[k]);
  const notSet = secretKeys.filter((k) => !process.env[k]);
  terminal.print(terminal.status('ok', 'Secrets', `${configured.length} configured, ${notSet.length} not set (values are never printed)`));
  configured.forEach((k) => terminal.print(terminal.status('ok', k, 'configured')));
  notSet.forEach((k) => terminal.print(terminal.status('warn', k, 'not set')));

  if (!config.isProduction) {
    terminal.print(terminal.status('warn', 'Mode', 'development mode is active (never use it in production)'));
  }
  if (config.secrets && config.secrets.usingDevFallback) {
    terminal.print(terminal.status('warn', 'Dev secrets', 'JWT/session encryption keys are generated per-machine fallbacks'));
  }
}

/** Debug-only CONFIGURATION section (safe values: no secrets). */
function printConfiguration() {
  if (logger.format === 'off' || logger.minLevel > 10) return;
  terminal.print(terminal.section('Configuration (debug)'));
  terminal.align(['CORS origins', 'JWT access TTL', 'Locales', 'Feature flags', 'JSON database dir']);
  terminal.print(terminal.status('info', 'CORS origins', config.cors.origins.join(', ')));
  terminal.print(terminal.status('info', 'JWT access TTL', config.jwt.accessTtl));
  terminal.print(terminal.status('info', 'Locales', config.i18n.supported.join(', ')));
  const on = Object.entries(config.features).filter(([, v]) => v).map(([k]) => k);
  terminal.print(terminal.status('info', 'Feature flags', `${on.length} enabled (${on.join(', ')})`));
  terminal.print(terminal.status('info', 'JSON database dir', config.db.jsonDir || 'backend/database/json (default)'));
}

// -------------------------------------------------------------- database ----

/** Count the JSON data files actually present (diagnostic only, never authoritative). */
function jsonFileCount(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

/**
 * DATABASE section. `info` comes from the live db service:
 * { type, connected, fallback, fallbackReason, location, loadTimeMs, tables }
 */
function printDatabase(info = {}) {
  terminal.print(terminal.section('Database'));
  terminal.align(['Database type', 'Database status', 'Fallback mode', 'Database location', 'Load time', 'Tables']);
  const type = String(info.type || 'json').toUpperCase();
  terminal.print(terminal.status('ok', 'Database type', type));
  terminal.print(terminal.status(info.connected ? 'ok' : 'err', 'Database status', info.connected ? 'Connected' : 'Not connected'));
  terminal.print(terminal.status(info.fallback ? 'warn' : 'ok', 'Fallback mode', info.fallback ? 'Enabled (degraded mode)' : 'Disabled'));
  terminal.print(terminal.status('ok', 'Database location', safeText(info.location || 'n/a')));
  terminal.print(terminal.status('ok', 'Load time', ms(info.loadTimeMs)));
  if (info.tables) {
    terminal.print(terminal.status('ok', 'Tables', `${info.tables} registered${info.dataFiles !== undefined ? `, ${info.dataFiles} data files present` : ''}`));
  }

  if (info.fallback) {
    terminal.print(terminal.status('warn', 'Fallback enabled', 'the primary database is unavailable'));
    terminal.print(terminal.kv('Reason', safeText(info.fallbackReason || 'unknown')));
    terminal.print(terminal.kv('Action', 'Fix the primary database settings in backend/.env; data written now lands in the JSON store.'));
  }
}

// ---------------------------------------------------------------- server ----

/**
 * SERVER section. `info` = { host, port, address, apiUrl, healthUrl, frontend }
 */
function printServer(info = {}) {
  terminal.print(terminal.section('Server'));
  terminal.align(['Host', 'Port', 'Bind', 'API', 'Health', 'Frontend']);
  terminal.print(terminal.status('ok', 'Host', info.host || 'localhost'));
  terminal.print(terminal.status('ok', 'Port', String(info.port)));
  terminal.print(terminal.status('ok', 'Bind', info.address ? `${info.address} (all interfaces)` : 'all interfaces'));
  terminal.print(terminal.status('ok', 'API', info.apiUrl));
  terminal.print(terminal.status('ok', 'Health', info.healthUrl));
  terminal.print(terminal.status(info.frontend && info.frontend.available ? 'ok' : 'warn', 'Frontend',
    info.frontend && info.frontend.available
      ? `served from ${info.frontend.dir} (single-server mode)`
      : 'API-only mode — build it with: npm run build:ui'));
}

// ---------------------------------------------------------------- routes ----

/** ROUTES + API ROUTES sections, discovered from the live Express app. */
function printRoutes(app, { showTable } = {}) {
  const envPreference = process.env.CNW_SHOW_ROUTES;
  const listRoutes = showTable !== undefined
    ? showTable
    : envPreference === '0' ? false : envPreference === '1' ? true : !config.isProduction;
  const routes = collectRoutes(app);
  const shape = appShape(app);
  const protectedCount = routes.filter((r) => r.protected).length;

  terminal.print(terminal.section('Routes'));
  terminal.align(['Routes initialized', 'Middleware loaded', 'Authentication loaded', 'Error handler loaded']);
  terminal.print(terminal.status('ok', 'Routes initialized',
    `${routes.length} endpoints across ${shape.routers} router${shape.routers === 1 ? '' : 's'}`));
  terminal.print(terminal.status('ok', 'Middleware loaded', `${shape.middleware} global layers`));
  terminal.print(terminal.status(protectedCount > 0 ? 'ok' : 'warn', 'Authentication loaded',
    `${protectedCount} protected endpoints (JWT + live session check)`));
  terminal.print(terminal.status(shape.errorHandler ? 'ok' : 'warn', 'Error handler loaded',
    `${shape.notFoundHandler ? 'not-found handler + ' : ''}centralized error handler`));

  if (!listRoutes || routes.length === 0) {
    terminal.print(terminal.status('info', 'API routes', `${routes.length} discovered (set CNW_SHOW_ROUTES=1 to list them here)`));
    return routes;
  }

  terminal.print(terminal.section('API routes'));
  terminal.print(terminal.table(routeRows(routes)));
  terminal.print('');
  terminal.print(terminal.paint(`  ${routes.length} routes (${protectedCount} require authentication)`, 'gray'));
  return routes;
}

// ---------------------------------------------------------------- health ----

/** Live HTTP self-check against the health endpoint (real round-trip). */
function selfCheck(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    const elapsed = () => Number(process.hrtime.bigint() - startedAt) / 1e6;
    const req = http.get(url, (res) => {
      res.resume();
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        ms: elapsed(),
      }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timed out after ${timeoutMs}ms`)));
    req.on('error', (err) => resolve({ ok: false, error: safeText(err.message), ms: elapsed() }));
  });
}

/** HEALTH block: state derived from real subsystems (no new endpoint created). */
function printHealth({ dbInfo, routes, selfCheckResult }) {
  terminal.print(terminal.section('Health'));
  terminal.align(['Server', 'Database', 'Routes', 'Environment', 'Self-check']);
  terminal.print(terminal.status('ok', 'Server', 'READY'));
  terminal.print(terminal.status(dbInfo && dbInfo.connected ? 'ok' : 'err', 'Database', dbInfo && dbInfo.connected ? 'READY' : 'NOT READY'));
  terminal.print(terminal.status(routes && routes.length ? 'ok' : 'warn', 'Routes', routes && routes.length ? `READY (${routes.length})` : 'NONE'));
  terminal.print(terminal.status(config.isProduction ? 'ok' : 'warn', 'Environment', config.nodeEnv));
  if (selfCheckResult) {
    terminal.print(terminal.status(selfCheckResult.ok ? 'ok' : 'warn', 'Self-check',
      selfCheckResult.ok
        ? `GET /api/health -> ${selfCheckResult.status} (${ms(selfCheckResult.ms)})`
        : `GET /api/health failed: ${selfCheckResult.error || `HTTP ${selfCheckResult.status}`}`));
  }
}

/** Final banner + ready lines. */
function printReady({ apiUrl, healthUrl, frontendUrl }) {
  terminal.print(terminal.banner('SERVER READY'));
  terminal.print(terminal.paint(`${terminal.GLYPH.ok} CNW backend is running`, 'green', 'bold'));
  terminal.print(`  API      : ${apiUrl}`);
  terminal.print(`  Health   : ${healthUrl}`);
  terminal.print(`  Frontend : ${frontendUrl}`);
  terminal.print(terminal.paint(`${terminal.GLYPH.ok} Waiting for requests...`, 'green'));
  terminal.print('');
}

// --------------------------------------------------------------- failures ----

/** First non-internal stack frame: { fn, file, line }. */
function frameInfo(err) {
  const line = String((err && err.stack) || '')
    .split('\n')
    .slice(1)
    .find((l) => /^\s+at /.test(l) && !/node:internal|node:events|node:net/.test(l));
  if (!line) return { fn: null, file: null, line: null };
  // `at fn (path:line:col)` | `at path:line:col` | `at fn (<anonymous>)`
  const withFile = line.match(/at\s+(?:(.+?)\s+\()?([^()]+?):(\d+):(\d+)\)?\s*$/);
  if (withFile) {
    return { fn: withFile[1] || '(anonymous)', file: withFile[2], line: Number(withFile[3]) };
  }
  const nameOnly = line.match(/at\s+(.+?)\s*(?:\(.*\))?\s*$/);
  return { fn: nameOnly ? nameOnly[1].trim() : null, file: null, line: null };
}

/** Map a failure to { reason, cause, location, action } — actionable and secret-free. */
function diagnose(err) {
  const code = (err && err.code) || '';
  const type = (err && err.type) || '';
  const message = safeText((err && err.message) || String(err));
  const frame = frameInfo(err);
  const where = frame.file
    ? `${frame.file}${frame.line ? `:${frame.line}` : ''}${frame.fn ? ` (${frame.fn})` : ''}`
    : 'unknown';

  if (code === 'EADDRINUSE') {
    return {
      reason: `Port ${config.port} is already in use.`,
      cause: 'the TCP port is bound by another process',
      location: 'TCP port binding (app.listen)',
      action: [
        'Another CNW backend instance may already be running — stop it first.',
        'Or another application owns the port.',
        `Windows: netstat -ano | findstr :${config.port}   then   taskkill /PID <pid> /F`,
        `Or change PORT in backend/.env (for example PORT=${config.port + 1}).`,
      ].join('\n'),
    };
  }
  if (code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(message)) {
    return {
      reason: message,
      cause: 'a required dependency or local module is missing',
      location: where,
      action: 'Install backend dependencies: npm install   (inside backend/)',
    };
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return {
      reason: message,
      cause: 'insufficient permission for the requested port or path',
      location: where,
      action: 'Use a port above 1024, or run the terminal as administrator.',
    };
  }
  if (/MongoServerSelection|MongoNetworkError|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(message)) {
    return {
      reason: 'Database connection failed.',
      cause: 'the database host is unreachable (network, URI or IP allow-list)',
      location: where,
      action: 'Check MONGODB_URI, network access and the Atlas IP allow-list — or set DB_TYPE=json for local development.',
    };
  }
  if (type === 'entity.parse.failed' || /Unexpected (end of JSON input|token)/i.test(message)) {
    return {
      reason: message,
      cause: 'the request body is not valid JSON (malformed or truncated payload)',
      location: where,
      action: 'Send a well-formed JSON body with Content-Type: application/json.',
    };
  }
  if (err && err.name === 'SyntaxError') {
    return {
      reason: message,
      cause: 'a JavaScript syntax error in the reported file',
      location: where,
      action: 'Fix the syntax error above, then start the server again.',
    };
  }
  return {
    reason: message,
    cause: 'an unhandled exception escaped the request handlers',
    location: where,
    action: 'Review the stack trace below, fix the reported module, then restart the server.',
  };
}

/** STARTUP FAILED block (spec: reason / location / suggested action / exit code). */
function printStartupFailure(err) {
  const { reason, location, action } = diagnose(err);
  terminal.print(terminal.banner('STARTUP FAILED'));
  terminal.print(terminal.line('err', 'Failed to start CNW backend'));
  terminal.print('');
  terminal.print('Reason:');
  terminal.print(`  ${reason}`);
  terminal.print('Location:');
  terminal.print(`  ${location}`);
  terminal.print('Suggested action:');
  action.split('\n').forEach((l) => terminal.print(`  ${l}`));
  if (!config.isProduction && err && err.stack) {
    terminal.print('');
    terminal.print('Stack:');
    terminal.print(String(err.stack).split('\n').slice(1, 8).map((l) => `  ${l.trim()}`).join('\n'));
  }
  terminal.print('');
  terminal.print(terminal.paint('Server was NOT started.', 'red', 'bold'));
  terminal.print(terminal.rule());
  return 1;
}

/** Clear PORT CONFLICT block — never kills another process automatically. */
function printPortConflict({ port, nextPort, willRetry = false, production = false }) {
  terminal.print(terminal.section('Port conflict'));
  terminal.print(terminal.line('err', `Port ${port} is already in use.`));
  terminal.print('');
  terminal.print('  Possible causes:');
  terminal.print('   - Another CNW backend instance is already running');
  terminal.print(`   - Another application is using port ${port}`);
  terminal.print('');
  terminal.print('  Suggested actions:');
  terminal.print('   1. Stop the existing process');
  terminal.print(`      Windows: netstat -ano | findstr :${port}   then   taskkill /PID <pid> /F`);
  terminal.print('   2. Change PORT in backend/.env');
  terminal.print('');
  if (willRetry) {
    terminal.print(terminal.line('warn', `Development mode: trying port ${nextPort} instead (nothing else was killed).`));
  } else if (production) {
    terminal.print(terminal.line('err', 'Production mode: refusing to drift to another port. Server was NOT started.'));
  }
}

/** Runtime ERROR block: what happened / where / why / what to do. */
function printRuntimeError({ scope = 'SERVER', err, req, action } = {}) {
  const frame = frameInfo(err);
  const info = diagnose(err);
  terminal.print('');
  terminal.print(terminal.rule());
  terminal.print(terminal.paint(`[ERROR] ${String(scope).toUpperCase()}`, 'red', 'bold'));
  terminal.print(terminal.rule());
  terminal.print(`Message  : ${safeText((err && err.message) || String(err))}`);
  if (req) {
    terminal.print(`Request  : ${req.method} ${safeText(req.originalUrl || req.url || '')}${req.id ? `  (#${req.id})` : ''}`);
    terminal.print(`Status   : ${(err && err.statusCode) || 500}`);
  }
  if (!config.isProduction) {
    terminal.print(`File     : ${info.location}`);
    terminal.print(`Function : ${frame.fn || 'unknown'}`);
  }
  terminal.print(`Cause    : ${info.cause}`);
  terminal.print(`Action   : ${action || info.action}`);
  if (!config.isProduction && err && err.stack) {
    terminal.print(`Stack    : ${String(err.stack).split('\n').slice(1, 6).map((l) => l.trim()).join('\n           ')}`);
  }
  terminal.print(terminal.rule());
}

// -------------------------------------------------------------- shutdown ----

function printShutdownStart() {
  terminal.print('');
  terminal.print(terminal.rule());
  terminal.print(terminal.line('shutdown', 'Stopping CNW backend...'));
}

/** `steps`: [{ label, ok, detail }] — only real steps are ever listed. */
function printShutdownSteps(steps = []) {
  terminal.align(steps.map((s) => s.label));
  steps.forEach((s) => terminal.print(terminal.status(s.ok ? 'ok' : 'warn', s.label, s.detail || '')));
}

function printShutdownDone({ reason = 'SIGINT', forced = false } = {}) {
  terminal.print(terminal.rule());
  terminal.print(terminal.paint('CNW backend stopped safely.', 'green', 'bold'));
  terminal.print(terminal.paint(`  Trigger: ${reason}${forced ? ' (forced exit after timeout)' : ''}`, 'gray'));
  terminal.print('');
}

module.exports = {
  packageInfo,
  collectRoutes,
  appShape,
  routeRows,
  jsonFileCount,
  frameInfo,
  diagnose,
  selfCheck,
  printBoot,
  printEnvironment,
  printConfiguration,
  printDatabase,
  printServer,
  printRoutes,
  printHealth,
  printReady,
  printStartupFailure,
  printPortConflict,
  printRuntimeError,
  printShutdownStart,
  printShutdownSteps,
  printShutdownDone,
};