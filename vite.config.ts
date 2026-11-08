import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages serves project sites under /<repo>/. CI passes BASE_PATH so the
// deployed bundle is correct without hardcoding a repository name.
const base = process.env.BASE_PATH || '/';
const buildId = (process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : 'studio') + '-' + Date.now().toString(36);

export default defineConfig({
  base,
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
  server: {
    port: 5199,
    host: true,
    allowedHosts: true,
    cors: true,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
    cors: true,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  },
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/mediabunny')) return 'mediabunny';
          if (id.includes('node_modules/react')) return 'react';
          // Transcription and ffmpeg fallbacks are lazily imported by the app.
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globals: true,
    restoreMocks: true,
  },
});
