/**
 * Express application factory (exported for tests).
 * Defense-in-depth ordering:
 * Helmet -> CORS -> body parsing -> HPP -> sanitize -> rate limit -> routes
 * -> 404 -> centralized error handler.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const hpp = require('hpp');
const config = require('./config/env');
const routes = require('./routes');
const { globalLimiter } = require('./middleware/rate-limit.middleware');
const { sanitizeBody } = require('./security/sanitize');
const { notFoundHandler, errorHandler } = require('./middleware/error.middleware');
const { requestLogger } = require('./middleware/request-logger.middleware');
const { recordMount } = require('./routes/mount-registry');

/** Absolute path to the built frontend (frontend/dist). */
function frontendDistDir() {
  return path.resolve(__dirname, '..', '..', 'frontend', 'dist');
}

function frontendAvailable() {
  if (config.isTest) return false; // tests exercise the API only
  return fs.existsSync(path.join(frontendDistDir(), 'index.html'));
}

function createApp() {
  const app = express();

  // Trust forwarded client IPs only when explicitly running behind a proxy.
  // Blindly trusting one hop lets a directly exposed client spoof rate-limit
  // and audit identities through X-Forwarded-For.
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
  app.disable('x-powered-by');

  // --- Security headers ---
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'connect-src': ["'self'", ...config.cors.origins],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
        // upgrade-insecure-requests only makes sense behind real HTTPS; on plain
        // http://localhost it can break asset loading, so we enable it only in
        // production where the app is served over TLS.
        ...(config.isProduction ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    hsts: config.isProduction,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    noSniff: true,
  }));

  // --- CORS: explicit allow-list PLUS the server's own origin ---
  // When the backend also serves the frontend (single-server mode), the browser
  // sends an `Origin` header even for same-origin requests (crossorigin assets,
  // POST bodies). Without allowing the host itself, those requests would be
  // rejected and the page would fail to load. Never "*" in production.
  app.use((req, res, next) => {
    const self = `${req.protocol}://${req.get('host')}`;
    const allowedOrigins = [...config.cors.origins, self];
    cors({
      origin(origin, cb) {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('CORS not allowed'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    })(req, res, next);
  });

  // Request/response tracing (never logs bodies, headers, cookies or tokens).
  // Registered before body parsing so even malformed requests are traced and
  // every request carries an id for error correlation.
  app.use(requestLogger);

  app.use(express.json({ limit: '6mb' }));
  app.use(express.urlencoded({ extended: false, limit: '6mb' }));
  app.use(cookieParser(config.secrets.session));
  app.use(hpp()); // parameter pollution protection
  app.use(sanitizeBody); // XSS/injection scrubbing

  app.use(globalLimiter);

  // CSRF protection — double-submit cookie + header.
  // Mounted after body parsing + cookie parsing so it can read `cnw_csrf`.
  const { csrfMiddleware, ensureCsrfCookie } = require('./security/csrf');
  app.use((req, res, next) => {
    // Set/refresh the CSRF cookie on every response so a fresh token is always
    // available to the client (cookie is not HttpOnly so JS can read it).
    const origJson = res.json.bind(res);
    res.json = function (body) {
      if (!res.headersSent) ensureCsrfCookie(req, res, config.isProduction);
      return origJson(body);
    };
    next();
  });
  app.use(csrfMiddleware({
    // No bypass flags: `verifyCsrf` already allows cookie-less requests
    // (first-visit login/register, Bearer-token API clients) while requiring
    // the double-submit header on every request that carries an auth cookie.
    // In production the CSRF cookie must be Secure (HTTPS-only), matching
    // the auth cookies; in local dev (http) it must stay readable.
    secure: config.isProduction,
    onFail: (req, res, reason) => {
      // Log CSRF failures for security monitoring (never log tokens).
      if (process.env.NODE_ENV !== 'test') {
        console.warn(JSON.stringify({
          level: 'warn', msg: 'csrf_failed',
          method: req.method, path: req.originalUrl,
          ip: req.ip, reason,
        }));
      }
      res.status(403).json({
        success: false, code: 'CSRF_FAIL',
        message: 'Invalid or missing CSRF token',
      });
    },
  }));

  app.use('/api', routes);
  // Recorded so startup diagnostics can print the real, complete route table
  // (Express 5 does not expose a mounted router's prefix).
  recordMount(routes, '/api');

  // ---------------- Frontend (single-server mode) ----------------
  // When frontend/dist has been built, this backend serves the ENTIRE website:
  // the multi-page Vite build (/, /user/*, /admin/*) + /api on the same origin.
  const distDir = frontendDistDir();
  if (frontendAvailable()) {
    // Static Vite build assets
    app.use(express.static(distDir, { index: 'index.html', maxAge: '1h' }));

    // Multi-page fallback — the frontend build has a real HTML file per page
    // (index.html, user/*.html, admin/*.html), so serve the matching file
    // instead of always returning index.html (which hid the /user and /admin
    // folders: login never rendered, sign-in header never updated).
    const MPA_FALLBACKS = [
      { prefix: '/admin/', dir: 'admin', fallback: 'index.html' },
      { prefix: '/user/', dir: 'user', fallback: null },
    ];
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      // Root → index.html (already handled by express.static).
      if (req.path === '/' || req.path === '/index.html') return next();
      for (const { prefix, dir, fallback } of MPA_FALLBACKS) {
        if (req.path === prefix.slice(0, -1) && fallback) {
          return res.sendFile(path.join(distDir, dir, fallback));
        }
        if (req.path.startsWith(prefix)) {
          const rel = req.path.slice(prefix.length).split('?')[0].split('#')[0];
          if (!rel || rel.endsWith('/')) return next();
          const file = path.join(distDir, dir, path.normalize(rel));
          if (file.startsWith(path.join(distDir, dir)) && fs.existsSync(file)) {
            return res.sendFile(file);
          }
          return next();
        }
      }
      // Unknown top-level path → home page.
      return res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    // API-only mode: root route shows friendly API info.
    app.get('/', (_req, res) => {
      res.json({
        name: 'CNW — Create New Website API',
        status: 'ok',
        note: 'Frontend build not found. Run the frontend dev server (vite) or build it with: npm run build (in frontend/).',
        docs: { health: '/api/health', products: '/api/products', designs: '/api/designs' },
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  // Diagnostics metadata (read by the startup report; no routing impact).
  app.locals.cnw = {
    frontend: {
      available: frontendAvailable(),
      dir: path.relative(path.resolve(__dirname, '..', '..'), distDir) || 'frontend/dist',
    },
  };

  return app;
}

module.exports = { createApp };
