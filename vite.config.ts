import { defineConfig } from "vitest/config";
import { defaultClientConditions } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The sky-segmentation runtime (onnxruntime-web) fetches its .wasm from a CDN at run time; without this condition
    // Vite would also copy an unused ~27 MB copy into dist.
    conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions],
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  test: {
    globals: true,
    environment: "node",
    // Some astronomy suites take several seconds and run alongside heavy image tests; 5 s is too tight under load.
    testTimeout: 30_000,
    root: path.resolve(import.meta.dirname),
    include: ["client/src/**/*.test.ts"],
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
});
