import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  envDir: "..",
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:8001",
      "/ws": {
        target: "ws://localhost:8001",
        ws: true
      }
    }
  }
});
