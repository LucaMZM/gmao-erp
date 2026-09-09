import { DomainInvariantError } from "./errors";

export const preventiveTriggerModes = [
  "CALENDAR",
  "METER",
  "WHICHEVER_FIRST",
] as const;
export type PreventiveTriggerMode = (typeof preventiveTriggerModes)[number];

export const calendarUnits = ["DAY", "WEEK", "MONTH"] as const;
export type CalendarUnit = (typeof calendarUnits)[number];

export function addCalendarInterval(
  isoDate: string,
  interval: number,
  unit: CalendarUnit,
): string {
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new DomainInvariantError(
      "INVALID_PREVENTIVE_INTERVAL",
      "La frecuencia preventiva debe ser un entero mayor que cero.",
    );
  }
  const source = new Date(isoDate);
  if (!Number.isFinite(source.getTime())) {
    throw new DomainInvariantError(
      "INVALID_PREVENTIVE_DATE",
      "La fecha base del plan preventivo no es válida.",
    );
  }
  if (unit === "DAY") source.setUTCDate(source.getUTCDate() + interval);
  if (unit === "WEEK") source.setUTCDate(source.getUTCDate() + interval * 7);
  if (unit === "MONTH") {
    const originalDay = source.getUTCDate();
    source.setUTCDate(1);
    source.setUTCMonth(source.getUTCMonth() + interval);
    const lastDay = new Date(
      Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0),
    ).getUTCDate();
    source.setUTCDate(Math.min(originalDay, lastDay));
  }
  return source.toISOString();
}

export function nextCalendarExecution(input: {
  baseAt: string;
  interval: number;
  unit: CalendarUnit;
  after?: string;
}): string {
  const after = input.after ? new Date(input.after).getTime() : null;
  if (after !== null && !Number.isFinite(after)) {
    throw new DomainInvariantError(
      "INVALID_PREVENTIVE_DATE",
      "La fecha de referencia del plan preventivo no es válida.",
    );
  }
  let next = addCalendarInterval(input.baseAt, input.interval, input.unit);
  let guard = 0;
  while (after !== null && new Date(next).getTime() <= after) {
    next = addCalendarInterval(next, input.interval, input.unit);
    guard += 1;
    if (guard > 10_000) {
      throw new DomainInvariantError(
        "PREVENTIVE_SCHEDULE_OVERFLOW",
        "No se ha podido resolver la próxima ejecución del plan.",
      );
    }
  }
  return next;
}

export function assertValidMeterReading(input: {
  readingAt: string;
  value: number;
  previousValue: number | null;
  previousReadingAt: string | null;
  cumulative: boolean;
}): void {
  const readingTime = new Date(input.readingAt).getTime();
  if (!Number.isFinite(readingTime) || !Number.isFinite(input.value)) {
    throw new DomainInvariantError(
      "INVALID_METER_READING",
      "La lectura y su fecha deben ser valores válidos.",
    );
  }
  if (input.value < 0) {
    throw new DomainInvariantError(
      "NEGATIVE_METER_READING",
      "Una lectura de contador no puede ser negativa.",
    );
  }
  if (
    input.previousReadingAt &&
    readingTime < new Date(input.previousReadingAt).getTime()
  ) {
    throw new DomainInvariantError(
      "METER_READING_OUT_OF_ORDER",
      "La lectura no puede ser anterior a la última registrada.",
    );
  }
  if (
    input.cumulative &&
    input.previousValue !== null &&
    input.value < input.previousValue
  ) {
    throw new DomainInvariantError(
      "CUMULATIVE_METER_DECREASE",
      "Un contador acumulativo no puede disminuir sin un reset explícito.",
    );
  }
}

export function evaluatePreventiveTrigger(input: {
  mode: PreventiveTriggerMode;
  now: string;
  calendarDueAt: string | null;
  meterValue: number | null;
  meterThreshold: number | null;
}): { due: boolean; reasons: Array<"CALENDAR" | "METER"> } {
  const now = new Date(input.now).getTime();
  if (!Number.isFinite(now)) {
    throw new DomainInvariantError(
      "INVALID_PREVENTIVE_DATE",
      "La fecha de evaluación preventiva no es válida.",
    );
  }
  const calendarDue =
    input.calendarDueAt !== null &&
    new Date(input.calendarDueAt).getTime() <= now;
  const meterDue =
    input.meterValue !== null &&
    input.meterThreshold !== null &&
    input.meterValue >= input.meterThreshold;
  const reasons: Array<"CALENDAR" | "METER"> = [];
  if (calendarDue && input.mode !== "METER") reasons.push("CALENDAR");
  if (meterDue && input.mode !== "CALENDAR") reasons.push("METER");
  return { due: reasons.length > 0, reasons };
}

