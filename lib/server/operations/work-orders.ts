import { getD1 } from "@/db";
import { calculateLaborMinutes } from "@/lib/domain/labor";
import { assertPermission } from "@/lib/domain/permissions";
import {
  assertCanCloseWorkOrder,
  assertCanCompleteWorkOrder,
  assertWorkOrderTransition,
  type WorkOrderStatus,
} from "@/lib/domain/work-orders";
import type { DemoUserSession } from "@/lib/server/auth";
import { ensureDatabase } from "@/lib/server/database";
import { ApiContractError } from "@/lib/server/http";
import {
  atomicBatch,
  assertMutationApplied,
  assertLocationScope,
  jsonValue,
  operationId,
  operationNow,
  resolveLaborRate,
  type OperationContext,
} from "./shared";

type WorkOrderRow = {
  id: string;
  number: string;
  status: WorkOrderStatus;
  version: number;
  priority: string;
  type: string;
  assetId: string | null;
  functionalLocationId: string;
  maintenancePlanId: string | null;
  diagnosis: string | null;
  solution: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  safetyLevel: string;
  safetySummary: string | null;
  ppeRequired: string | null;
  precautions: string | null;
  isolationRequired: number;
};

async function findWorkOrder(
  session: DemoUserSession,
  number: string,
): Promise<WorkOrderRow> {
  await ensureDatabase();
  const row = await getD1()
    .prepare(
      `SELECT id, number, status, version, priority, type, asset_id AS assetId,
        functional_location_id AS functionalLocationId,
        maintenance_plan_id AS maintenancePlanId, diagnosis, solution,
        actual_start AS actualStart, actual_end AS actualEnd,
        safety_level AS safetyLevel, safety_summary AS safetySummary,
        ppe_required AS ppeRequired, precautions,
        isolation_required AS isolationRequired
       FROM work_orders
       WHERE number = ? AND organization_id = ? AND site_id = ? LIMIT 1`,
    )
    .bind(number, session.organizationId, session.siteId)
    .first<WorkOrderRow>();
  if (!row) {
    throw new ApiContractError(
      404,
      "WORK_ORDER_NOT_FOUND",
      "La orden no existe en el centro activo.",
    );
  }
  await assertLocationScope(session, row.functionalLocationId);
  return row;
}

export async function findAssignableUser(
  session: DemoUserSession,
  userId: string,
  functionalLocationId: string,
): Promise<{ id: string; fullName: string }> {
  const user = await getD1()
    .prepare(
      `WITH RECURSIVE location_ancestors(id, parent_id) AS (
         SELECT id, parent_id FROM functional_locations WHERE id = ? AND site_id = ?
         UNION ALL
         SELECT parent.id, parent.parent_id FROM functional_locations parent
         INNER JOIN location_ancestors child ON child.parent_id = parent.id
       )
       SELECT user.id, user.full_name AS fullName
       FROM users user
       INNER JOIN memberships membership ON membership.user_id = user.id
       WHERE user.id = ? AND user.status = 'ACTIVE'
         AND membership.organization_id = ? AND membership.status = 'ACTIVE'
         AND membership.role_key IN ('TECHNICIAN','SUPERVISOR')
         AND EXISTS (
           SELECT 1 FROM membership_site_scopes site_scope
           WHERE site_scope.membership_id = membership.id
             AND site_scope.site_id = ?
             AND (
               site_scope.full_area_access = 1
               OR EXISTS (
                 SELECT 1 FROM membership_area_scopes area_scope
                 WHERE area_scope.membership_site_scope_id = site_scope.id
                   AND area_scope.functional_location_id IN (
                     SELECT id FROM location_ancestors
                   )
               )
             )
         )
       LIMIT 1`,
    )
    .bind(
      functionalLocationId,
      session.siteId,
      userId,
      session.organizationId,
      session.siteId,
    )
    .first<{ id: string; fullName: string }>();
  if (!user) {
    throw new ApiContractError(
      422,
      "INVALID_ASSIGNEE",
      "La persona seleccionada no puede ejecutar trabajos en esta organización.",
    );
  }
  return user;
}

