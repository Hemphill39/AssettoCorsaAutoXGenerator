import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  base: "./",
  plugins: [
    react(),
    electron({
      main: {
        entry: resolve(__dirname, "src/main/main.ts"),
        vite: {
          build: {
            outDir: resolve(__dirname, "dist/main"),
            rollupOptions: { external: ["electron"] },
          },
        },
      },
      preload: {
        input: resolve(__dirname, "src/preload/preload.ts"),
        vite: {
          build: {
            outDir: resolve(__dirname, "dist/preload"),
            rollupOptions: {
              external: ["electron"],
              // CommonJS: preload scripts cannot be ES modules when sandboxed.
              output: { format: "cjs", entryFileNames: "preload.cjs" },
            },
          },
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@xcross/core": resolve(__dirname, "../../packages/core/src/index.ts"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
});
