import { defineConfig } from "vite";
export default defineConfig({
  root: "public",
  base: "./",
  publicDir: false,
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 5174,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8091" },
  },
});
