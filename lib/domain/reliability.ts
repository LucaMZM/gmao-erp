import { DomainInvariantError } from "./errors";

const MINUTE = 60_000;

export type ReliabilityObservation = {
  occurredAt: string;
  restoredAt: string | null;
  repairMinutes: number | null;
  downtimeMinutes: number;
};

export type ReliabilityMetrics = {
  failureCount: number;
  downtimeMinutes: number;
  averageDowntimeMinutes: number | null;
  mtbfMinutes: number | null;
  mttrMinutes: number | null;
  availability: number;
};

export type HealthInput = {
  criticality: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | string;
  status: string;
  commissionedAt: string | null;
  recentFailures: number;
  recurrentFailures: number;
  downtimeMinutes30: number;
  overdueWorkOrders: number;
  overduePreventive: number;
  openIncidents: number;
  criticalIncidents: number;
  criticalBacklog: number;
  recentCompletedMaintenance: number;
};

export type HealthBreakdownItem = {
  key: string;
  label: string;
  adjustment: number;
  explanation: string;
  tone: "positive" | "negative" | "neutral";
};

export type HealthResult = {
  score: number;
  breakdown: HealthBreakdownItem[];
};

export type FailurePattern = "GROWING" | "RECURRENT" | "STABLE" | "ISOLATED";

export type ParetoItem<T> = T & {
  value: number;
  share: number;
  cumulativeShare: number;
};

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function calculateReliabilityMetrics(input: {
  windowStart: string;
  windowEnd: string;
  observations: ReliabilityObservation[];
}): ReliabilityMetrics {
  const start = new Date(input.windowStart).getTime();
  const end = new Date(input.windowEnd).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new DomainInvariantError(
      "INVALID_RELIABILITY_WINDOW",
      "La ventana de fiabilidad debe tener inicio y fin válidos.",
    );
  }

  const observations = input.observations.filter((observation) => {
    const occurredAt = new Date(observation.occurredAt).getTime();
    return (
      Number.isFinite(occurredAt) && occurredAt >= start && occurredAt <= end
    );
  });
  const failureCount = observations.length;
  const downtimeMinutes = observations.reduce(
    (total, observation) =>
      total + finiteNonNegative(observation.downtimeMinutes),
    0,
  );
  const repairDurations = observations
    .map((observation) => observation.repairMinutes)
    .filter(
      (minutes): minutes is number =>
        minutes !== null && Number.isFinite(minutes) && minutes >= 0,
    );
  const exposureMinutes = (end - start) / MINUTE;
  const operatingMinutes = Math.max(0, exposureMinutes - downtimeMinutes);

  return {
    failureCount,
    downtimeMinutes,
    averageDowntimeMinutes:
      failureCount > 0 ? downtimeMinutes / failureCount : null,
    mtbfMinutes: failureCount >= 2 ? operatingMinutes / failureCount : null,
    mttrMinutes:
      repairDurations.length > 0
        ? repairDurations.reduce((total, value) => total + value, 0) /
          repairDurations.length
        : null,
    availability: clamp(
      ((exposureMinutes - downtimeMinutes) / exposureMinutes) * 100,
      0,
      100,
    ),
  };
}

export function classifyFailurePattern(input: {
  total90: number;
  recent30: number;
  previous30: number;
}): FailurePattern {
  const total = finiteNonNegative(input.total90);
  const recent = finiteNonNegative(input.recent30);
  const previous = finiteNonNegative(input.previous30);
  if (total <= 1) return "ISOLATED";
  if (recent >= 3 && recent >= Math.max(3, previous * 1.5)) return "GROWING";
  if (total >= 3 || recent >= 2) return "RECURRENT";
  return "STABLE";
}

export function calculateRepeatFailureRate(
  groupCounts: number[],
): number | null {
  const counts = groupCounts
    .map(finiteNonNegative)
    .filter((count) => count > 0);
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (!total) return null;
  const repeatedOccurrences = counts.reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );
  return (repeatedOccurrences / total) * 100;
}

