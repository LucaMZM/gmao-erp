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
      caret: "hide",
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
        command: "npm run dev -- --port 3020",
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
