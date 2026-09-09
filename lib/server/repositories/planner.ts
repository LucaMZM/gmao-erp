import {
  calculatePlannedCapacity,
  detectPlanningConflicts,
  type PlanningConflict,
  type PlanningWork,
  type WorkforceProfile,
} from "@/lib/domain/planning";
import type { TenantScope } from "./shared";
import { queryAll } from "./shared";

const OPEN_STATES =
  "('APPROVED','PLANNED','SCHEDULED','ASSIGNED','IN_PROGRESS','PAUSED','WAITING_PART','WAITING_VENDOR')";

export type PlannerWorkOrder = {
  id: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  assetCode: string;
  assetName: string;
  locationName: string;
  estimatedMinutes: number;
  dueAt: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  technicianId: string | null;
  technicianName: string | null;
  technicianInitials: string | null;
  maintenancePlanCode: string | null;
  version: number;
  requiredSkills: Array<{ skillId: string; minimumLevel: number }>;
  requiredCertificationIds: string[];
  conflicts: PlanningConflict[];
  backlogBucket: "UNPLANNED" | "PLANNED" | "SCHEDULED" | "OVERDUE";
};

export type PlannerTechnician = {
  id: string;
  name: string;
  initials: string;
  jobTitle: string;
  avatarColor: string;
  shiftCode: string;
  shiftStart: string;
  shiftEnd: string;
  dailyCapacityMinutes: number;
  availabilityStatus: string;
  skills: Array<{ id: string; code: string; name: string; level: number }>;
  certifications: Array<{ id: string; code: string; name: string }>;
  unavailableIntervals: Array<{
    id: string;
    kind: string;
    startsAt: string;
    endsAt: string;
    note: string | null;
  }>;
};

export type PlannerDay = {
  date: string;
  label: string;
  shortLabel: string;
  isToday: boolean;
};

export type PlannerCapacity = {
  technicianId: string;
  date: string;
  plannedMinutes: number;
  capacityMinutes: number;
  utilization: number;
  overloaded: boolean;
};

export type PlannerData = {
  weekStart: string;
  weekEnd: string;
  days: PlannerDay[];
  technicians: PlannerTechnician[];
  workOrders: PlannerWorkOrder[];
  backlog: PlannerWorkOrder[];
  capacity: PlannerCapacity[];
  backlogCounts: {
    unplanned: number;
    planned: number;
    scheduled: number;
    overdue: number;
  };
  personalAgenda: PlannerWorkOrder[];
};

