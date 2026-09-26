import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.MAZMI_VISUAL_BASE_URL ?? "http://127.0.0.1:3020";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: "line",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      // Hiding the caret mutates form-control styles before Vinext finishes
      // hydrating streamed routes, producing false React mismatch errors.
      caret: "initial",
      maxDiffPixelRatio: 0.012,
    },
  },
  use: {
    baseURL,
    colorScheme: "dark",
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    reducedMotion: "reduce",
  },
  webServer: process.env.MAZMI_VISUAL_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --hostname 127.0.0.1 --port 3020",
        env: {
          MAZMI_EPHEMERAL_STATE: "1",
          MAZMI_TEST_NOW: "2026-09-08T12:00:00.000Z",
        },
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
