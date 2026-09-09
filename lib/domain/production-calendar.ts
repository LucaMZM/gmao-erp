export type CalendarWindow = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  capacityPercent: number;
  kind: "PRODUCTION" | "PLANNED_STOP" | "NON_PRODUCTION";
};

export type CalendarException = {
  date: string;
  startMinute: number | null;
  endMinute: number | null;
  capacityPercent: number;
  kind: "HOLIDAY" | "PLANNED_STOP" | "NON_PRODUCTION" | "EXTRA_PRODUCTION";
};

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function productiveExposureMinutes(
  from: Date,
  to: Date,
  windows: readonly CalendarWindow[],
  exceptions: readonly CalendarException[],
): number {
  if (to <= from) return 0;
  let total = 0;
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  while (cursor < to) {
    const next = new Date(cursor.getTime() + 86_400_000);
    const dayStart = cursor.getTime();
    const key = dateKey(cursor);
    const dayExceptions = exceptions.filter((item) => item.date === key);
    const base = windows.filter(
      (window) => window.dayOfWeek === cursor.getUTCDay(),
    );
    for (const window of base) {
      if (window.kind !== "PRODUCTION") continue;
      const start = Math.max(
        from.getTime(),
        dayStart + window.startMinute * 60_000,
      );
      const end = Math.min(to.getTime(), dayStart + window.endMinute * 60_000);
      if (end <= start) continue;
      let minutes = ((end - start) / 60_000) * (window.capacityPercent / 100);
      for (const exception of dayExceptions) {
        if (exception.startMinute === null || exception.endMinute === null) {
          minutes *= exception.capacityPercent / 100;
          continue;
        }
        const exStart = Math.max(
          start,
          dayStart + exception.startMinute * 60_000,
        );
        const exEnd = Math.min(end, dayStart + exception.endMinute * 60_000);
        if (exEnd > exStart) {
          const overlap = (exEnd - exStart) / 60_000;
          minutes -= overlap * (1 - exception.capacityPercent / 100);
        }
      }
      total += Math.max(0, minutes);
    }
    cursor.setTime(next.getTime());
  }
  return Math.round(total);
}

export function calendarAvailability(
  exposureMinutes: number,
  downtimeMinutes: number,
): number | null {
  if (exposureMinutes <= 0) return null;
  return Math.max(
    0,
    Math.min(
      100,
      ((exposureMinutes - downtimeMinutes) / exposureMinutes) * 100,
    ),
  );
}
