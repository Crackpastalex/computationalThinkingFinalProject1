import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En desarrollo: `npm run dev:server` (API en :3000) y `npm run dev` (Vite en :5173)
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:3000" } },
});