export function calculateHealthScore(
  input: HealthInput,
  asOf: string,
): HealthResult {
  const breakdown: HealthBreakdownItem[] = [];
  const subtract = (
    key: string,
    label: string,
    adjustment: number,
    explanation: string,
  ) => {
    if (adjustment <= 0) return;
    breakdown.push({
      key,
      label,
      adjustment: -adjustment,
      explanation,
      tone: "negative",
    });
  };
  const add = (
    key: string,
    label: string,
    adjustment: number,
    explanation: string,
  ) => {
    if (adjustment <= 0) return;
    breakdown.push({
      key,
      label,
      adjustment,
      explanation,
      tone: "positive",
    });
  };

  subtract(
    "criticality",
    "Exposición por criticidad",
    input.criticality === "CRITICAL" ? 4 : input.criticality === "HIGH" ? 2 : 0,
    input.criticality === "CRITICAL"
      ? "Activo crítico: el mismo deterioro tiene mayor impacto operativo."
      : "Activo de criticidad alta.",
  );
  subtract(
    "condition",
    "Condición operativa",
    input.status === "DOWN"
      ? 18
      : input.status === "DEGRADED"
        ? 10
        : input.status === "MAINTENANCE"
          ? 4
          : 0,
    `Estado actual: ${input.status.toLowerCase()}.`,
  );
  subtract(
    "failures",
    "Fallos recientes",
    Math.min(12, finiteNonNegative(input.recentFailures) * 3),
    `${input.recentFailures} correctivos en los últimos 90 días.`,
  );
  subtract(
    "recurrence",
    "Fallos recurrentes",
    Math.min(12, finiteNonNegative(input.recurrentFailures) * 4),
    `${input.recurrentFailures} repeticiones más allá de la primera ocurrencia.`,
  );
  subtract(
    "downtime",
    "Downtime · 30 días",
    Math.min(
      15,
      Math.ceil(finiteNonNegative(input.downtimeMinutes30) / 120) * 3,
    ),
    `${Math.round(input.downtimeMinutes30)} minutos de impacto registrados.`,
  );
  subtract(
    "overdue-work",
    "Trabajo vencido",
    Math.min(9, finiteNonNegative(input.overdueWorkOrders) * 3),
    `${input.overdueWorkOrders} órdenes abiertas fuera de compromiso.`,
  );
  subtract(
    "overdue-pm",
    "Preventivo vencido",
    Math.min(8, finiteNonNegative(input.overduePreventive) * 4),
    `${input.overduePreventive} ventanas preventivas requieren atención.`,
  );
  subtract(
    "incidents",
    "Incidencias abiertas",
    Math.min(
      14,
      finiteNonNegative(input.criticalIncidents) * 7 +
        finiteNonNegative(input.openIncidents - input.criticalIncidents) * 2,
    ),
    `${input.openIncidents} incidencias abiertas; ${input.criticalIncidents} críticas.`,
  );
  subtract(
    "critical-backlog",
    "Backlog crítico",
    Math.min(10, finiteNonNegative(input.criticalBacklog) * 5),
    `${input.criticalBacklog} órdenes P1/P2 todavía abiertas.`,
  );

  if (input.commissionedAt) {
    const ageYears =
      (new Date(asOf).getTime() - new Date(input.commissionedAt).getTime()) /
      (365.25 * 24 * 60 * MINUTE);
    subtract(
      "age",
      "Edad del activo",
      ageYears >= 10 ? 4 : ageYears >= 6 ? 2 : 0,
      `${Math.max(0, Math.floor(ageYears))} años desde puesta en servicio.`,
    );
  }

  add(
    "recent-maintenance",
    "Mantenimiento reciente",
    Math.min(5, finiteNonNegative(input.recentCompletedMaintenance) * 2),
    `${input.recentCompletedMaintenance} intervenciones completadas en 30 días.`,
  );

  const score = clamp(
    Math.round(
      100 + breakdown.reduce((total, item) => total + item.adjustment, 0),
    ),
    0,
    100,
  );
  if (!breakdown.length) {
    breakdown.push({
      key: "stable",
      label: "Sin penalizaciones activas",
      adjustment: 0,
      explanation:
        "No hay señales suficientes de deterioro en la ventana analizada.",
      tone: "neutral",
    });
  }
  return { score, breakdown };
}

export function buildPareto<T extends { value: number }>(
  items: T[],
): Array<ParetoItem<Omit<T, "value">>> {
  const ordered = [...items]
    .map((item) => ({ ...item, value: finiteNonNegative(item.value) }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value);
  const total = ordered.reduce((sum, item) => sum + item.value, 0);
  let cumulative = 0;
  return ordered.map((item) => {
    cumulative += item.value;
    return {
      ...item,
      share: total ? (item.value / total) * 100 : 0,
      cumulativeShare: total ? (cumulative / total) * 100 : 0,
    };
  });
}

export type TrendDirection =
  "INCREASING" | "DECREASING" | "STABLE" | "INSUFFICIENT";

export function calculateTrend(input: {
  current: number;
  previous: number;
  currentSamples: number;
  previousSamples: number;
  lowerIsBetter?: boolean;
}): { direction: TrendDirection; changePercent: number | null } {
  if (input.currentSamples < 1 || input.previousSamples < 1) {
    return { direction: "INSUFFICIENT", changePercent: null };
  }
  const current = finiteNonNegative(input.current);
  const previous = finiteNonNegative(input.previous);
  if (previous === 0) {
    return current === 0
      ? { direction: "STABLE", changePercent: 0 }
      : { direction: "INCREASING", changePercent: null };
  }
  const changePercent = ((current - previous) / previous) * 100;
  if (Math.abs(changePercent) < 10) {
    return { direction: "STABLE", changePercent };
  }
  const rawDirection = changePercent > 0 ? "INCREASING" : "DECREASING";
  return { direction: rawDirection, changePercent };
}

export function assertValidRcaStatusTransition(
  from: string,
  to: string,
  openActions: number,
  rootCause: string | null,
): void {
  const transitions: Record<string, string[]> = {
    DRAFT: ["INVESTIGATING", "CANCELLED"],
    INVESTIGATING: ["ACTIONS_DEFINED", "CANCELLED"],
    ACTIONS_DEFINED: ["VERIFICATION", "INVESTIGATING", "CANCELLED"],
    VERIFICATION: ["CLOSED", "ACTIONS_DEFINED"],
    CLOSED: [],
    CANCELLED: [],
  };
  if (!transitions[from]?.includes(to)) {
    throw new DomainInvariantError(
      "INVALID_RCA_TRANSITION",
      `La RCA no puede pasar de ${from} a ${to}.`,
    );
  }
  if (to === "CLOSED" && (!rootCause?.trim() || openActions > 0)) {
    throw new DomainInvariantError(
      "RCA_CLOSURE_INCOMPLETE",
      "Para cerrar la RCA debe existir causa raíz y no quedar acciones abiertas.",
    );
  }
}