function auditStatement(
  db: D1Database,
  context: OperationContext,
  input: {
    action: string;
    orderId: string;
    previousValue: unknown;
    newValue: unknown;
    expectedVersion: number;
    now: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO audit_entries
        (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
         previous_value, new_value, request_id, created_at)
       SELECT ?, ?, ?, ?, ?, 'WORK_ORDER', id, ?, ?, ?, ?
       FROM work_orders WHERE id = ? AND version = ?`,
    )
    .bind(
      operationId("audit"),
      context.session.organizationId,
      context.session.siteId,
      context.session.userId,
      input.action,
      jsonValue(input.previousValue),
      jsonValue(input.newValue),
      context.requestId,
      input.now,
      input.orderId,
      input.expectedVersion,
    );
}

function eventStatement(
  db: D1Database,
  context: OperationContext,
  input: {
    orderId: string;
    eventType: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    note: string;
    expectedVersion: number;
    now: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO work_order_events
        (id, work_order_id, actor_id, event_type, from_status, to_status, note, created_at)
       SELECT ?, id, ?, ?, ?, ?, ?, ? FROM work_orders
       WHERE id = ? AND version = ?`,
    )
    .bind(
      operationId("wo-event"),
      context.session.userId,
      input.eventType,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.note,
      input.now,
      input.orderId,
      input.expectedVersion,
    );
}

export async function assignTechnician(
  context: OperationContext,
  number: string,
  technicianId: string,
): Promise<void> {
  assertPermission(context.session, "WORK_ORDER_ASSIGN");
  const order = await findWorkOrder(context.session, number);
  const technician = await findAssignableUser(
    context.session,
    technicianId,
    order.functionalLocationId,
  );
  if (["COMPLETED", "CLOSED", "CANCELLED"].includes(order.status)) {
    throw new ApiContractError(
      409,
      "WORK_ORDER_NOT_ASSIGNABLE",
      "Una orden completada, cerrada o cancelada no admite nuevas asignaciones.",
    );
  }
  const nextStatus: WorkOrderStatus = [
    "APPROVED",
    "PLANNED",
    "SCHEDULED",
  ].includes(order.status)
    ? "ASSIGNED"
    : order.status;
  if (nextStatus !== order.status) {
    assertWorkOrderTransition(order.status, nextStatus);
  }
  const now = operationNow(context);
  const nextVersion = order.version + 1;
  const db = getD1();
  const results = await atomicBatch(
    db,
    [
      db
        .prepare(
          `UPDATE work_orders SET status = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ? AND status = ? AND version = ?`,
        )
        .bind(
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
          `INSERT INTO work_order_assignments
          (id, work_order_id, user_id, assignment_role, assigned_at, unassigned_at)
         SELECT ?, id, ?, 'TECHNICIAN', ?, NULL FROM work_orders WHERE id = ? AND version = ?
         ON CONFLICT(work_order_id, user_id) DO UPDATE SET
           assignment_role = 'TECHNICIAN', assigned_at = excluded.assigned_at, unassigned_at = NULL`,
        )
        .bind(
          operationId("assignment"),
          technician.id,
          now,
          order.id,
          nextVersion,
        ),
      eventStatement(db, context, {
        orderId: order.id,
        eventType: "WORK_ORDER_ASSIGNED",
        fromStatus: order.status,
        toStatus: nextStatus,
        note: `${technician.fullName} asignado a la intervención.`,
        expectedVersion: nextVersion,
        now,
      }),
      auditStatement(db, context, {
        action: "WORK_ORDER_ASSIGNED",
        orderId: order.id,
        previousValue: { status: order.status },
        newValue: { status: nextStatus, technicianId: technician.id },
        expectedVersion: nextVersion,
        now,
      }),
      db
        .prepare(
          `INSERT INTO notifications
          (id, organization_id, site_id, user_id, title, body, severity,
           entity_type, entity_id, read_at, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, 'WORK_ORDER', id, NULL, ?
         FROM work_orders WHERE id = ? AND version = ? AND priority IN ('P1_EMERGENCY','P2_URGENT')`,
        )
        .bind(
          operationId("notification"),
          context.session.organizationId,
          context.session.siteId,
          technician.id,
          "OT crítica asignada",
          `${order.number} requiere atención prioritaria.`,
          order.priority === "P1_EMERGENCY" ? "CRITICAL" : "WARNING",
          now,
          order.id,
          nextVersion,
        ),
    ],
    [0],
  );
  assertMutationApplied(results[0]);
}

