import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const state = mkdtempSync(join(tmpdir(), "mazmi-production-smoke-"));
const base = "http://127.0.0.1:3042";
const token = "isolated-compiled-bootstrap-token-0123456789";
const worker = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--config",
    "dist/server/wrangler.json",
    "--ip",
    "127.0.0.1",
    "--port",
    "3042",
    "--inspector-port",
    "9242",
    "--local",
    "--persist-to",
    state,
    "--show-interactive-dev-session=false",
    "--var",
    "MAZMI_APP_MODE:PRODUCTION",
    "--var",
    `MAZMI_BOOTSTRAP_TOKEN:${token}`,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
worker.stdout.on("data", (chunk) => (logs += chunk));
worker.stderr.on("data", (chunk) => (logs += chunk));
const post = (path, body, headers = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
try {
  let health;
  for (let attempt = 0; attempt < 180; attempt++) {
    if (worker.exitCode !== null)
      throw new Error(`Worker exited ${worker.exitCode}`);
    try {
      const response = await fetch(base + "/api/health");
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      /* Local worker is starting. */
    }
    await delay(500);
  }
  assert(health, "Worker did not initialize in PRODUCTION mode");
  assert.equal(health.schemaVersion, "0013_preventive_scheduler");
  assert.equal(health.assets, 0);
  assert.equal(health.workOrders, 0);
  assert.equal(health.parts, 0);
  const first = await (await fetch(base + "/")).text();
  assert.match(first, /Aprovisiona el entorno inicial de tu organización/);
  assert.doesNotMatch(first, /Mazmi FlexPack Industries/);
  assert.equal(
    (
      await post("/api/auth/login", {
        email: "responsable@mazmi.demo",
        password: "Mazmi2026!",
      })
    ).status,
    401,
  );
  const setup = {
    organizationCode: "PILOT-HTTP",
    organizationName: "Envases del Turia, S.L.",
    siteCode: "ES-TUR",
    siteName: "Planta Turia",
    siteShortName: "Turia",
    city: "Valencia",
    adminEmail: "admin@turia.example",
    adminName: "María Sanz",
    adminPassword: "PilotPassword2026!Long",
  };
  assert.equal(
    (await post("/api/setup", setup, { authorization: "Bearer wrong" })).status,
    403,
  );
  assert.equal(
    (await post("/api/setup", setup, { authorization: `Bearer ${token}` }))
      .status,
    201,
  );
  const login = await post("/api/auth/login", {
    email: setup.adminEmail,
    password: setup.adminPassword,
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert(cookie);
  const overview = await fetch(base + "/overview", { headers: { cookie } });
  assert.equal(overview.status, 200);
  const body = await overview.text();
  assert(
    /Centro de control/i.test(body),
    `Overview missing content; streamedError=${/:E\{"digest":/.test(body)}; tail=${body.slice(-500)}`,
  );
  assert.doesNotMatch(body, /Mazmi FlexPack Industries/);
  const logout = await post("/api/auth/logout", {}, { cookie });
  assert.equal(logout.status, 200);
  const later = await fetch(base + "/overview", {
    headers: { cookie },
    redirect: "manual",
  });
  assert([301, 302, 303, 307, 308].includes(later.status));
  console.log(
    "PRODUCTION_SMOKE_PASS: clean D1, setup, login, Overview, logout, no demo seed",
  );
} catch (error) {
  console.error(error);
  console.error(logs.replaceAll(token, "[REDACTED]").slice(-2000));
  process.exitCode = 1;
} finally {
  worker.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => worker.once("exit", resolve)),
    delay(3000),
  ]);
  rmSync(state, { recursive: true, force: true });
}
