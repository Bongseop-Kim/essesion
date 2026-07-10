import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // api의 frontend_origin·cors_origins(=localhost:3000)와 일치시켜야
  // OAuth 콜백 리다이렉트와 credentialed 요청(CORS)이 로컬에서 동작한다.
  server: { port: 3000, strictPort: true },
});
