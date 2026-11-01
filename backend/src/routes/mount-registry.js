/**
 * Router mount registry.
 *
 * Express 5 builds its layer matchers from closures (path-to-regexp v8), so a
 * mounted router's prefix is NOT recoverable from the router internals. We
 * therefore record the prefix at the single place where each router is mounted
 * (`app.use('/api', routes)`, `router.use('/', resources)`), which lets startup
 * diagnostics print the real, complete API route table.
 *
 * Recording is side-effect free: it stores a string in a WeakMap keyed by the
 * router instance, so nothing about routing behavior changes.
 */
const mounts = new WeakMap();

/** Express routers are callable functions — accept both functions and objects. */
function isRoutable(value) {
  return Boolean(value) && (typeof value === 'object' || typeof value === 'function');
}

/** Remember the path a router is mounted at (parent chain aware). */
function recordMount(router, mountPath) {
  if (isRoutable(router)) mounts.set(router, String(mountPath || ''));
  return router;
}

/** The path a router was recorded at, or null when unknown. */
function getMountPath(router) {
  if (!isRoutable(router)) return null;
  return mounts.has(router) ? mounts.get(router) : null;
}

module.exports = { recordMount, getMountPath };