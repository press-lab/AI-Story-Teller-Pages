import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/live/**/*.live.ts"],
    testTimeout: 60000,
  },
});