export async function scheduleWorkOrder(
  context: OperationContext,
  number: string,
  input: { plannedStart: string; plannedEnd: string },
): Promise<void> {
  assertPermission(context.session, "WORK_ORDER_SCHEDULE");
  const order = await findWorkOrder(context.session, number);
  const start = new Date(input.plannedStart).getTime();
  const end = new Date(input.plannedEnd).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new ApiContractError(
      422,
      "INVALID_SCHEDULE",
      "El fin planificado no puede ser anterior al inicio.",
    );
  }
  if (
    ["REQUESTED", "TRIAGE", "COMPLETED", "CLOSED", "CANCELLED"].includes(
      order.status,
    )
  ) {
    throw new ApiContractError(
      409,
      "WORK_ORDER_NOT_SCHEDULABLE",
      "El estado actual no permite programar esta orden.",
    );
  }
  const nextStatus: WorkOrderStatus = ["APPROVED", "PLANNED"].includes(
    order.status,
  )
    ? "SCHEDULED"
    : order.status;
  if (nextStatus !== order.status)
    assertWorkOrderTransition(order.status, nextStatus);
  const now = operationNow(context);
  const nextVersion = order.version + 1;
  const db = getD1();
  const results = await atomicBatch(
    db,
    [
      db
        .prepare(
          `UPDATE work_orders SET planned_start = ?, planned_end = ?, status = ?,
          version = version + 1, updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ? AND status = ? AND version = ?`,
        )
        .bind(
          input.plannedStart,
          input.plannedEnd,
          nextStatus,
          now,
          order.id,
          context.session.organizationId,
          context.session.siteId,
          order.status,
          order.version,
        ),
      eventStatement(db, context, {
        orderId: order.id,
        eventType: "WORK_ORDER_SCHEDULED",
        fromStatus: order.status,
        toStatus: nextStatus,
        note: "Ventana de ejecución programada.",
        expectedVersion: nextVersion,
        now,
      }),
      auditStatement(db, context, {
        action: "WORK_ORDER_SCHEDULED",
        orderId: order.id,
        previousValue: { status: order.status },
        newValue: { status: nextStatus, ...input },
        expectedVersion: nextVersion,
        now,
      }),
    ],
    [0],
  );
  assertMutationApplied(results[0]);
}

async function assertExecutionTechnician(
  context: OperationContext,
  order: WorkOrderRow,
  requestedTechnicianId?: string,
): Promise<{ id: string; fullName: string }> {
  const technicianId =
    context.session.roleKey === "TECHNICIAN"
      ? context.session.userId
      : requestedTechnicianId;
  if (!technicianId) {
    throw new ApiContractError(
      422,
      "TECHNICIAN_REQUIRED",
      "Selecciona el técnico que inicia la sesión.",
    );
  }
  const technician = await findAssignableUser(
    context.session,
    technicianId,
    order.functionalLocationId,
  );
  const assignment = await getD1()
    .prepare(
      `SELECT id FROM work_order_assignments
       WHERE work_order_id = ? AND user_id = ? AND unassigned_at IS NULL LIMIT 1`,
    )
    .bind(order.id, technician.id)
    .first<{ id: string }>();
  if (!assignment) {
    throw new ApiContractError(
      409,
      "TECHNICIAN_NOT_ASSIGNED",
      "El técnico debe estar asignado antes de iniciar trabajo.",
    );
  }
  const active = await getD1()
    .prepare(
      `SELECT id FROM labor_sessions WHERE user_id = ? AND ended_at IS NULL LIMIT 1`,
    )
    .bind(technician.id)
    .first<{ id: string }>();
  if (active) {
    throw new ApiContractError(
      409,
      "ACTIVE_LABOR_SESSION_EXISTS",
      "El técnico ya tiene una sesión activa. Finalízala antes de iniciar otra.",
    );
  }
  return technician;
}

