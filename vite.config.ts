import { execSync } from "child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function getCommitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  plugins: [react()],
  base: "/AI-Story-Teller-Pages/",
  define: {
    __COMMIT_HASH__: JSON.stringify(getCommitHash()),
  },
});
