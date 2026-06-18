import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';

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
  plugins: [
    react(),
    removeCrossorigin(),
    visualizer({
      filename: 'stats.html',
      open: false,
      gzipSize: true,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    modulePreload: {
      polyfill: false,
    },
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5100',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      '/health': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5100',
        changeOrigin: true,
      },
      '/metrics': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5100',
        changeOrigin: true,
      },
    },
    headers: {
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Required for Vite dev server
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // Required for Tailwind + Google Fonts
        "img-src 'self' data: http: https:",
        "font-src 'self' https://fonts.gstatic.com", // Required for Google Fonts
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