function normalizeWeekStart(input?: string): string {
  const base =
    input && /^\d{4}-\d{2}-\d{2}$/.test(input)
      ? input
      : new Date().toISOString().slice(0, 10);
  const date = new Date(`${base}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime()))
    return new Date().toISOString().slice(0, 10);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseSkills(
  value: string | null,
): Array<{ skillId: string; minimumLevel: number }> {
  if (!value) return [];
  return value.split(",").flatMap((item) => {
    const [skillId, rawLevel] = item.split(":");
    return skillId ? [{ skillId, minimumLevel: Number(rawLevel ?? 1) }] : [];
  });
}

function parseIds(value: string | null): string[] {
  return value ? [...new Set(value.split(",").filter(Boolean))] : [];
}

type RawWorkOrder = Omit<
  PlannerWorkOrder,
  "requiredSkills" | "requiredCertificationIds" | "conflicts" | "backlogBucket"
> & {
  skillRequirements: string | null;
  certificationRequirements: string | null;
};

function bucketFor(
  order: Pick<
    PlannerWorkOrder,
    "status" | "dueAt" | "plannedStart" | "technicianId"
  >,
  now: string,
): PlannerWorkOrder["backlogBucket"] {
  if (
    order.dueAt &&
    order.dueAt < now &&
    !["COMPLETED", "CLOSED", "CANCELLED"].includes(order.status)
  ) {
    return "OVERDUE";
  }
  if (["APPROVED"].includes(order.status) && !order.plannedStart)
    return "UNPLANNED";
  if (order.status === "PLANNED" || !order.technicianId) return "PLANNED";
  return "SCHEDULED";
}

function profileFor(technician: PlannerTechnician): WorkforceProfile {
  return {
    technicianId: technician.id,
    shiftStart: technician.shiftStart,
    shiftEnd: technician.shiftEnd,
    dailyCapacityMinutes: technician.dailyCapacityMinutes,
    availabilityStatus: technician.availabilityStatus,
    skills: technician.skills.map((skill) => ({
      skillId: skill.id,
      level: skill.level,
    })),
    certificationIds: technician.certifications.map((item) => item.id),
    unavailableIntervals: technician.unavailableIntervals.map((item) => ({
      startsAt: item.startsAt,
      endsAt: item.endsAt,
    })),
  };
}

export async function getPlannerData(
  scope: TenantScope,
  currentUserId: string,
  requestedWeek?: string,
): Promise<PlannerData> {
  const weekStart = normalizeWeekStart(requestedWeek);
  const weekEnd = addDays(weekStart, 7);
  const weekStartIso = `${weekStart}T00:00:00.000Z`;
  const weekEndIso = `${weekEnd}T00:00:00.000Z`;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const days: PlannerDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const parsed = new Date(`${date}T12:00:00.000Z`);
    return {
      date,
      label: new Intl.DateTimeFormat("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(parsed),
      shortLabel: new Intl.DateTimeFormat("es-ES", {
        weekday: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(parsed),
      isToday: date === today,
    };
  });

  const [
    profileRows,
    skillRows,
    certificationRows,
    availabilityRows,
    scheduledRows,
    backlogRows,
  ] = await Promise.all([
    queryAll<
      Omit<
        PlannerTechnician,
        "skills" | "certifications" | "unavailableIntervals"
      >
    >(
      `SELECT user.id, user.full_name AS name, user.initials, user.job_title AS jobTitle,
          user.avatar_color AS avatarColor, profile.shift_code AS shiftCode,
          profile.shift_start AS shiftStart, profile.shift_end AS shiftEnd,
          profile.daily_capacity_minutes AS dailyCapacityMinutes,
          profile.availability_status AS availabilityStatus
         FROM workforce_profiles profile
         INNER JOIN users user ON user.id = profile.user_id
         WHERE profile.organization_id = ? AND profile.site_id = ? AND user.status = 'ACTIVE'
         ORDER BY profile.shift_start, user.full_name`,
      [scope.organizationId, scope.siteId],
    ),
    queryAll<{
      technicianId: string;
      id: string;
      code: string;
      name: string;
      level: number;
    }>(
      `SELECT relation.user_id AS technicianId, skill.id, skill.code, skill.name, relation.level
         FROM technician_skills relation
         INNER JOIN skills skill ON skill.id = relation.skill_id
         WHERE skill.organization_id = ? ORDER BY skill.name`,
      [scope.organizationId],
    ),
    queryAll<{ technicianId: string; id: string; code: string; name: string }>(
      `SELECT relation.user_id AS technicianId, certification.id,
          certification.code, certification.name
         FROM technician_certifications relation
         INNER JOIN certifications certification ON certification.id = relation.certification_id
         WHERE certification.organization_id = ? AND relation.status = 'VALID'
           AND (relation.expires_at IS NULL OR relation.expires_at > ?)
         ORDER BY certification.code`,
      [scope.organizationId, now],
    ),
    queryAll<{
      id: string;
      technicianId: string;
      kind: string;
      startsAt: string;
      endsAt: string;
      note: string | null;
    }>(
      `SELECT id, user_id AS technicianId, kind, starts_at AS startsAt,
          ends_at AS endsAt, note
         FROM workforce_availability
         WHERE organization_id = ? AND site_id = ?
           AND starts_at < ? AND ends_at > ?
         ORDER BY starts_at`,
      [scope.organizationId, scope.siteId, weekEndIso, weekStartIso],
    ),
    queryAll<RawWorkOrder>(
      `SELECT wo.id, wo.number, wo.title, wo.status, wo.priority, wo.type,
          asset.code AS assetCode, asset.name AS assetName, location.name AS locationName,
          wo.estimated_minutes AS estimatedMinutes, wo.due_at AS dueAt,
          wo.planned_start AS plannedStart, wo.planned_end AS plannedEnd,
          assignment.user_id AS technicianId, user.full_name AS technicianName,
          user.initials AS technicianInitials, plan.code AS maintenancePlanCode,
          wo.version,
          (SELECT GROUP_CONCAT(requirement.skill_id || ':' || requirement.minimum_level)
            FROM work_order_skill_requirements requirement
            WHERE requirement.work_order_id = wo.id) AS skillRequirements,
          (SELECT GROUP_CONCAT(requirement.certification_id)
            FROM work_order_certification_requirements requirement
            WHERE requirement.work_order_id = wo.id) AS certificationRequirements
         FROM work_orders wo
         INNER JOIN assets asset ON asset.id = wo.asset_id
         INNER JOIN functional_locations location ON location.id = wo.functional_location_id
         LEFT JOIN maintenance_plans plan ON plan.id = wo.maintenance_plan_id
         LEFT JOIN work_order_assignments assignment ON assignment.id = (
           SELECT active_assignment.id FROM work_order_assignments active_assignment
           WHERE active_assignment.work_order_id = wo.id
             AND active_assignment.unassigned_at IS NULL
           ORDER BY active_assignment.assigned_at LIMIT 1)
         LEFT JOIN users user ON user.id = assignment.user_id
         WHERE wo.organization_id = ? AND wo.site_id = ?
           AND wo.status IN ${OPEN_STATES}
           AND wo.planned_start >= ? AND wo.planned_start < ?
         ORDER BY wo.planned_start, wo.priority, wo.number`,
      [scope.organizationId, scope.siteId, weekStartIso, weekEndIso],
    ),
    queryAll<RawWorkOrder>(
      `SELECT wo.id, wo.number, wo.title, wo.status, wo.priority, wo.type,
          asset.code AS assetCode, asset.name AS assetName, location.name AS locationName,
          wo.estimated_minutes AS estimatedMinutes, wo.due_at AS dueAt,
          wo.planned_start AS plannedStart, wo.planned_end AS plannedEnd,
          assignment.user_id AS technicianId, user.full_name AS technicianName,
          user.initials AS technicianInitials, plan.code AS maintenancePlanCode,
          wo.version,
          (SELECT GROUP_CONCAT(requirement.skill_id || ':' || requirement.minimum_level)
            FROM work_order_skill_requirements requirement
            WHERE requirement.work_order_id = wo.id) AS skillRequirements,
          (SELECT GROUP_CONCAT(requirement.certification_id)
            FROM work_order_certification_requirements requirement
            WHERE requirement.work_order_id = wo.id) AS certificationRequirements
         FROM work_orders wo
         INNER JOIN assets asset ON asset.id = wo.asset_id
         INNER JOIN functional_locations location ON location.id = wo.functional_location_id
         LEFT JOIN maintenance_plans plan ON plan.id = wo.maintenance_plan_id
         LEFT JOIN work_order_assignments assignment ON assignment.id = (
           SELECT active_assignment.id FROM work_order_assignments active_assignment
           WHERE active_assignment.work_order_id = wo.id
             AND active_assignment.unassigned_at IS NULL
           ORDER BY active_assignment.assigned_at LIMIT 1)
         LEFT JOIN users user ON user.id = assignment.user_id
         WHERE wo.organization_id = ? AND wo.site_id = ?
           AND wo.status IN ${OPEN_STATES}
           AND (wo.planned_start IS NULL OR assignment.user_id IS NULL OR wo.due_at < ?)
         ORDER BY CASE WHEN wo.due_at < ? THEN 0 ELSE 1 END,
           CASE wo.priority WHEN 'P1_EMERGENCY' THEN 1 WHEN 'P2_URGENT' THEN 2
             WHEN 'P3_HIGH' THEN 3 WHEN 'P4_NORMAL' THEN 4 ELSE 5 END,
           wo.due_at, wo.number LIMIT 100`,
      [scope.organizationId, scope.siteId, now, now],
    ),
  ]);

  const technicians: PlannerTechnician[] = profileRows.map((profile) => ({
    ...profile,
    skills: skillRows
      .filter((item) => item.technicianId === profile.id)
      .map(({ id, code, name, level }) => ({ id, code, name, level })),
    certifications: certificationRows
      .filter((item) => item.technicianId === profile.id)
      .map(({ id, code, name }) => ({ id, code, name })),
    unavailableIntervals: availabilityRows
      .filter((item) => item.technicianId === profile.id)
      .map(({ id, kind, startsAt, endsAt, note }) => ({
        id,
        kind,
        startsAt,
        endsAt,
        note,
      })),
  }));

  const parseOrder = (row: RawWorkOrder): PlannerWorkOrder => ({
    ...row,
    requiredSkills: parseSkills(row.skillRequirements),
    requiredCertificationIds: parseIds(row.certificationRequirements),
    conflicts: [],
    backlogBucket: bucketFor(row, now),
  });
  const workOrders = scheduledRows.map(parseOrder);
  const planningWorks: PlanningWork[] = workOrders.map((order) => ({
    id: order.id,
    technicianId: order.technicianId,
    plannedStart: order.plannedStart,
    plannedEnd: order.plannedEnd,
    estimatedMinutes: order.estimatedMinutes,
    requiredSkills: order.requiredSkills,
    requiredCertificationIds: order.requiredCertificationIds,
  }));
  for (const order of workOrders) {
    const technician = technicians.find(
      (item) => item.id === order.technicianId,
    );
    if (!technician) continue;
    order.conflicts = detectPlanningConflicts({
      candidate: planningWorks.find((item) => item.id === order.id)!,
      profile: profileFor(technician),
      existing: planningWorks,
    });
  }

  const backlogMap = new Map<string, PlannerWorkOrder>();
  for (const row of backlogRows) backlogMap.set(row.id, parseOrder(row));
  const backlog = [...backlogMap.values()];
  const capacity: PlannerCapacity[] = technicians.flatMap((technician) =>
    days.map((day) => {
      const plannedMinutes = calculatePlannedCapacity(
        planningWorks,
        technician.id,
        day.date,
      );
      return {
        technicianId: technician.id,
        date: day.date,
        plannedMinutes,
        capacityMinutes: technician.dailyCapacityMinutes,
        utilization: technician.dailyCapacityMinutes
          ? (plannedMinutes / technician.dailyCapacityMinutes) * 100
          : 0,
        overloaded: plannedMinutes > technician.dailyCapacityMinutes,
      };
    }),
  );
  const combinedForCounts = new Map<string, PlannerWorkOrder>();
  for (const item of [...workOrders, ...backlog])
    combinedForCounts.set(item.id, item);
  const allOpen = [...combinedForCounts.values()];

  return {
    weekStart,
    weekEnd,
    days,
    technicians,
    workOrders,
    backlog,
    capacity,
    backlogCounts: {
      unplanned: allOpen.filter((item) => item.backlogBucket === "UNPLANNED")
        .length,
      planned: allOpen.filter((item) => item.backlogBucket === "PLANNED")
        .length,
      scheduled: allOpen.filter((item) => item.backlogBucket === "SCHEDULED")
        .length,
      overdue: allOpen.filter((item) => item.backlogBucket === "OVERDUE")
        .length,
    },
    personalAgenda: workOrders
      .filter((item) => item.technicianId === currentUserId)
      .sort((left, right) =>
        String(left.plannedStart).localeCompare(String(right.plannedStart)),
      ),
  };
}
