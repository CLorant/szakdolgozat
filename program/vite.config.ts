/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  // Loaded lazily (first text → path). Pre-bundling it up front stops the dev server from discovering it
  // mid-session and reloading the page.
  optimizeDeps: { include: ['fontkit'] },
  // Unit tests mount real Svelte components in jsdom, which needs Svelte's browser build.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
})
