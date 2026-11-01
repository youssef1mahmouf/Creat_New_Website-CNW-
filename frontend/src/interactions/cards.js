/** Micro-interactions: 3D tilt cards + magnetic buttons (GSAP-driven). */
import { gsap } from '../animations/scroll.js';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Attach to .card elements with data-tilt — cleaned up automatically via element removal. */
export function attachTilt(scope = document) {
  if (reduced()) return;
  scope.querySelectorAll('[data-tilt]').forEach((card) => {
    const onMove = (e) => {
      const rect = card.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      gsap.to(card, { rotationY: px * 12, rotationX: -py * 12, transformPerspective: 700, duration: 0.4 });
    };
    const onLeave = () => gsap.to(card, { rotationX: 0, rotationY: 0, duration: 0.6, ease: 'power2.out' });
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerleave', onLeave);
  });
}

/** Buttons gently follow the cursor. */
export function attachMagnetic(scope = document) {
  if (reduced()) return;
  scope.querySelectorAll('[data-magnetic]').forEach((btn) => {
    const onMove = (e) => {
      const rect = btn.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      gsap.to(btn, { x: dx * 0.15, y: dy * 0.15, duration: 0.3 });
    };
    const onLeave = () => gsap.to(btn, { x: 0, y: 0, duration: 0.4 });
    btn.addEventListener('pointermove', onMove);
    btn.addEventListener('pointerleave', onLeave);
  });
}
