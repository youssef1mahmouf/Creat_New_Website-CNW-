/** Page lifecycle — cleanup registry (Three.js scenes, listeners, GSAP tweens). */
const cleanups = [];

export function registerCleanup(fn) {
  cleanups.push(fn);
}

export function runCleanups() {
  while (cleanups.length) {
    try { cleanups.pop()(); } catch { /* ignore */ }
  }
}