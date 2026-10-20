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
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/app"),
    emptyOutDir: false,
    sourcemap: true,
  },
});
