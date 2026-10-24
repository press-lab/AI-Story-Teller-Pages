import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/live/memorySemantic.live.ts"], fileParallelism: false, testTimeout: 1_800_000 } });
