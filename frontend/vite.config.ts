import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Plugin to remove crossorigin attribute from built HTML
// This prevents browsers from upgrading requests to HTTPS
function removeCrossorigin(): Plugin {
  return {
    name: 'remove-crossorigin',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, '');
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), removeCrossorigin()],
  build: {
    modulePreload: {
      polyfill: false,
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5100',
        changeOrigin: true,
      },
    },
    headers: {
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Required for Vite dev server
        "style-src 'self' 'unsafe-inline'", // Required for Tailwind
        "img-src 'self' data: http: https:",
        "font-src 'self'",
        "connect-src 'self' http://localhost:5100 ws://localhost:5173", // Allow API and HMR
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  },
});
