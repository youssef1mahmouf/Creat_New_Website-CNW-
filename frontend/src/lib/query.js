/** CNW lightweight server-state cache (vanilla alternative to TanStack Query).
 * The project is vanilla JS (no React), so @tanstack/react-query is
 * intentionally NOT installed — it requires React. This tiny cache wraps the
 * existing api client (`src/api/client.js`) with TTL caching, in-flight
 * dedup, and invalidation, without creating a second fetching system.
 *
 * Usage (future code only):
 *   import { cachedGet, invalidate } from './query.js';
 *   const { docs } = await cachedGet('/products?limit=100');
 */
import { api } from '../api/client.js';

const cache = new Map(); // key -> { at, data, promise }
const DEFAULT_TTL = 30_000;

export function cachedGet(path, { ttl = DEFAULT_TTL } = {}) {
  const now = Date.now();
  const hit = cache.get(path);
  if (hit?.data && now - hit.at < ttl) return Promise.resolve(hit.data);
  if (hit?.promise) return hit.promise;
  const promise = api.get(path).then((data) => {
    cache.set(path, { at: Date.now(), data, promise: null });
    return data;
  }).catch((err) => {
    if (cache.get(path)?.promise) cache.set(path, { ...cache.get(path), promise: null });
    throw err;
  });
  cache.set(path, { at: hit?.at || 0, data: hit?.data || null, promise });
  return promise;
}

export function invalidate(path) {
  if (path) cache.delete(path);
  else cache.clear();
}
