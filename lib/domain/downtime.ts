import { DomainInvariantError } from "./errors";

export function calculateDowntimeMinutes(
  startedAt: string,
  endedAt: string,
): number {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new DomainInvariantError(
      "INVALID_DOWNTIME_INTERVAL",
      "El fin del downtime no puede ser anterior al inicio.",
    );
  }
  return Math.max(0, Math.round((end - start) / 60_000));
}

export function assertDowntimeImpact(value: string): void {
  if (
    !["FULL_STOP", "REDUCED_SPEED", "MICROSTOP", "NO_IMPACT"].includes(value)
  ) {
    throw new DomainInvariantError(
      "INVALID_DOWNTIME_IMPACT",
      "El impacto productivo indicado no es válido.",
    );
  }
}