export async function startWork(
  context: OperationContext,
  number: string,
  technicianId?: string,
): Promise<{ laborSessionId: string }> {
  assertPermission(context.session, "WORK_ORDER_EXECUTE");
  const order = await findWorkOrder(context.session, number);
  if (
    ![
      "ASSIGNED",
      "IN_PROGRESS",
      "PAUSED",
      "WAITING_PART",
      "WAITING_VENDOR",
    ].includes(order.status)
  ) {
    throw new ApiContractError(
      409,
      "WORK_ORDER_NOT_EXECUTABLE",
      "El estado actual no permite iniciar trabajo.",
    );
  }
  const technician = await assertExecutionTechnician(
    context,
    order,
    technicianId,
  );
  if (
    order.safetyLevel === "CRITICAL" ||
    Number(order.isolationRequired) === 1
  ) {
    const acknowledgement = await getD1()
      .prepare(
        `SELECT id FROM work_order_safety_acknowledgements
         WHERE work_order_id = ? AND user_id = ? LIMIT 1`,
      )
      .bind(order.id, technician.id)
      .first<{ id: string }>();
    if (!acknowledgement) {
      throw new ApiContractError(
        409,
        "SAFETY_ACK_REQUIRED",
        "Revisa y confirma los avisos de seguridad antes de iniciar el trabajo.",
      );
    }
  }
  if (order.status !== "IN_PROGRESS")
    assertWorkOrderTransition(order.status, "IN_PROGRESS");
  const now = operationNow(context);
  const nextVersion = order.version + 1;
  const laborSessionId = operationId("labor");
  const laborRate = await resolveLaborRate(context.session, technician.id, now);
  const db = getD1();
  const results = await atomicBatch(
    db,
    [
      db
        .prepare(
          `UPDATE work_orders SET status = 'IN_PROGRESS', actual_start = COALESCE(actual_start, ?),
          version = version + 1, updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ? AND status = ? AND version = ?`,
        )
        .bind(
          now,
          now,
          order.id,
          context.session.organizationId,
          context.session.siteId,
          order.status,
          order.version,
        ),
      db
        .prepare(
          `INSERT INTO labor_sessions
          (id, work_order_id, user_id, started_at, ended_at, minutes, status, ended_by_id, note,
           hourly_rate_cents_snapshot, labor_cost_cents, currency_snapshot)
         SELECT ?, id, ?, ?, NULL, 0, 'ACTIVE', NULL, 'Sesión iniciada desde la orden.', ?, 0, ?
         FROM work_orders WHERE id = ? AND version = ?`,
        )
        .bind(
          laborSessionId,
          technician.id,
          now,
          laborRate.hourlyRateCents,
          laborRate.currency,
          order.id,
          nextVersion,
        ),
      eventStatement(db, context, {
        orderId: order.id,
        eventType: order.actualStart ? "WORK_RESUMED" : "WORK_STARTED",
        fromStatus: order.status,
        toStatus: "IN_PROGRESS",
        note: `${technician.fullName} ha iniciado una sesión de trabajo.`,
        expectedVersion: nextVersion,
        now,
      }),
      auditStatement(db, context, {
        action: order.actualStart ? "WORK_RESUMED" : "WORK_STARTED",
        orderId: order.id,
        previousValue: { status: order.status },
        newValue: { status: "IN_PROGRESS", technicianId: technician.id },
        expectedVersion: nextVersion,
        now,
      }),
    ],
    [0],
  );
  assertMutationApplied(results[0]);
  return { laborSessionId };
}

async function activeLaborForOrder(
  orderId: string,
): Promise<
  Array<{ id: string; userId: string; userName: string; startedAt: string }>
