import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-ignore — vitest types are in devDependencies only
/// <reference types="vitest" />

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // ── Vitest ──────────────────────────────────────────────────────────────────
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/utils/**', 'src/hooks/**', 'src/services/api.ts'],
      reporter: ['text', 'html'],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          tauri: ["@tauri-apps/api", "@tauri-apps/plugin-dialog", "@tauri-apps/plugin-opener"],
          xterm: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-web-links", "@xterm/addon-webgl"],
          ui: ["framer-motion", "lucide-react"],
          state: ["zustand"],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || '127.0.0.1',
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
