import { sites } from "@openai/sites-vite-plugin";
import tailwindcss from "@tailwindcss/postcss";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const localBindingConfig = (localVars: Record<string, string>) => ({
  main: "./worker.ts",
  compatibility_flags: ["nodejs_compat"],
  vars: localVars,
  triggers: { crons: ["*/15 * * * *"] },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
});

export default defineConfig(async ({ command }) => {
  const localVars: Record<string, string> = {
    MAZMI_APP_MODE:
      process.env.MAZMI_APP_MODE ??
      (command === "serve" ? "DEMO" : "PRODUCTION"),
  };
  // Never serialize the bootstrap secret into a production build config.
  // Hosted production must inject it as a runtime Worker secret binding.
  if (command === "serve" && process.env.MAZMI_BOOTSTRAP_TOKEN)
    localVars.MAZMI_BOOTSTRAP_TOKEN = process.env.MAZMI_BOOTSTRAP_TOKEN;
  if (process.env.MAZMI_TEST_NOW)
    localVars.MAZMI_TEST_NOW = process.env.MAZMI_TEST_NOW;
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig(localVars),
        persistState: process.env.MAZMI_EPHEMERAL_STATE === "1" ? false : true,
      }),
    ],
  };
});
