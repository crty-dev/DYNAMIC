import { defineConfig } from "vite";
import path from "node:path";

/**
 * The DYNAMIC SDK is shipped as a standalone IIFE bundle so it can be dropped
 * into any site with a single <script> tag. web-vitals is bundled with it, so
 * there is no third-party request at runtime.
 */
export default defineConfig({
  build: {
    outDir: "public/js",
    emptyOutDir: false,
    target: "es2019",
    minify: "esbuild",
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(import.meta.dirname, "src/sdk/dynamic.ts"),
      name: "dynamicSdk",
      formats: ["iife"],
      fileName: () => "dynamic.js",
    },
  },
});
