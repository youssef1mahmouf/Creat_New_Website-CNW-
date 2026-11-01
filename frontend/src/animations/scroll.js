/** Smooth scroll utility — Lenis-powered for buttery scrolling.
 * Imported by main.js and interactions/cards.js.
 */
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

let lenis = null;
let initialized = false;

export function getLenis() { return lenis; }

function initSmoothScroll() {
  if (typeof Lenis === 'undefined') return null;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || initialized) return;
  
  lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    native: false,
    smoothWheel: true,
  });
  initialized = true;
  
  function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);
  return lenis;
}

function destroySmoothScroll() {
  if (lenis) { lenis.destroy(); lenis = null; initialized = false; }
}

/** Animate elements with [data-animate] on scroll. Safe to call after each render. */
export function startScrollAnimations() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const els = document.querySelectorAll('[data-animate]:not([data-animate-done])');
  if (reduced) {
    els.forEach((el) => { el.style.opacity = '1'; el.dataset.animateDone = '1'; });
    return;
  }

  els.forEach((el) => {
    el.dataset.animateDone = '1';
    gsap.fromTo(el,
      { opacity: 0, y: 40 },
      {
        opacity: 1, y: 0, duration: 0.8, ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      });
  });

  // Stagger card groups
  document.querySelectorAll('[data-stagger]:not([data-stagger-done])').forEach((group) => {
    group.dataset.staggerDone = '1';
    gsap.fromTo(group.children,
      { opacity: 0, y: 30 },
      {
        opacity: 1, y: 0, duration: 0.6, stagger: 0.12, ease: 'power2.out',
        scrollTrigger: { trigger: group, start: 'top 85%', once: true },
      });
  });

  ScrollTrigger.refresh();
}

export { initSmoothScroll, destroySmoothScroll, gsap };

