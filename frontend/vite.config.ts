import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const apiTarget = process.env.API_INTERNAL_URL ?? "http://localhost:8080";
const mediaTarget = process.env.MEDIA_INTERNAL_URL ?? "http://localhost:8333";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: { tsconfigPaths: true },
  server: {
    proxy: {
      "/api": { target: apiTarget, changeOrigin: false },
      "/media": { target: mediaTarget, rewrite: (p) => p.replace(/^\/media/, "/goyacht-public") },
    },
  },
  build: { sourcemap: false },
});