> {
  const result = await getD1()
    .prepare(
      `SELECT labor.id, labor.user_id AS userId, user.full_name AS userName,
        labor.started_at AS startedAt
       FROM labor_sessions labor INNER JOIN users user ON user.id = labor.user_id
       WHERE labor.work_order_id = ? AND labor.ended_at IS NULL`,
    )
    .bind(orderId)
    .all<{ id: string; userId: string; userName: string; startedAt: string }>();
  return result.results ?? [];
}

async function endActiveLaborAndTransition(
  context: OperationContext,
  number: string,
  toStatus: "PAUSED" | "WAITING_PART" | "WAITING_VENDOR",
  note: string,
): Promise<void> {
  assertPermission(context.session, "WORK_ORDER_EXECUTE");
  const order = await findWorkOrder(context.session, number);
  assertWorkOrderTransition(order.status, toStatus);
  const activeLabor = await activeLaborForOrder(order.id);
  if (!activeLabor.length && order.status === "IN_PROGRESS") {
    throw new ApiContractError(
      409,
      "NO_ACTIVE_LABOR_SESSION",
      "No hay una sesión activa que finalizar.",
    );
  }
  const now = operationNow(context);
  const nextVersion = order.version + 1;
  const eventType =
    toStatus === "PAUSED"
      ? "WORK_PAUSED"
      : toStatus === "WAITING_PART"
        ? "WAITING_FOR_PART"
        : "WAITING_FOR_VENDOR";
  const db = getD1();
  const results = await atomicBatch(
    db,
    [
      db
        .prepare(
          `UPDATE work_orders SET status = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ? AND status = ? AND version = ?`,
        )
        .bind(
          toStatus,
          now,
          order.id,
          context.session.organizationId,
          context.session.siteId,
          order.status,
          order.version,
        ),
      ...activeLabor.map((labor) =>
        db
          .prepare(
            `UPDATE labor_sessions SET ended_at = ?, minutes = ?, status = 'PAUSED', ended_by_id = ?,
             labor_cost_cents = ROUND(? * COALESCE(hourly_rate_cents_snapshot, 0) / 60.0)
           WHERE id = ? AND ended_at IS NULL
             AND EXISTS (SELECT 1 FROM work_orders WHERE id = ? AND version = ?)`,
          )
          .bind(
            now,
            calculateLaborMinutes(labor.startedAt, now),
            context.session.userId,
            calculateLaborMinutes(labor.startedAt, now),
            labor.id,
            order.id,
            nextVersion,
          ),
      ),
      eventStatement(db, context, {
        orderId: order.id,
        eventType,
        fromStatus: order.status,
        toStatus,
        note,
        expectedVersion: nextVersion,
        now,
      }),
      auditStatement(db, context, {
        action: eventType,
        orderId: order.id,
        previousValue: {
          status: order.status,
          activeLabor: activeLabor.length,
        },
        newValue: { status: toStatus, activeLabor: 0 },
        expectedVersion: nextVersion,
        now,
      }),
    ],
    [0],
  );
  assertMutationApplied(results[0]);
}

export function pauseWork(
  context: OperationContext,
  number: string,
  note?: string,
) {
  return endActiveLaborAndTransition(
    context,
    number,
    "PAUSED",
    note?.trim() || "Trabajo pausado; tiempos de sesión consolidados.",
  );
}

export function markWaiting(
  context: OperationContext,
  number: string,
  reason: "PART" | "VENDOR",
  note?: string,
) {
  return endActiveLaborAndTransition(
    context,
    number,
    reason === "PART" ? "WAITING_PART" : "WAITING_VENDOR",
    note?.trim() ||
      (reason === "PART"
        ? "Intervención detenida a la espera de recambio."
        : "Intervención detenida a la espera de proveedor."),
  );
}

