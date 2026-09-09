import { DomainInvariantError } from "./errors";

export const workOrderStatuses = [
  "REQUESTED",
  "TRIAGE",
  "APPROVED",
  "PLANNED",
  "SCHEDULED",
  "ASSIGNED",
  "IN_PROGRESS",
  "PAUSED",
  "WAITING_PART",
  "WAITING_VENDOR",
  "COMPLETED",
  "CLOSED",
  "CANCELLED",
] as const;

export type WorkOrderStatus = (typeof workOrderStatuses)[number];

export const allowedWorkOrderTransitions: Record<
  WorkOrderStatus,
  readonly WorkOrderStatus[]
> = {
  REQUESTED: ["TRIAGE", "CANCELLED"],
  TRIAGE: ["APPROVED", "CANCELLED"],
  APPROVED: ["PLANNED", "SCHEDULED", "ASSIGNED", "CANCELLED"],
  PLANNED: ["SCHEDULED", "ASSIGNED", "CANCELLED"],
  SCHEDULED: ["PLANNED", "ASSIGNED", "IN_PROGRESS", "CANCELLED"],
  ASSIGNED: ["PLANNED", "SCHEDULED", "IN_PROGRESS", "PAUSED", "CANCELLED"],
  IN_PROGRESS: ["PAUSED", "WAITING_PART", "WAITING_VENDOR", "COMPLETED"],
  PAUSED: ["IN_PROGRESS", "WAITING_PART", "WAITING_VENDOR", "CANCELLED"],
  WAITING_PART: ["IN_PROGRESS", "CANCELLED"],
  WAITING_VENDOR: ["IN_PROGRESS", "CANCELLED"],
  COMPLETED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
  CANCELLED: [],
};

export function assertWorkOrderTransition(
  from: WorkOrderStatus,
  to: WorkOrderStatus,
): void {
  if (!allowedWorkOrderTransitions[from].includes(to)) {
    throw new DomainInvariantError(
      "INVALID_WORK_ORDER_TRANSITION",
      `La transición ${from} → ${to} no está permitida.`,
    );
  }
}

export function assertCanCompleteWorkOrder(input: {
  type: string;
  diagnosis: string | null;
  solution: string | null;
  openLaborSessions: number;
  openDowntimeEvents: number;
  requiredChecklistPending?: number;
}): void {
  if (input.openLaborSessions > 0) {
    throw new DomainInvariantError(
      "ACTIVE_LABOR_SESSION",
      "Finaliza las sesiones de trabajo antes de completar la orden.",
    );
  }
  if (input.openDowntimeEvents > 0) {
    throw new DomainInvariantError(
      "ACTIVE_DOWNTIME",
      "Cierra el downtime activo antes de completar la orden.",
    );
  }
  if ((input.requiredChecklistPending ?? 0) > 0) {
    throw new DomainInvariantError(
      "REQUIRED_CHECKLIST_PENDING",
      "Completa los pasos obligatorios del checklist antes de finalizar.",
    );
  }
  if (!input.solution?.trim()) {
    throw new DomainInvariantError(
      "MISSING_RESOLUTION",
      "Documenta la resolución antes de completar la orden.",
    );
  }
  if (input.type === "CORRECTIVE" && !input.diagnosis?.trim()) {
    throw new DomainInvariantError(
      "MISSING_DIAGNOSIS",
      "Un correctivo requiere diagnóstico antes de completarse.",
    );
  }
}

export function assertCanCloseWorkOrder(input: {
  openLaborSessions: number;
  actualEnd: string | null;
  solution: string | null;
}): void {
  if (input.openLaborSessions > 0) {
    throw new DomainInvariantError(
      "ACTIVE_LABOR_SESSION",
      "Una orden con sesiones de trabajo activas no puede cerrarse.",
    );
  }
  if (!input.actualEnd || !input.solution?.trim()) {
    throw new DomainInvariantError(
      "INCOMPLETE_CLOSURE",
      "El cierre requiere fecha real de fin y solución documentada.",
    );
  }
}

export function assertAssetAcceptsPlannedWork(assetStatus: string): void {
  if (assetStatus === "RETIRED") {
    throw new DomainInvariantError(
      "RETIRED_ASSET",
      "Un activo retirado no puede recibir nuevas órdenes planificadas.",
    );
  }
}
