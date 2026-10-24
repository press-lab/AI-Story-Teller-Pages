import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Set AIST_MEMORY_CONFIG (private provider JSON), AIST_MEMORY_API_KEY; required AIST_MEMORY_SAVE and AIST_MEMORY_CASES (local-only export and case JSON); optional AIST_MEMORY_REPORT_DIR. Run npm run eval:memory -- --case case-id, or omit --case for the full local manifest. This command spends API credits.");
  process.exit(0);
}
const index = args.indexOf("--case");
if (args.length && (index !== 0 || args.length !== 2)) throw new Error("Usage: npm run eval:memory -- [--case case-id]");
const cli = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const child = spawn(process.execPath, [cli, "run", "--config", "vitest.memory-live.config.ts"], { stdio: "inherit", env: { ...process.env, AIST_LIVE_MEMORY: "1", ...(index >= 0 ? { AIST_MEMORY_CASE: args[index + 1] } : {}) } });
child.on("exit", code => process.exit(code ?? 1));
