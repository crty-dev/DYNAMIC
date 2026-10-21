import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    // The landing page reads the API (and the SDK reports to it). The proxy
    // keeps everything on one origin, so the local database is filled and the
    // session cookie stays first party.
    proxy: {
      "/api": {
        target: process.env.DYNAMIC_API_ORIGIN ?? "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
