import { defineConfig } from "@hey-api/openapi-ts";

// 전부 생성물 — 손 편집 금지. 재생성: pnpm codegen (레포 루트)
export default defineConfig({
  input: "./openapi.json",
  output: "./src",
  plugins: ["@hey-api/client-fetch", "@tanstack/react-query", "zod"],
});
