import { DomainInvariantError } from "./errors";

export const incidentStatuses = [
  "NEW",
  "IN_TRIAGE",
  "ACCEPTED",
  "REJECTED",
  "CONVERTED",
  "CLOSED",
] as const;

export type IncidentStatus = (typeof incidentStatuses)[number];

const transitions: Record<IncidentStatus, readonly IncidentStatus[]> = {
  NEW: ["IN_TRIAGE", "CLOSED"],
  IN_TRIAGE: ["ACCEPTED", "REJECTED", "CLOSED"],
  ACCEPTED: ["IN_TRIAGE", "CONVERTED", "CLOSED"],
  REJECTED: ["IN_TRIAGE", "CLOSED"],
  CONVERTED: ["CLOSED"],
  CLOSED: [],
};

export function assertIncidentTransition(
  from: IncidentStatus,
  to: IncidentStatus,
): void {
  if (!transitions[from].includes(to)) {
    throw new DomainInvariantError(
      "INVALID_INCIDENT_TRANSITION",
      `La transición de incidencia ${from} → ${to} no está permitida.`,
    );
  }
}

export function assertIncidentCanConvert(input: {
  status: IncidentStatus;
  assetId: string | null;
  priority: string | null;
  classification: string | null;
}): void {
  if (input.status !== "ACCEPTED") {
    throw new DomainInvariantError(
      "INCIDENT_NOT_ACCEPTED",
      "La incidencia debe estar aceptada antes de convertirla en OT.",
    );
  }
  if (!input.assetId || !input.priority || !input.classification) {
    throw new DomainInvariantError(
      "INCOMPLETE_TRIAGE",
      "La conversión requiere activo, prioridad y clasificación.",
    );
  }
}
