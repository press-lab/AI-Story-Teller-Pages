import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.on("error", reject);
  server.listen(0, host, () => {
    const address = server.address();
    server.close(() => {
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("Could not reserve a production smoke port."));
    });
  });
});
const baseUrl = `http://${host}:${port}`;
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const child = spawn(process.execPath, [viteBin, "preview", "--host", host, "--port", String(port), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, attempts = 40) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw lastError ?? new Error(`${url} did not respond`);
}

try {
  const indexResponse = await fetchWithRetry(baseUrl);
  const html = await indexResponse.text();
  if (!/id=["']root["']/.test(html)) {
    throw new Error("Production index did not contain the React root.");
  }
  const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
  if (assetPaths.length === 0) {
    throw new Error("Production index did not reference any JS/CSS assets.");
  }
  for (const assetPath of assetPaths) {
    const url = new URL(assetPath, baseUrl).toString();
    const assetResponse = await fetchWithRetry(url, 5);
    const text = await assetResponse.text();
    if (!text.trim()) throw new Error(`Production asset was empty: ${assetPath}`);
  }
  console.log(`Production smoke passed: ${assetPaths.length} asset(s) loaded from ${baseUrl}.`);
} finally {
  child.kill();
  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 500).unref();
}

child.on("exit", (code) => {
  if (code && code !== 0 && output.trim()) {
    console.error(output.trim());
  }
});
