/** CNW backend entry point. */
const config = require('./src/config/env');
const db = require('./src/services/db.service');
const authService = require('./src/services/auth.service');
const pluginManager = require('./src/plugins/plugin-manager');
const logger = require('./src/utils/logger');
const terminal = require('./src/utils/terminal');
const diagnostics = require('./src/utils/diagnostics');
const { createApp } = require('./src/app');

// Auto-open browser on startup (development only)
function openBrowser(url) {
  if (config.isProduction || config.isTest) return;
  const { execSync } = require('child_process');
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      execSync(`start chrome "${url}"`, { stdio: 'ignore' });
    } else if (platform === 'darwin') {
      execSync(`open -a "Google Chrome" "${url}"`, { stdio: 'ignore' });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    }
  } catch {
    // Browser may not be installed - silently ignore
  }
}

async function seedInitialData() {
  // Seed admin
  await authService.ensureSeedAdmin();

  // Seed design-type products (pricing cards) if none exist
  const productCount = await db.count('products');
  if (productCount === 0) {
    const seedProducts = [
      { name: 'Formal Design Package', slug: 'formal-design', description: 'Clean, professional corporate design.', price: 299, designType: 'formal', features: ['Responsive layout', 'SEO basics', 'Contact form'], availability: 'available', access: 'public' },
      { name: '3D Design Package', slug: '3d-design', description: 'Interactive Three.js scenes and models.', price: 599, designType: '3d', features: ['3D hero scenes', 'Interactive models', 'Lighting & camera moves'], availability: 'available', access: 'public' },
      { name: '3D Animation Package', slug: '3d-animation', description: 'GSAP + Three.js motion experiences.', price: 899, designType: '3d-animation', features: ['Scroll animations', 'Particles & bloom', 'Micro-interactions'], availability: 'limited', access: 'members' },
      { name: 'Interactive Design Package', slug: 'interactive-design', description: 'Rich interactive UX with postprocessing effects.', price: 749, designType: 'interactive', features: ['Interactive cards', 'Smooth scrolling', 'Custom effects'], availability: 'available', access: 'public' },
    ];
    for (const p of seedProducts) await db.create('products', { ...p, currency: 'USD', status: 'published' });
    logger.info('seed_products_created', { count: seedProducts.length });
  }

  // Seed design records for the editor
  const designCount = await db.count('designs');
  if (designCount === 0) {
    const types = ['formal', '3d', '3d-animation', 'interactive'];
    for (const t of types) {
      await db.create('designs', {
        name: `${t} showcase`,
        designType: t,
        concept: `${t} design concept for CNW showcase.`,
        capabilities: ['responsive', 'animated', 'optimized'],
        price: 0,
        data: { canvas: { layers: [], background: '#0b0f1a' } },
        status: 'active',
      });
    }
  }

  await pluginManager.seedExamplePlugins();
}

/**
 * Start the HTTP server.
 * - Development: if the configured port is busy (EADDRINUSE), automatically
 *   fall back to the next ports (+1 … +10) with a clear, actionable report.
 * - Production: fail fast with an actionable message (never silently drift ports).
 */
function listenWithFallback(app) {
  const basePort = config.port;
  const maxAttempts = config.isProduction ? 1 : 11; // base port + 10 fallbacks

  return new Promise((resolve, reject) => {
    let attempt = 0;
    let conflictReported = false;
    const tryListen = (port) => {
      attempt += 1;
      const server = app.listen(port);
      server.once('listening', () => resolve({ server, port }));
      server.once('error', (err) => {
        server.close(() => {});
        if (err.code === 'EADDRINUSE' && attempt < maxAttempts) {
          if (!conflictReported) {
            diagnostics.printPortConflict({ port, nextPort: port + 1, willRetry: true });
            conflictReported = true;
          } else {
            logger.warn('port_in_use_trying_next', { port, nextPort: port + 1 });
          }
          tryListen(port + 1);
        } else if (err.code === 'EADDRINUSE') {
          if (config.isProduction) diagnostics.printPortConflict({ port: basePort, production: true });
          const failure = new Error(
            `Port ${basePort} is already in use by another application.\n` +
            `Fix: stop that application, or set a free port in backend/.env (e.g. PORT=5050).\n` +
            `To find the process on Windows:  netstat -ano | findstr :${basePort}`
          );
          failure.code = 'EADDRINUSE';
          reject(failure);
        } else {
          reject(err);
        }
      });
    };
    tryListen(basePort);
  });
}

/**
 * Graceful shutdown: stop accepting connections, flush pending writes, exit.
 * A second Ctrl+C forces an immediate exit.
 */
