import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Tauri dev server — use a fixed port so tauri.conf.json can reference it reliably
  server: {
    port: 5173,
    strictPort: true,
  },

  // Tauri expects a relative base path for the bundled assets
  base: './',

  build: {
    // Tauri uses Chromium on macOS/Windows — ES2021 is safe
    target: 'es2021',
    // Tauri handles its own minification; keep source maps for easier debugging
    sourcemap: true,
  },
})
