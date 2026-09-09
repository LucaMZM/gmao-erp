export type OperationOutcome = "SUCCESS" | "DENIED" | "FAILURE";

export function structuredOperationLog(input: {
  requestId: string;
  operation: string;
  outcome: OperationOutcome;
  actorId?: string | null;
  organizationId?: string | null;
  siteId?: string | null;
  errorClassification?: string | null;
  durationMs?: number | null;
}) {
  const record = {
    timestamp: new Date().toISOString(),
    service: "mazmi-factory-gmao",
    ...input,
  };
  const serialized = JSON.stringify(record);
  if (input.outcome === "FAILURE") console.error(serialized);
  else if (input.outcome === "DENIED") console.warn(serialized);
  else console.info(serialized);
}