export async function stopLaborSession(
  context: OperationContext,
  number: string,
  laborSessionId: string,
): Promise<void> {
  assertPermission(context.session, "WORK_ORDER_EXECUTE");
  const order = await findWorkOrder(context.session, number);
  const labor = await getD1()
    .prepare(
      `SELECT id, user_id AS userId, started_at AS startedAt FROM labor_sessions
       WHERE id = ? AND work_order_id = ? AND ended_at IS NULL LIMIT 1`,
    )
    .bind(laborSessionId, order.id)
    .first<{ id: string; userId: string; startedAt: string }>();
  if (!labor) {
    throw new ApiContractError(
      404,
      "LABOR_SESSION_NOT_FOUND",
      "La sesión ya no está activa.",
    );
  }
  if (
    context.session.roleKey === "TECHNICIAN" &&
    labor.userId !== context.session.userId
  ) {
    throw new ApiContractError(
      403,
      "FORBIDDEN",
      "Solo puedes finalizar tu propia sesión.",
    );
  }
  const now = operationNow(context);
  const minutes = calculateLaborMinutes(labor.startedAt, now);
  const db = getD1();
  await atomicBatch(
    db,
    [
      db
        .prepare(
          `UPDATE labor_sessions SET ended_at = ?, minutes = ?, status = 'STOPPED', ended_by_id = ?,
        labor_cost_cents = ROUND(? * COALESCE(hourly_rate_cents_snapshot, 0) / 60.0)
       WHERE id = ? AND work_order_id = ? AND ended_at IS NULL`,
        )
        .bind(
          now,
          minutes,
          context.session.userId,
          minutes,
          labor.id,
          order.id,
        ),
      eventStatement(getD1(), context, {
        orderId: order.id,
        eventType: "LABOR_SESSION_STOPPED",
        note: "Sesión de trabajo finalizada.",
        expectedVersion: order.version,
        now,
      }),
      auditStatement(getD1(), context, {
        action: "LABOR_SESSION_STOPPED",
        orderId: order.id,
        previousValue: { laborSessionId, active: true },
        newValue: { laborSessionId, active: false, minutes },
        expectedVersion: order.version,
        now,
      }),
    ],
    [0, 1, 2],
  );
}

export async function completeWorkOrder(
  context: OperationContext,
  number: string,
  input: {
    diagnosis: string;
    solution: string;
    failureMode?: string | null;
    failureModeId?: string | null;
    failureCause?: string | null;
  },
): Promise<void> {
  assertPermission(context.session, "WORK_ORDER_COMPLETE");
  const order = await findWorkOrder(context.session, number);
  assertWorkOrderTransition(order.status, "COMPLETED");
  const [labor, downtime, checklist] = await Promise.all([
    activeLaborForOrder(order.id),
    getD1()
      .prepare(
        "SELECT COUNT(*) AS count FROM downtime_events WHERE work_order_id = ? AND ended_at IS NULL",
      )
      .bind(order.id)
      .first<{ count: number }>(),
    getD1()
      .prepare(
        `SELECT COUNT(*) AS count FROM work_order_tasks
         WHERE work_order_id = ? AND required = 1
           AND response_status NOT IN ('COMPLETED','PASS')`,
      )
      .bind(order.id)
      .first<{ count: number }>(),
  ]);
  assertCanCompleteWorkOrder({
    type: order.type,
    diagnosis: input.diagnosis,
    solution: input.solution,
    openLaborSessions: labor.length,
    openDowntimeEvents: Number(downtime?.count ?? 0),
    requiredChecklistPending: Number(checklist?.count ?? 0),
  });
  const formalMode = input.failureModeId
    ? await getD1()
        .prepare(
          "SELECT id,code FROM failure_modes WHERE id=? AND organization_id=? AND status='ACTIVE' LIMIT 1",
        )
        .bind(input.failureModeId, context.session.organizationId)
        .first<{ id: string; code: string }>()
    : null;
  if (input.failureModeId && !formalMode)
    throw new ApiContractError(
      422,
      "INVALID_FAILURE_MODE",
      "Selecciona un modo de fallo activo de la organización.",
    );
  const now = operationNow(context);
  const nextVersion = order.version + 1;
  const db = getD1();
  const results = await atomicBatch(
    db,
    [
      db
        .prepare(
          `UPDATE work_orders SET status = 'COMPLETED', diagnosis = ?, solution = ?,
          failure_mode = ?, failure_mode_id = ?, failure_cause = ?, actual_end = ?, completed_at = ?,
          version = version + 1, updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ? AND status = ? AND version = ?`,
        )
        .bind(
          input.diagnosis,
          input.solution,
          formalMode?.code ?? input.failureMode ?? null,
          formalMode?.id ?? null,
          input.failureCause ?? null,
          now,
          now,
          now,
          order.id,
          context.session.organizationId,
          context.session.siteId,
          order.status,
          order.version,
        ),
      eventStatement(db, context, {
        orderId: order.id,
        eventType: "WORK_COMPLETED",
        fromStatus: order.status,
        toStatus: "COMPLETED",
        note: "Intervención completada con diagnóstico y resolución documentados.",
        expectedVersion: nextVersion,
        now,
      }),
      auditStatement(db, context, {
        action: "WORK_COMPLETED",
        orderId: order.id,
        previousValue: { status: order.status },
        newValue: {
          status: "COMPLETED",
          diagnosis: input.diagnosis,
          solution: input.solution,
          failureModeId: formalMode?.id ?? null,
        },
        expectedVersion: nextVersion,
        now,
      }),
    ],
    [0],
  );
  assertMutationApplied(results[0]);
}

