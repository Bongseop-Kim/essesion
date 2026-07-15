import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // jsdom 목록·폼 테스트가 CPU 수만큼 동시에 뜨면 5초 개별 제한을 소진한다.
    maxWorkers: 2,
  },
});
