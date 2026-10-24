import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Local managed worktrees contain other revisions of this app. Test only this checkout.
export default mergeConfig(viteConfig, defineConfig({
  test: { include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"] },
}));
