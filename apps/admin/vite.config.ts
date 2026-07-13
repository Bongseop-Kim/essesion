import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  if (mode === "production") {
    const env = loadEnv(mode, process.cwd(), "");
    if (!env.VITE_API_BASE_URL?.trim()) {
      throw new Error("VITE_API_BASE_URL is required for a production build");
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 3001,
      strictPort: true,
    },
  };
});