export async function closeWorkOrder(
  context: OperationContext,
  number: string,
): Promise<void> {
  assertPermission(context.session, "WORK_ORDER_CLOSE");
  const order = await findWorkOrder(context.session, number);
  assertWorkOrderTransition(order.status, "CLOSED");
  const activeLabor = await activeLaborForOrder(order.id);
  assertCanCloseWorkOrder({
    openLaborSessions: activeLabor.length,
    actualEnd: order.actualEnd,
    solution: order.solution,
  });
  const now = operationNow(context);
  const nextVersion = order.version + 1;
  const db = getD1();
  const results = await atomicBatch(
    db,
    [
      db
        .prepare(
          `UPDATE work_orders SET status = 'CLOSED', closed_at = ?,
          version = version + 1, updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ? AND status = 'COMPLETED' AND version = ?`,
        )
        .bind(
          now,
          now,
          order.id,
          context.session.organizationId,
          context.session.siteId,
          order.version,
        ),
      db
        .prepare(
          `UPDATE assets SET
          status = CASE WHEN status IN ('DOWN','DEGRADED','MAINTENANCE') THEN 'OPERATING' ELSE status END,
          updated_at = ?
         WHERE id = ? AND site_id = ? AND status != 'RETIRED'
           AND EXISTS (SELECT 1 FROM work_orders WHERE id = ? AND version = ?)`,
        )
        .bind(
          now,
          order.assetId,
          context.session.siteId,
          order.id,
          nextVersion,
        ),
      db
        .prepare(
          `UPDATE maintenance_plans SET last_executed_at = ?,
          version = version + 1, updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ?
           AND EXISTS (SELECT 1 FROM work_orders WHERE id = ? AND version = ?)`,
        )
        .bind(
          order.actualEnd ?? now,
          now,
          order.maintenancePlanId,
          context.session.organizationId,
          context.session.siteId,
          order.id,
          nextVersion,
        ),
      eventStatement(db, context, {
        orderId: order.id,
        eventType: "WORK_ORDER_CLOSED",
        fromStatus: "COMPLETED",
        toStatus: "CLOSED",
        note: "Trabajo validado, conocimiento consolidado y orden cerrada.",
        expectedVersion: nextVersion,
        now,
      }),
      auditStatement(db, context, {
        action: "WORK_ORDER_CLOSED",
        orderId: order.id,
        previousValue: { status: "COMPLETED" },
        newValue: { status: "CLOSED", closedAt: now },
        expectedVersion: nextVersion,
        now,
      }),
    ],
    [0],
  );
  assertMutationApplied(results[0]);
}

