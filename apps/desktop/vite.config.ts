import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/ — tailored for Tauri development.
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // Expose the Tauri CLI's build-time TAURI_ENV_* vars (e.g. the target platform).
  envPrefix: ['VITE_', 'TAURI_ENV_*'],

  // 1. prevent Vite from obscuring Rust errors
  clearScreen: false,
  server: {
    // 2. Tauri expects a fixed port; fail if it is not available
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    // 3. tell Vite to ignore watching `src-tauri`
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
