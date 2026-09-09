import { DomainInvariantError } from "./errors";

const EXECUTABLE_STATES = [
  "ASSIGNED",
  "IN_PROGRESS",
  "PAUSED",
  "WAITING_PART",
  "WAITING_VENDOR",
];

export function assertCanStartLabor(input: {
  workOrderStatus: string;
  isAssigned: boolean;
  hasActiveSession: boolean;
}): void {
  if (!EXECUTABLE_STATES.includes(input.workOrderStatus)) {
    throw new DomainInvariantError(
      "WORK_ORDER_NOT_EXECUTABLE",
      "El estado actual de la orden no permite iniciar trabajo.",
    );
  }
  if (!input.isAssigned) {
    throw new DomainInvariantError(
      "TECHNICIAN_NOT_ASSIGNED",
      "El técnico debe estar asignado a la orden para iniciar trabajo.",
    );
  }
  if (input.hasActiveSession) {
    throw new DomainInvariantError(
      "ACTIVE_LABOR_SESSION_EXISTS",
      "El técnico ya tiene una sesión de trabajo activa.",
    );
  }
}

export function calculateLaborMinutes(
  startedAt: string,
  endedAt: string,
): number {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new DomainInvariantError(
      "INVALID_LABOR_INTERVAL",
      "El fin de una sesión no puede ser anterior al inicio.",
    );
  }
  return Math.max(0, Math.round((end - start) / 60_000));
}
