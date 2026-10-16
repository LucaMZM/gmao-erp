// Run only on a disposable remote runner. Captures fictional DEMO records.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

const state = mkdtempSync(join(tmpdir(), "gmao-portfolio-"));
const output = process.env.GMAO_SCREENSHOT_DIR ?? "docs/screenshots";
const base = "http://127.0.0.1:3051";
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
    "3051",
    "--inspector-port",
    "9251",
    "--local",
    "--persist-to",
    state,
    "--show-interactive-dev-session=false",
    "--var",
    "MAZMI_APP_MODE:DEMO",
    "--var",
    "MAZMI_TEST_NOW:2026-09-08T12:00:00.000Z",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
for (const stream of [worker.stdout, worker.stderr])
  stream.on("data", (chunk) => {
    logs += chunk;
  });

let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    if (worker.exitCode !== null)
      throw new Error(`Worker exited: ${logs.slice(-2000)}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for isolated Worker. */
    }
    await delay(500);
  }
  assert(ready, `Worker did not become ready: ${logs.slice(-2000)}`);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    reducedMotion: "reduce",
  });
  const response = await context.request.post(`${base}/api/auth/login`, {
    data: { email: "responsable@mazmi.demo", password: "Mazmi2026!" },
  });
  assert.equal(response.status(), 200, "Demo login failed");
  const page = await context.newPage();
  mkdirSync(output, { recursive: true });
  const shots = [
    ["01-dashboard.png", "/overview", "Centro de control"],
    ["02-assets.png", "/assets", "Activos"],
    ["03-work-orders.png", "/work-orders", "Órdenes de trabajo"],
    [
      "04-preventive-maintenance.png",
      "/maintenance-plans",
      "Planes de mantenimiento",
    ],
    ["05-inventory.png", "/inventory", "Inventario y recambios"],
    ["07-analytics.png", "/reliability", "Reliability Center"],
    ["08-admin.png", "/governance", "Gobierno operativo"],
  ];
  let detailRoute;
  for (const [file, route, heading] of shots) {
    const navigation = await page.goto(`${base}${route}`, {
      waitUntil: "domcontentloaded",
    });
    assert(navigation?.ok(), `${route} returned ${navigation?.status()}`);
    await page
      .getByRole("heading", { name: heading, exact: true })
      .first()
      .waitFor();
    await page.locator("main#main-content").waitFor();
    await page.waitForTimeout(350);
    if (route === "/work-orders")
      detailRoute = await page
        .locator('a[href^="/work-orders/"]')
        .first()
        .getAttribute("href");
    await page.screenshot({ path: join(output, file), animations: "disabled" });
    console.log(`CAPTURED ${file} ${route}`);
  }
  assert(detailRoute, "No work-order detail link in demo data");
  const detailResponse = await page.goto(`${base}${detailRoute}`, {
    waitUntil: "domcontentloaded",
  });
  assert(detailResponse?.ok(), `Detail returned ${detailResponse?.status()}`);
  await page.locator("main#main-content").waitFor();
  await page.waitForTimeout(350);
  await page.screenshot({
    path: join(output, "06-detail.png"),
    animations: "disabled",
  });
  console.log(`CAPTURED 06-detail.png ${detailRoute}`);
} finally {
  await browser?.close();
  worker.kill("SIGTERM");
  await new Promise((resolve) => {
    if (worker.exitCode !== null) return resolve();
    worker.once("exit", resolve);
    setTimeout(resolve, 5000).unref();
  });
}
