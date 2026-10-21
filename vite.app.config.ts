import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * The product application is a separate SPA that is served from the app
 * origin (app.dynamic.crty-dev.com) or from /app in local development.
 */
export default defineConfig({
  root: path.resolve(import.meta.dirname, "src/app"),
  base: "/app/",
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    // The API is proxied so the console talks to its own origin. Without the
    // proxy the session cookie would be dropped: the browser treats
    // localhost:5174 and 127.0.0.1:8787 as different sites and a SameSite=Lax
    // cookie is not sent along a cross site request.
    proxy: {
      "/api": {
        target: process.env.DYNAMIC_API_ORIGIN ?? "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/app"),
    emptyOutDir: false,
    sourcemap: true,
  },
});