export function preventiveWindowKey(input: {
  mode: PreventiveTriggerMode;
  calendarDueAt: string | null;
  meterThreshold: number | null;
  triggerReasons?: Array<"CALENDAR" | "METER">;
}): string {
  const reasons = input.triggerReasons ?? [];
  if (
    input.mode !== "CALENDAR" &&
    input.meterThreshold !== null &&
    (reasons.includes("METER") || !input.calendarDueAt)
  ) {
    return `METER:${input.meterThreshold}`;
  }
  if (input.calendarDueAt) {
    return `CALENDAR:${input.calendarDueAt.slice(0, 10)}`;
  }
  throw new DomainInvariantError(
    "PREVENTIVE_WINDOW_UNAVAILABLE",
    "El plan no tiene una ventana preventiva generable.",
  );
}

export function advancePreventiveTrigger(input: {
  mode: PreventiveTriggerMode;
  now: string;
  reasons: Array<"CALENDAR" | "METER">;
  calendarNextAt: string | null;
  calendarInterval: number | null;
  calendarUnit: CalendarUnit | null;
  meterValue: number | null;
  meterThreshold: number | null;
  meterInterval: number | null;
}): {
  occurrenceDueAt: string;
  calendarNextAt: string | null;
  meterThreshold: number | null;
  nextDueAt: string | null;
} {
  if (!input.reasons.length) {
    throw new DomainInvariantError(
      "PREVENTIVE_TRIGGER_NOT_DUE",
      "No se puede avanzar un disparador que no ha vencido.",
    );
  }
  const meterOnly =
    input.reasons.includes("METER") && !input.reasons.includes("CALENDAR");
  const occurrenceDueAt = meterOnly
    ? input.now
    : (input.calendarNextAt ?? input.now);
  let calendarNextAt = input.calendarNextAt;
  if (input.mode !== "METER") {
    if (!input.calendarInterval || !input.calendarUnit) {
      throw new DomainInvariantError(
        "INVALID_CALENDAR_TRIGGER",
        "El disparador de calendario no tiene frecuencia completa.",
      );
    }
    const calendarBase = meterOnly ? input.now : input.calendarNextAt;
    if (!calendarBase) {
      throw new DomainInvariantError(
        "INVALID_CALENDAR_TRIGGER",
        "El disparador no tiene próxima fecha de calendario.",
      );
    }
    calendarNextAt = addCalendarInterval(
      calendarBase,
      input.calendarInterval,
      input.calendarUnit,
    );
  }
  let meterThreshold = input.meterThreshold;
  if (input.mode !== "CALENDAR") {
    if (input.meterInterval === null || input.meterThreshold === null) {
      throw new DomainInvariantError(
        "INVALID_METER_TRIGGER",
        "El disparador de contador no tiene umbral completo.",
      );
    }
    meterThreshold =
      Math.max(input.meterValue ?? input.meterThreshold, input.meterThreshold) +
      input.meterInterval;
  }
  return {
    occurrenceDueAt,
    calendarNextAt,
    meterThreshold,
    nextDueAt: calendarNextAt,
  };
}

export type PmOccurrence = {
  dueAt: string;
  completedAt: string | null;
  status: string;
};

export function calculatePmCompliance(
  occurrences: PmOccurrence[],
  now: string,
): {
  scheduled: number;
  onTime: number;
  overdue: number;
  compliance: number;
} {
  const nowTime = new Date(now).getTime();
  if (!Number.isFinite(nowTime)) {
    throw new DomainInvariantError(
      "INVALID_PREVENTIVE_DATE",
      "La fecha de cálculo de cumplimiento no es válida.",
    );
  }
  const matured = occurrences.filter(
    (item) =>
      item.status !== "CANCELLED" && new Date(item.dueAt).getTime() <= nowTime,
  );
  const onTime = matured.filter(
    (item) =>
      item.completedAt !== null &&
      new Date(item.completedAt).getTime() <= new Date(item.dueAt).getTime(),
  ).length;
  const overdue = matured.length - onTime;
  return {
    scheduled: matured.length,
    onTime,
    overdue,
    compliance: matured.length ? (onTime / matured.length) * 100 : 100,
  };
}
