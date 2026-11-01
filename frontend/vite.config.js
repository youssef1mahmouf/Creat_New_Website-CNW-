import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/** Multi-page (MPA) entries — user pages live in /user, admin pages in /admin. */
const page = (p) => fileURLToPath(new URL(p, import.meta.url));
const input = {
  home: page('index.html'),
  // ----- user pages -----
  'user-about': page('user/about.html'),
  'user-contact': page('user/contact.html'),
  'user-designs': page('user/designs.html'),
  'user-design-detail': page('user/design-detail.html'),
  'user-pricing': page('user/pricing.html'),
  'user-cart': page('user/cart.html'),
  'user-payment': page('user/payment.html'),
  'user-login': page('user/login.html'),
  'user-register': page('user/register.html'),
  'user-forgot': page('user/forgot.html'),
  'user-dashboard': page('user/dashboard.html'),
  'user-architect': page('user/architect.html'),
  'user-store': page('user/store.html'),
  'user-chat': page('user/chat.html'),
  'user-profile': page('user/profile.html'),
  'user-subscriptions': page('user/subscriptions.html'),
  // ----- admin pages -----
  'admin-dashboard': page('admin/index.html'),
  'admin-ai-builder': page('admin/ai-builder.html'),
  'admin-editor': page('admin/editor.html'),
};

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Dev proxy: frontend talks to the backend API (override with API_TARGET env var)
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200, // Three.js bundle is intentionally large
    rollupOptions: {
      input,
      output: {
        // Function form (required by Rolldown-powered Vite)
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('three') || id.includes('postprocessing')) return 'three';
            if (id.includes('gsap') || id.includes('lenis')) return 'motion';
          }
        },
      },
    },
  },
});
