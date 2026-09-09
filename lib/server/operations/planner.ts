import { getD1 } from "@/db";
import {
  detectPlanningConflicts,
  type PlanningConflict,
  type PlanningWork,
  type WorkforceProfile,
} from "@/lib/domain/planning";
import { assertPermission } from "@/lib/domain/permissions";
import {
  assertWorkOrderTransition,
  type WorkOrderStatus,
} from "@/lib/domain/work-orders";
import { ensureDatabase } from "@/lib/server/database";
import { ApiContractError } from "@/lib/server/http";
import {
  assertMutationApplied,
  jsonValue,
  operationId,
  operationNow,
  type OperationContext,
} from "./shared";

type PlannerOrderRow = {
  id: string;
  number: string;
  status: WorkOrderStatus;
  version: number;
  estimatedMinutes: number;
  plannedStart: string | null;
  plannedEnd: string | null;
};

function localDateTimeToIso(dateKey: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new ApiContractError(
      422,
      "INVALID_PLANNER_TARGET",
      "El día o la hora de planificación no son válidos.",
    );
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(localAsUtc));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const represented = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return new Date(localAsUtc - (represented - localAsUtc)).toISOString();
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

function parseProfileSkills(
  value: string | null,
): Array<{ skillId: string; level: number }> {
  if (!value) return [];
  return value.split(",").flatMap((item) => {
    const [skillId, rawLevel] = item.split(":");
    return skillId ? [{ skillId, level: Number(rawLevel ?? 1) }] : [];
  });
}

function parseIds(value: string | null): string[] {
  return value ? [...new Set(value.split(",").filter(Boolean))] : [];
}

export type MovePlannerWorkInput = {
  expectedVersion: number;
  technicianId: string | null;
  date: string | null;
};

