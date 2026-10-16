// Run the compiled Worker over real HTTP without Wrangler's development
// ProxyWorker. The compiled bundle and D1/R2 runtime remain unchanged.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const root = resolve("dist/server");
const port = Number(process.env.MAZMI_SMOKE_PORT ?? 3041);
const collectModules = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectModules(path);
    return entry.name.endsWith(".js") ? [{ type: "ESModule", path }] : [];
  });
const entrypoint = join(root, "index.js");
const modules = [
  { type: "ESModule", path: entrypoint },
  ...collectModules(root).filter((module) => module.path !== entrypoint),
];

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules,
    modulesRoot: root,
    compatibilityDate: "2026-09-10",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { MAZMI_APP_MODE: "DEMO" },
    d1Databases: ["DB"],
    r2Buckets: ["FILES"],
    host: "127.0.0.1",
    port,
  }),
);

try {
  await runtime.ready;
  const smoke = spawn(process.execPath, ["scripts/smoke.mjs"], {
    env: {
      ...process.env,
      MAZMI_BASE_URL: `http://127.0.0.1:${port}`,
    },
    stdio: "inherit",
  });
  const code = await new Promise((resolveExit, reject) => {
    smoke.once("error", reject);
    smoke.once("close", resolveExit);
  });
  if (code !== 0) process.exitCode = code || 1;
} finally {
  await runtime.dispose();
}
