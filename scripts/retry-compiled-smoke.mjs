// A ProxyWorker transport loss can interrupt a compiled local smoke request.
// Never replay that request: each retry starts the complete smoke on a fresh
// isolated D1/R2 state and port. Application responses are never retried.
import { spawn } from "node:child_process";

for (let attempt = 1; attempt <= 3; attempt++) {
  const child = spawn(
    process.execPath,
    ["scripts/independent-http.mjs", "--smoke-only"],
    {
      env: { ...process.env, MAZMI_HTTP_PORT: String(3040 + attempt) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      output += chunk;
      (stream === child.stdout ? process.stdout : process.stderr).write(chunk);
    });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code === 0) process.exit(0);
  if (!output.includes("WRANGLER_PROXY_TRANSPORT") || attempt === 3)
    process.exit(code || 1);
  console.error(
    `Discarded isolated smoke state after Wrangler transport loss; rerunning complete flow (${attempt + 1}/3).`,
  );
}
