import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend lives in web/; the production build goes to dist/client and is
// served by the Express server (single origin, single Render Web Service).
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/healthz": "http://localhost:3000",
    },
  },
});
