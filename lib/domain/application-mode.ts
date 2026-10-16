export type ApplicationMode = "DEMO" | "PRODUCTION";

/** Fail closed: an absent or invalid binding never enables demo credentials. */
export function resolveApplicationMode(
  value: string | undefined,
): ApplicationMode {
  if (value === "DEMO") return "DEMO";
  if (value === undefined || value === "PRODUCTION") return "PRODUCTION";
  throw new Error("MAZMI_APP_MODE must be DEMO or PRODUCTION.");
}