function installShutdownHandlers(server) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) {
      terminal.print(terminal.line('warn', 'Second interrupt received — forcing exit.'));
      process.exit(1);
    }
    shuttingDown = true;
    diagnostics.printShutdownStart();

    const steps = [];
    try {
      await db.flush();
      steps.push({ label: 'Pending database writes flushed', ok: true, detail: 'debounced JSON writes committed' });
    } catch (err) {
      steps.push({ label: 'Pending database writes flushed', ok: false, detail: logger.redactValue(err.message) });
    }

    let forced = false;
    await new Promise((resolve) => {
      let settled = false;
      const settle = () => { if (!settled) { settled = true; resolve(); } };
      // Hard limit: a request still streaming after 3s must not hang Ctrl+C.
      const hardTimer = setTimeout(() => {
        forced = true;
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        steps.push({
          label: 'HTTP server closed',
          ok: false,
          detail: 'active connections closed after 3000ms timeout',
        });
        settle();
      }, 3000);

      server.close(() => {
        if (settled) return;
        clearTimeout(hardTimer);
        steps.push({
          label: 'HTTP server closed',
          ok: true,
          detail: 'idle connections closed, no new connections accepted',
        });
        settle();
      });
      // Release keep-alive (browser) sockets so close() can complete immediately.
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    });

    // Release the shared-state adapter (Redis connection when enabled).
    // No-op for the in-memory adapter; never throws.
    try {
      const { closeBruteAdapter } = require('./src/middleware/rate-limit.middleware');
      const adapterKind = require('./src/middleware/rate-limit.middleware').getBruteAdapter().kind;
      await closeBruteAdapter();
      steps.push({
        label: 'Shared state adapter released',
        ok: true,
        detail: adapterKind === 'redis' ? 'Redis connection closed' : 'in-memory adapter (no external connection)',
      });
    } catch (err) {
      steps.push({
        label: 'Shared state adapter released',
        ok: false,
        detail: logger.redactValue(err.message),
      });
    }

    diagnostics.printShutdownSteps(steps);
    diagnostics.printShutdownDone({ reason: signal, forced });
    process.exit(forced ? 1 : 0);
  };

  process.on('SIGINT', () => shutdown('SIGINT (Ctrl+C)'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function main() {
  diagnostics.printBoot();
  diagnostics.printEnvironment();
  diagnostics.printConfiguration();

  await db.connect();
  const liveDbInfo = db.info;
  const dbInfo = {
    ...liveDbInfo,
    dataFiles: liveDbInfo.type === 'json' ? diagnostics.jsonFileCount(liveDbInfo.location) : undefined,
  };
  diagnostics.printDatabase(dbInfo);

  await seedInitialData();

  // Warm the shared-state adapter (Redis when REDIS_ENABLED=true) during
  // startup so the first login never pays the `redis` module load, and the
  // selection is visible in the boot log. Never blocks startup: creation is
  // lazy (no connection is opened here) and falls back to memory on any error.
  try {
    const brute = require('./src/middleware/rate-limit.middleware');
    logger.info('state_adapter_ready', { kind: brute.getBruteAdapter().kind });
  } catch { /* adapter is fail-open by design */ }

  const app = createApp();
  const { server, port } = await listenWithFallback(app);
  const binding = server.address() || {};
  // Always report the port the socket actually bound to (PORT=0 → ephemeral port).
  const actualPort = binding.port || port;

  const frontendUrl = `http://localhost:${actualPort}`;
  const apiUrl = `${frontendUrl}/api`;
  const healthUrl = `${apiUrl}/health`;
  const frontend = (app.locals.cnw && app.locals.cnw.frontend) || { available: false, dir: 'frontend/dist' };
  const host = 'localhost';

  diagnostics.printServer({ host, port: actualPort, address: binding.address, apiUrl, healthUrl, frontend });
  const routes = diagnostics.printRoutes(app);

  const selfCheckResult = await diagnostics.selfCheck(healthUrl);
  diagnostics.printHealth({ dbInfo: db.info, routes, selfCheckResult });

  // Open Chrome (development only) to the frontend, or to the API root if the
  // frontend has not been built yet.
  openBrowser(frontend.available ? frontendUrl : apiUrl);

  diagnostics.printReady({
    apiUrl,
    healthUrl,
    frontendUrl: frontend.available ? frontendUrl : `${apiUrl} (frontend not built)`,
  });

  installShutdownHandlers(server);
}

main().catch((err) => {
  process.exit(diagnostics.printStartupFailure(err));
});