export async function movePlannerWork(
  context: OperationContext,
  number: string,
  input: MovePlannerWorkInput,
): Promise<{ conflicts: PlanningConflict[]; version: number }> {
  assertPermission(context.session, "PLANNER_MANAGE");
  await ensureDatabase();
  const db = getD1();
  const order = await db
    .prepare(
      `SELECT id, number, status, version, estimated_minutes AS estimatedMinutes,
        planned_start AS plannedStart, planned_end AS plannedEnd
       FROM work_orders WHERE number = ? AND organization_id = ? AND site_id = ? LIMIT 1`,
    )
    .bind(number, context.session.organizationId, context.session.siteId)
    .first<PlannerOrderRow>();
  if (!order) {
    throw new ApiContractError(
      404,
      "WORK_ORDER_NOT_FOUND",
      "La orden no existe en el centro activo.",
    );
  }
  if (order.version !== input.expectedVersion) {
    throw new ApiContractError(
      409,
      "CONCURRENT_MODIFICATION",
      "La orden ha cambiado en otra sesión. Actualiza el Planner.",
    );
  }
  if (
    !["APPROVED", "PLANNED", "SCHEDULED", "ASSIGNED"].includes(order.status)
  ) {
    throw new ApiContractError(
      409,
      "WORK_ORDER_NOT_PLANNABLE",
      "El estado actual no permite replanificar la orden.",
    );
  }
  if (
    (input.date === null) !==
    (input.technicianId === null && input.date === null)
  ) {
    // A day without a technician is valid; a technician without a day is not.
    if (input.date === null && input.technicianId !== null) {
      throw new ApiContractError(
        422,
        "INVALID_PLANNER_TARGET",
        "Selecciona un día para asignar el trabajo.",
      );
    }
  }

  const now = operationNow(context);
  let plannedStart: string | null = null;
  let plannedEnd: string | null = null;
  let technicianName: string | null = null;
  let profile: WorkforceProfile | null = null;
  let conflicts: PlanningConflict[] = [];

  if (input.date) {
    let startTime = "08:00";
    if (input.technicianId) {
      const technician = await db
        .prepare(
          `SELECT user.id, user.full_name AS fullName, profile.shift_start AS shiftStart,
            profile.shift_end AS shiftEnd,
            profile.daily_capacity_minutes AS dailyCapacityMinutes,
            profile.availability_status AS availabilityStatus,
            (SELECT GROUP_CONCAT(relation.skill_id || ':' || relation.level)
              FROM technician_skills relation WHERE relation.user_id = user.id) AS skills,
            (SELECT GROUP_CONCAT(relation.certification_id)
              FROM technician_certifications relation
              WHERE relation.user_id = user.id AND relation.status = 'VALID'
                AND (relation.expires_at IS NULL OR relation.expires_at > ?)) AS certifications
           FROM workforce_profiles profile
           INNER JOIN users user ON user.id = profile.user_id
           WHERE profile.organization_id = ? AND profile.site_id = ?
             AND profile.user_id = ? AND user.status = 'ACTIVE' LIMIT 1`,
        )
        .bind(
          now,
          context.session.organizationId,
          context.session.siteId,
          input.technicianId,
        )
        .first<{
          id: string;
          fullName: string;
          shiftStart: string;
          shiftEnd: string;
          dailyCapacityMinutes: number;
          availabilityStatus: string;
          skills: string | null;
          certifications: string | null;
        }>();
      if (!technician) {
        throw new ApiContractError(
          422,
          "INVALID_PLANNER_TECHNICIAN",
          "El técnico no está disponible en el centro actual.",
        );
      }
      technicianName = technician.fullName;
      startTime = technician.shiftStart;
      const absences = await db
        .prepare(
          `SELECT starts_at AS startsAt, ends_at AS endsAt
           FROM workforce_availability
           WHERE organization_id = ? AND site_id = ? AND user_id = ?
             AND starts_at < ? AND ends_at > ?`,
        )
        .bind(
          context.session.organizationId,
          context.session.siteId,
          technician.id,
          `${input.date}T23:59:59.999Z`,
          `${input.date}T00:00:00.000Z`,
        )
        .all<{ startsAt: string; endsAt: string }>();
      profile = {
        technicianId: technician.id,
        shiftStart: technician.shiftStart,
        shiftEnd: technician.shiftEnd,
        dailyCapacityMinutes: technician.dailyCapacityMinutes,
        availabilityStatus: technician.availabilityStatus,
        skills: parseProfileSkills(technician.skills),
        certificationIds: parseIds(technician.certifications),
        unavailableIntervals: absences.results ?? [],
      };
    }
    plannedStart = localDateTimeToIso(input.date, startTime);
    plannedEnd = new Date(
      new Date(plannedStart).getTime() + order.estimatedMinutes * 60_000,
    ).toISOString();
  }

  const nextStatus: WorkOrderStatus = input.date
    ? input.technicianId
      ? "ASSIGNED"
      : "SCHEDULED"
    : "PLANNED";
  if (nextStatus !== order.status) {
    assertWorkOrderTransition(order.status, nextStatus);
  }

  if (profile && plannedStart && plannedEnd) {
    const [requirements, existing] = await Promise.all([
      db
        .prepare(
          `SELECT
            (SELECT GROUP_CONCAT(skill_id || ':' || minimum_level)
              FROM work_order_skill_requirements WHERE work_order_id = ?) AS skills,
            (SELECT GROUP_CONCAT(certification_id)
              FROM work_order_certification_requirements WHERE work_order_id = ?) AS certifications`,
        )
        .bind(order.id, order.id)
        .first<{ skills: string | null; certifications: string | null }>(),
      db
        .prepare(
          `SELECT wo.id, assignment.user_id AS technicianId,
            wo.planned_start AS plannedStart, wo.planned_end AS plannedEnd,
            wo.estimated_minutes AS estimatedMinutes,
            (SELECT GROUP_CONCAT(skill_id || ':' || minimum_level)
              FROM work_order_skill_requirements WHERE work_order_id = wo.id) AS skills,
            (SELECT GROUP_CONCAT(certification_id)
              FROM work_order_certification_requirements WHERE work_order_id = wo.id) AS certifications
           FROM work_orders wo
           LEFT JOIN work_order_assignments assignment ON assignment.id = (
             SELECT active_assignment.id FROM work_order_assignments active_assignment
             WHERE active_assignment.work_order_id = wo.id
               AND active_assignment.unassigned_at IS NULL
             ORDER BY active_assignment.assigned_at LIMIT 1)
           WHERE wo.organization_id = ? AND wo.site_id = ?
             AND wo.status IN ('APPROVED','PLANNED','SCHEDULED','ASSIGNED')
             AND wo.planned_start IS NOT NULL AND wo.planned_end IS NOT NULL
             AND substr(wo.planned_start, 1, 10) BETWEEN ? AND ?`,
        )
        .bind(
          context.session.organizationId,
          context.session.siteId,
          input.date,
          input.date,
        )
        .all<{
          id: string;
          technicianId: string | null;
          plannedStart: string;
          plannedEnd: string;
          estimatedMinutes: number;
          skills: string | null;
          certifications: string | null;
        }>(),
    ]);
    const candidate: PlanningWork = {
      id: order.id,
      technicianId: input.technicianId,
      plannedStart,
      plannedEnd,
      estimatedMinutes: order.estimatedMinutes,
      requiredSkills: parseSkills(requirements?.skills ?? null),
      requiredCertificationIds: parseIds(requirements?.certifications ?? null),
    };
    const existingWorks: PlanningWork[] = (existing.results ?? []).map(
      (item) => ({
        id: item.id,
        technicianId: item.technicianId,
        plannedStart: item.plannedStart,
        plannedEnd: item.plannedEnd,
        estimatedMinutes: item.estimatedMinutes,
        requiredSkills: parseSkills(item.skills),
        requiredCertificationIds: parseIds(item.certifications),
      }),
    );
    conflicts = detectPlanningConflicts({
      candidate,
      profile,
      existing: existingWorks,
    });
    const hard = conflicts.filter((conflict) => conflict.severity === "HARD");
    if (hard.length) {
      throw new ApiContractError(
        409,
        "HARD_PLANNING_CONFLICT",
        hard.map((conflict) => conflict.message).join(" "),
      );
    }
  }

  const nextVersion = order.version + 1;
  const results = await db.batch([
    db
      .prepare(
        `UPDATE work_orders SET planned_start = ?, planned_end = ?, status = ?,
          version = version + 1, updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ?
           AND status = ? AND version = ?`,
      )
      .bind(
        plannedStart,
        plannedEnd,
        nextStatus,
        now,
        order.id,
        context.session.organizationId,
        context.session.siteId,
        order.status,
        order.version,
      ),
    db
      .prepare(
        `UPDATE work_order_assignments SET unassigned_at = ?
         WHERE work_order_id = ? AND unassigned_at IS NULL
           AND EXISTS (SELECT 1 FROM work_orders WHERE id = ? AND version = ?)`,
      )
      .bind(now, order.id, order.id, nextVersion),
    ...(input.technicianId
      ? [
          db
            .prepare(
              `INSERT INTO work_order_assignments
                (id, work_order_id, user_id, assignment_role, assigned_at, unassigned_at)
               SELECT ?, id, ?, 'TECHNICIAN', ?, NULL FROM work_orders
               WHERE id = ? AND version = ?
               ON CONFLICT(work_order_id, user_id) DO UPDATE SET
                 assignment_role = 'TECHNICIAN', assigned_at = excluded.assigned_at,
                 unassigned_at = NULL`,
            )
            .bind(
              operationId("assignment"),
              input.technicianId,
              now,
              order.id,
              nextVersion,
            ),
        ]
      : []),
    db
      .prepare(
        `INSERT INTO work_order_events
          (id, work_order_id, actor_id, event_type, from_status, to_status, note, created_at)
         SELECT ?, id, ?, 'WORK_ORDER_REPLANNED', ?, ?, ?, ?
         FROM work_orders WHERE id = ? AND version = ?`,
      )
      .bind(
        operationId("wo-event"),
        context.session.userId,
        order.status,
        nextStatus,
        input.date
          ? technicianName
            ? `Programada el ${input.date} para ${technicianName}.`
            : `Programada el ${input.date} sin técnico asignado.`
          : "Devuelta al backlog sin asignación.",
        now,
        order.id,
        nextVersion,
      ),
    db
      .prepare(
        `INSERT INTO audit_entries
          (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
           previous_value, new_value, request_id, created_at)
         SELECT ?, organization_id, site_id, ?, 'WORK_ORDER_REPLANNED',
           'WORK_ORDER', id, ?, ?, ?, ? FROM work_orders WHERE id = ? AND version = ?`,
      )
      .bind(
        operationId("audit"),
        context.session.userId,
        jsonValue({
          status: order.status,
          plannedStart: order.plannedStart,
          plannedEnd: order.plannedEnd,
        }),
        jsonValue({
          status: nextStatus,
          plannedStart,
          plannedEnd,
          technicianId: input.technicianId,
          conflicts,
        }),
        context.requestId,
        now,
        order.id,
        nextVersion,
      ),
  ]);
  assertMutationApplied(results[0]);
  return { conflicts, version: nextVersion };
}