export async function cancelWorkOrder(
  context: OperationContext,
  number: string,
  reason: string,
): Promise<void> {
  assertPermission(context.session, "WORK_ORDER_CANCEL");
  const order = await findWorkOrder(context.session, number);
  assertWorkOrderTransition(order.status, "CANCELLED");
  if (!reason.trim()) {
    throw new ApiContractError(
      422,
      "CANCELLATION_REASON_REQUIRED",
      "Documenta el motivo de cancelación.",
    );
  }
  const activeLabor = await activeLaborForOrder(order.id);
  if (activeLabor.length) {
    throw new ApiContractError(
      409,
      "ACTIVE_LABOR_SESSION",
      "Finaliza las sesiones activas antes de cancelar.",
    );
  }
  const reservations = await getD1()
    .prepare(
      "SELECT COUNT(*) AS count FROM work_order_materials WHERE work_order_id = ? AND reserved_quantity > 0",
    )
    .bind(order.id)
    .first<{ count: number }>();
  if (reservations?.count)
    throw new ApiContractError(
      409,
      "RESERVED_MATERIALS",
      "Libera las reservas de material antes de cancelar la orden.",
    );
  const downtime = await getD1()
    .prepare(
      "SELECT id FROM downtime_events WHERE work_order_id = ? AND ended_at IS NULL",
    )
    .bind(order.id)
    .first();
  if (downtime)
    throw new ApiContractError(
      409,
      "ACTIVE_DOWNTIME",
      "Finaliza el downtime antes de cancelar la orden.",
    );
  const now = operationNow(context);
  const nextVersion = order.version + 1;
  const db = getD1();
  const results = await atomicBatch(
    db,
    [
      db
        .prepare(
          `UPDATE work_orders SET status = 'CANCELLED', cancelled_at = ?,
          version = version + 1, updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ? AND status = ? AND version = ?`,
        )
        .bind(
          now,
          now,
          order.id,
          context.session.organizationId,
          context.session.siteId,
          order.status,
          order.version,
        ),
      eventStatement(db, context, {
        orderId: order.id,
        eventType: "WORK_ORDER_CANCELLED",
        fromStatus: order.status,
        toStatus: "CANCELLED",
        note: reason.trim(),
        expectedVersion: nextVersion,
        now,
      }),
      auditStatement(db, context, {
        action: "WORK_ORDER_CANCELLED",
        orderId: order.id,
        previousValue: { status: order.status },
        newValue: { status: "CANCELLED", reason: reason.trim() },
        expectedVersion: nextVersion,
        now,
      }),
    ],
    [0],
  );
  assertMutationApplied(results[0]);
}

export async function changeWorkOrderPriority(
  context: OperationContext,
  number: string,
  priority: string,
): Promise<void> {
  assertPermission(context.session, "INCIDENT_TRIAGE");
  const order = await findWorkOrder(context.session, number);
  if (["CLOSED", "CANCELLED"].includes(order.status)) {
    throw new ApiContractError(
      409,
      "FINAL_WORK_ORDER",
      "No se cambia la prioridad de una orden finalizada.",
    );
  }
  const now = operationNow(context);
  const nextVersion = order.version + 1;
  const db = getD1();
  const results = await atomicBatch(
    db,
    [
      db
        .prepare(
          `UPDATE work_orders SET priority = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ? AND priority = ? AND version = ?`,
        )
        .bind(
          priority,
          now,
          order.id,
          context.session.organizationId,
          context.session.siteId,
          order.priority,
          order.version,
        ),
      eventStatement(db, context, {
        orderId: order.id,
        eventType: "PRIORITY_CHANGED",
        note: `Prioridad actualizada a ${priority}.`,
        expectedVersion: nextVersion,
        now,
      }),
      auditStatement(db, context, {
        action: "PRIORITY_CHANGED",
        orderId: order.id,
        previousValue: { priority: order.priority },
        newValue: { priority },
        expectedVersion: nextVersion,
        now,
      }),
    ],
    [0],
  );
  assertMutationApplied(results[0]);
}
