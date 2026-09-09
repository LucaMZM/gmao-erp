import { DomainInvariantError } from "./errors";

export type PlanningWork = {
  id: string;
  technicianId: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  estimatedMinutes: number;
  requiredSkills: Array<{ skillId: string; minimumLevel: number }>;
  requiredCertificationIds: string[];
};

export type WorkforceProfile = {
  technicianId: string;
  shiftStart: string;
  shiftEnd: string;
  dailyCapacityMinutes: number;
  availabilityStatus: string;
  skills: Array<{ skillId: string; level: number }>;
  certificationIds: string[];
  unavailableIntervals: Array<{ startsAt: string; endsAt: string }>;
};

export type PlanningConflict = {
  code:
    | "TECHNICIAN_UNAVAILABLE"
    | "MISSING_SKILL"
    | "MISSING_CERTIFICATION"
    | "OVERLAP"
    | "OUTSIDE_SHIFT"
    | "OVER_CAPACITY";
  severity: "HARD" | "WARNING";
  message: string;
};

function toMinutes(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) {
    throw new DomainInvariantError(
      "INVALID_SHIFT_TIME",
      "El horario de turno no es válido.",
    );
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function overlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function minutesInPlantTime(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return Number(values.hour) * 60 + Number(values.minute);
}

export function calculatePlannedCapacity(
  works: PlanningWork[],
  technicianId: string,
  dateKey: string,
): number {
  return works
    .filter(
      (item) =>
        item.technicianId === technicianId &&
        item.plannedStart?.slice(0, 10) === dateKey,
    )
    .reduce((total, item) => total + item.estimatedMinutes, 0);
}

export function detectPlanningConflicts(input: {
  candidate: PlanningWork;
  profile: WorkforceProfile;
  existing: PlanningWork[];
}): PlanningConflict[] {
  const { candidate, profile, existing } = input;
  if (!candidate.plannedStart || !candidate.plannedEnd) return [];
  const start = new Date(candidate.plannedStart);
  const end = new Date(candidate.plannedEnd);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start
  ) {
    throw new DomainInvariantError(
      "INVALID_SCHEDULE",
      "La ventana planificada debe tener una duración positiva.",
    );
  }
  const conflicts: PlanningConflict[] = [];
  if (profile.availabilityStatus === "UNAVAILABLE") {
    conflicts.push({
      code: "TECHNICIAN_UNAVAILABLE",
      severity: "HARD",
      message: "El técnico no está disponible en el periodo seleccionado.",
    });
  } else if (profile.availabilityStatus === "LIMITED") {
    conflicts.push({
      code: "TECHNICIAN_UNAVAILABLE",
      severity: "WARNING",
      message: "El técnico tiene disponibilidad limitada.",
    });
  }
  if (
    profile.unavailableIntervals.some((interval) =>
      overlap(
        start.getTime(),
        end.getTime(),
        new Date(interval.startsAt).getTime(),
        new Date(interval.endsAt).getTime(),
      ),
    )
  ) {
    conflicts.push({
      code: "TECHNICIAN_UNAVAILABLE",
      severity: "HARD",
      message: "La ventana coincide con una ausencia registrada.",
    });
  }
  const missingSkills = candidate.requiredSkills.filter(
    (requirement) =>
      !profile.skills.some(
        (skill) =>
          skill.skillId === requirement.skillId &&
          skill.level >= requirement.minimumLevel,
      ),
  );
  if (missingSkills.length) {
    conflicts.push({
      code: "MISSING_SKILL",
      severity: "WARNING",
      message: `Faltan ${missingSkills.length} skills requeridas.`,
    });
  }
  const missingCertifications = candidate.requiredCertificationIds.filter(
    (certificationId) => !profile.certificationIds.includes(certificationId),
  );
  if (missingCertifications.length) {
    conflicts.push({
      code: "MISSING_CERTIFICATION",
      severity: "HARD",
      message: `Faltan ${missingCertifications.length} certificaciones vigentes.`,
    });
  }
  const candidateStart = start.getTime();
  const candidateEnd = end.getTime();
  if (
    existing.some(
      (item) =>
        item.id !== candidate.id &&
        item.technicianId === profile.technicianId &&
        item.plannedStart !== null &&
        item.plannedEnd !== null &&
        overlap(
          candidateStart,
          candidateEnd,
          new Date(item.plannedStart).getTime(),
          new Date(item.plannedEnd).getTime(),
        ),
    )
  ) {
    conflicts.push({
      code: "OVERLAP",
      severity: "WARNING",
      message: "La intervención se solapa con otro trabajo planificado.",
    });
  }
  const startMinutes = minutesInPlantTime(start);
  const endMinutes = minutesInPlantTime(end);
  if (
    startMinutes < toMinutes(profile.shiftStart) ||
    endMinutes > toMinutes(profile.shiftEnd)
  ) {
    conflicts.push({
      code: "OUTSIDE_SHIFT",
      severity: "WARNING",
      message: "Parte del trabajo queda fuera del turno configurado.",
    });
  }
  const dateKey = candidate.plannedStart.slice(0, 10);
  const plannedMinutes =
    calculatePlannedCapacity(
      existing.filter((item) => item.id !== candidate.id),
      profile.technicianId,
      dateKey,
    ) + candidate.estimatedMinutes;
  if (plannedMinutes > profile.dailyCapacityMinutes) {
    conflicts.push({
      code: "OVER_CAPACITY",
      severity: "WARNING",
      message: `Carga ${plannedMinutes} min sobre capacidad ${profile.dailyCapacityMinutes} min.`,
    });
  }
  return conflicts;
}
