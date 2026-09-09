import { getD1 } from "@/db";
import { assertPermission } from "@/lib/domain/permissions";
import {
  advancePreventiveTrigger,
  assertValidMeterReading,
  evaluatePreventiveTrigger,
  preventiveWindowKey,
  type CalendarUnit,
  type PreventiveTriggerMode,
} from "@/lib/domain/preventive";
import { assertAssetAcceptsPlannedWork } from "@/lib/domain/work-orders";
import type { DemoUserSession } from "@/lib/server/auth";
import { ensureDatabase } from "@/lib/server/database";
import { ApiContractError } from "@/lib/server/http";
import {
  assertMutationApplied,
  jsonValue,
  nextPlantNumber,
  operationId,
  operationNow,
  type OperationContext,
} from "./shared";

type PlanRow = {
  id: string;
  code: string;
  title: string;
  description: string;
  status: "ACTIVE" | "INACTIVE";
  assetId: string;
  assetStatus: string;
  functionalLocationId: string;
  ownerId: string;
  priority: string;
  estimatedMinutes: number;
  triggerMode: PreventiveTriggerMode;
  calendarUnit: CalendarUnit | null;
  calendarInterval: number | null;
  calendarNextAt: string | null;
  meterId: string | null;
  meterValue: number | null;
  meterInterval: number | null;
  meterThreshold: number | null;
  nextDueAt: string | null;
  lastGeneratedAt: string | null;
  leadDays: number;
  version: number;
};

async function findPlan(
  session: DemoUserSession,
  code: string,
): Promise<PlanRow> {
  await ensureDatabase();
  const plan = await getD1()
    .prepare(
      `SELECT plan.id, plan.code, plan.title, plan.description, plan.status,
        plan.asset_id AS assetId, asset.status AS assetStatus,
        plan.functional_location_id AS functionalLocationId,
        plan.owner_id AS ownerId, plan.priority,
        plan.estimated_minutes AS estimatedMinutes,
        plan.trigger_mode AS triggerMode, plan.calendar_unit AS calendarUnit,
        plan.calendar_interval AS calendarInterval,
        plan.calendar_next_at AS calendarNextAt, plan.meter_id AS meterId,
        meter.last_value AS meterValue, plan.meter_interval AS meterInterval,
        plan.meter_threshold AS meterThreshold, plan.next_due_at AS nextDueAt,
        plan.lead_days AS leadDays, plan.last_generated_at AS lastGeneratedAt,
        plan.version
       FROM maintenance_plans plan
       INNER JOIN assets asset ON asset.id = plan.asset_id
       LEFT JOIN meters meter ON meter.id = plan.meter_id
       WHERE plan.code = ? AND plan.organization_id = ? AND plan.site_id = ? LIMIT 1`,
    )
    .bind(code, session.organizationId, session.siteId)
    .first<PlanRow>();
  if (!plan) {
    throw new ApiContractError(
      404,
      "MAINTENANCE_PLAN_NOT_FOUND",
      "El plan no existe en el centro activo.",
    );
  }
  return plan;
}

export type CreateMaintenancePlanInput = {
  assetId: string;
  ownerId: string;
  title: string;
  description: string;
  criticality: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  priority: "P1_EMERGENCY" | "P2_URGENT" | "P3_HIGH" | "P4_NORMAL" | "P5_LOW";
  estimatedMinutes: number;
  triggerMode: PreventiveTriggerMode;
  calendarUnit?: CalendarUnit | null;
  calendarInterval?: number | null;
  firstDueAt?: string | null;
  meterId?: string | null;
  meterInterval?: number | null;
  meterThreshold?: number | null;
  leadDays: number;
  tasks: Array<{
    title: string;
    description?: string | null;
    required?: boolean;
    responseType?:
      "CHECKBOX" | "CONFIRMATION" | "TEXT" | "NUMBER" | "READING" | "PASS_FAIL";
    unit?: string | null;
    minimumValue?: number | null;
    maximumValue?: number | null;
    meterId?: string | null;
  }>;
  skills: Array<{ skillId: string; minimumLevel: number }>;
  certificationIds: string[];
  materials: Array<{ partId: string; quantity: number }>;
};

function requireCalendarConfig(input: CreateMaintenancePlanInput): {
  unit: CalendarUnit;
  interval: number;
  firstDueAt: string;
} | null {
  if (input.triggerMode === "METER") return null;
  if (
    !input.calendarUnit ||
    !Number.isInteger(input.calendarInterval) ||
    Number(input.calendarInterval) <= 0 ||
    !input.firstDueAt ||
    !Number.isFinite(new Date(input.firstDueAt).getTime())
  ) {
    throw new ApiContractError(
      422,
      "INVALID_CALENDAR_TRIGGER",
      "Define una frecuencia y primera ejecución válidas.",
    );
  }
  return {
    unit: input.calendarUnit,
    interval: Number(input.calendarInterval),
    firstDueAt: input.firstDueAt,
  };
}

function requireMeterConfig(input: CreateMaintenancePlanInput): {
  meterId: string;
  interval: number;
  threshold: number;
} | null {
  if (input.triggerMode === "CALENDAR") return null;
  if (
    !input.meterId ||
    !Number.isFinite(input.meterInterval) ||
    Number(input.meterInterval) <= 0 ||
    !Number.isFinite(input.meterThreshold) ||
    Number(input.meterThreshold) < 0
  ) {
    throw new ApiContractError(
      422,
      "INVALID_METER_TRIGGER",
      "Define contador, intervalo y umbral válidos.",
    );
  }
  return {
    meterId: input.meterId,
    interval: Number(input.meterInterval),
    threshold: Number(input.meterThreshold),
  };
}

export async function createMaintenancePlan(
  context: OperationContext,
  input: CreateMaintenancePlanInput,
): Promise<{ code: string }> {
  assertPermission(context.session, "MAINTENANCE_PLAN_CREATE");
  await ensureDatabase();
  const now = operationNow(context);
  const calendar = requireCalendarConfig(input);
  const meterConfig = requireMeterConfig(input);
  const tasks = input.tasks
    .map((task) => ({ ...task, title: task.title.trim() }))
    .filter((task) => task.title.length > 0);
  if (!tasks.length) {
    throw new ApiContractError(
      422,
      "PLAN_TASKS_REQUIRED",
      "Añade al menos una tarea ejecutable al plan.",
    );
  }
  if (input.estimatedMinutes <= 0 || input.estimatedMinutes > 1_440) {
    throw new ApiContractError(
      422,
      "INVALID_ESTIMATED_DURATION",
      "La duración estimada debe estar entre 1 minuto y 24 horas.",
    );
  }
  const db = getD1();
  const asset = await db
    .prepare(
      `SELECT id, functional_location_id AS locationId, status
       FROM assets WHERE id = ? AND organization_id = ? AND site_id = ? LIMIT 1`,
    )
    .bind(input.assetId, context.session.organizationId, context.session.siteId)
    .first<{ id: string; locationId: string; status: string }>();
  if (!asset) {
    throw new ApiContractError(
      422,
      "INVALID_PLAN_ASSET",
      "Selecciona un activo del centro actual.",
    );
  }
  assertAssetAcceptsPlannedWork(asset.status);
  const owner = await db
    .prepare(
      `SELECT user.id FROM users user
       INNER JOIN memberships membership ON membership.user_id = user.id
       WHERE user.id = ? AND membership.organization_id = ?
         AND membership.status = 'ACTIVE' AND user.status = 'ACTIVE'
         AND membership.role_key IN ('MAINTENANCE_MANAGER','PLANNER','RELIABILITY_ENGINEER','SUPERVISOR')
       LIMIT 1`,
    )
    .bind(input.ownerId, context.session.organizationId)
    .first<{ id: string }>();
  if (!owner) {
    throw new ApiContractError(
      422,
      "INVALID_PLAN_OWNER",
      "Selecciona un responsable válido de la organización.",
    );
  }
  let meterValue: number | null = null;
  if (meterConfig) {
    const meter = await db
      .prepare(
        `SELECT id, last_value AS lastValue FROM meters
         WHERE id = ? AND organization_id = ? AND site_id = ?
           AND asset_id = ? AND status = 'ACTIVE' LIMIT 1`,
      )
      .bind(
        meterConfig.meterId,
        context.session.organizationId,
        context.session.siteId,
        asset.id,
      )
      .first<{ id: string; lastValue: number | null }>();
    if (!meter) {
      throw new ApiContractError(
        422,
        "INVALID_PLAN_METER",
        "El contador debe pertenecer al activo y centro seleccionados.",
      );
    }
    meterValue = meter.lastValue;
  }

  const uniqueSkillIds = [...new Set(input.skills.map((item) => item.skillId))];
  const uniqueCertificationIds = [...new Set(input.certificationIds)];
  const uniqueMaterialIds = [
    ...new Set(input.materials.map((item) => item.partId)),
  ];
  const [skillCount, certificationCount, materialCount] = await Promise.all([
    uniqueSkillIds.length
      ? db
          .prepare(
            `SELECT COUNT(*) AS count FROM skills
             WHERE organization_id = ? AND id IN (${uniqueSkillIds.map(() => "?").join(",")})`,
          )
          .bind(context.session.organizationId, ...uniqueSkillIds)
          .first<{ count: number }>()
      : Promise.resolve({ count: 0 }),
    uniqueCertificationIds.length
      ? db
          .prepare(
            `SELECT COUNT(*) AS count FROM certifications
             WHERE organization_id = ? AND id IN (${uniqueCertificationIds.map(() => "?").join(",")})`,
          )
          .bind(context.session.organizationId, ...uniqueCertificationIds)
          .first<{ count: number }>()
      : Promise.resolve({ count: 0 }),
    uniqueMaterialIds.length
      ? db
          .prepare(
            `SELECT COUNT(DISTINCT part.id) AS count FROM parts part
             INNER JOIN part_site_policies policy ON policy.part_id = part.id
             WHERE part.organization_id = ? AND policy.site_id = ?
               AND part.id IN (${uniqueMaterialIds.map(() => "?").join(",")})`,
          )
          .bind(
            context.session.organizationId,
            context.session.siteId,
            ...uniqueMaterialIds,
          )
          .first<{ count: number }>()
      : Promise.resolve({ count: 0 }),
  ]);
  if (Number(skillCount?.count ?? 0) !== uniqueSkillIds.length) {
    throw new ApiContractError(
      422,
      "INVALID_PLAN_SKILL",
      "Hay skills no válidas.",
    );
  }
  if (
    Number(certificationCount?.count ?? 0) !== uniqueCertificationIds.length
  ) {
    throw new ApiContractError(
      422,
      "INVALID_PLAN_CERTIFICATION",
      "Hay certificaciones no válidas.",
    );
  }
  if (Number(materialCount?.count ?? 0) !== uniqueMaterialIds.length) {
    throw new ApiContractError(
      422,
      "INVALID_PLAN_MATERIAL",
      "Hay materiales sin política MRO en el centro actual.",
    );
  }
  for (const item of input.skills) {
    if (
      !Number.isInteger(item.minimumLevel) ||
      item.minimumLevel < 1 ||
      item.minimumLevel > 5
    ) {
      throw new ApiContractError(
        422,
        "INVALID_SKILL_LEVEL",
        "El nivel mínimo de skill debe estar entre 1 y 5.",
      );
    }
  }
  for (const material of input.materials) {
    if (!Number.isFinite(material.quantity) || material.quantity <= 0) {
      throw new ApiContractError(
        422,
        "INVALID_PLAN_MATERIAL_QUANTITY",
        "Las cantidades previstas deben ser mayores que cero.",
      );
    }
  }

  const planId = operationId("pm");
  const code = await nextPlantNumber(context.session, "PM", now);
  const meterDue =
    meterConfig !== null &&
    meterValue !== null &&
    meterValue >= meterConfig.threshold;
  const nextDueAt = meterDue ? now : (calendar?.firstDueAt ?? null);
  const statements = [
    db
      .prepare(
        `INSERT INTO maintenance_plans
          (id, organization_id, site_id, asset_id, functional_location_id, owner_id,
           meter_id, code, title, description, criticality, priority, estimated_minutes,
           trigger_mode, calendar_unit, calendar_interval, calendar_anchor_at,
           calendar_next_at, meter_interval, meter_threshold, lead_days, status,
           last_executed_at, last_generated_at, next_due_at, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           'ACTIVE', NULL, NULL, ?, 1, ?, ?)`,
      )
      .bind(
        planId,
        context.session.organizationId,
        context.session.siteId,
        asset.id,
        asset.locationId,
        owner.id,
        meterConfig?.meterId ?? null,
        code,
        input.title.trim(),
        input.description.trim(),
        input.criticality,
        input.priority,
        input.estimatedMinutes,
        input.triggerMode,
        calendar?.unit ?? null,
        calendar?.interval ?? null,
        calendar?.firstDueAt ?? null,
        calendar?.firstDueAt ?? null,
        meterConfig?.interval ?? null,
        meterConfig?.threshold ?? null,
        input.leadDays,
        nextDueAt,
        now,
        now,
      ),
    ...tasks.map((task, index) =>
      db
        .prepare(
          `INSERT INTO maintenance_plan_tasks
            (id, maintenance_plan_id, sequence, title, description, required,
             response_type, unit, minimum_value, maximum_value, meter_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          operationId("pm-task"),
          planId,
          index + 1,
          task.title,
          task.description?.trim() || null,
          task.required === false ? 0 : 1,
          task.responseType ?? "CHECKBOX",
          task.unit?.trim() || null,
          task.minimumValue ?? null,
          task.maximumValue ?? null,
          task.meterId ?? null,
        ),
    ),
    ...input.skills.map((item) =>
      db
        .prepare(
          `INSERT INTO maintenance_plan_skills
            (id, maintenance_plan_id, skill_id, minimum_level) VALUES (?, ?, ?, ?)`,
        )
        .bind(operationId("pm-skill"), planId, item.skillId, item.minimumLevel),
    ),
    ...uniqueCertificationIds.map((certificationId) =>
      db
        .prepare(
          `INSERT INTO maintenance_plan_certifications
            (id, maintenance_plan_id, certification_id) VALUES (?, ?, ?)`,
        )
        .bind(operationId("pm-cert"), planId, certificationId),
    ),
    ...input.materials.map((item) =>
      db
        .prepare(
          `INSERT INTO maintenance_plan_materials
            (id, maintenance_plan_id, part_id, quantity) VALUES (?, ?, ?, ?)`,
        )
        .bind(operationId("pm-material"), planId, item.partId, item.quantity),
    ),
    db
      .prepare(
        `INSERT INTO audit_entries
          (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
           previous_value, new_value, request_id, created_at)
         VALUES (?, ?, ?, ?, 'MAINTENANCE_PLAN_CREATED', 'MAINTENANCE_PLAN', ?, NULL, ?, ?, ?)`,
      )
      .bind(
        operationId("audit"),
        context.session.organizationId,
        context.session.siteId,
        context.session.userId,
        planId,
        jsonValue({ code, triggerMode: input.triggerMode, status: "ACTIVE" }),
        context.requestId,
        now,
      ),
  ];
  const results = await db.batch(statements);
  assertMutationApplied(results[0]);
  return { code };
}

export async function generatePreventiveWorkOrder(
  context: OperationContext,
  code: string,
): Promise<{ created: boolean; number: string }> {
  assertPermission(context.session, "MAINTENANCE_PLAN_GENERATE");
  const plan = await findPlan(context.session, code);
  if (plan.status !== "ACTIVE") {
    throw new ApiContractError(
      409,
      "MAINTENANCE_PLAN_INACTIVE",
      "Activa el plan antes de generar una orden.",
    );
  }
  assertAssetAcceptsPlannedWork(plan.assetStatus);
  const now = operationNow(context);
  if (
    plan.lastGeneratedAt &&
    new Date(now).getTime() - new Date(plan.lastGeneratedAt).getTime() < 60_000
  ) {
    const latest = await getD1()
      .prepare(
        `SELECT number FROM work_orders
         WHERE maintenance_plan_id = ? AND created_at >= ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(plan.id, plan.lastGeneratedAt)
      .first<{ number: string }>();
    if (latest) return { created: false, number: latest.number };
  }
  const evaluation = evaluatePreventiveTrigger({
    mode: plan.triggerMode,
    now,
    calendarDueAt: plan.calendarNextAt,
    meterValue: plan.meterValue,
    meterThreshold: plan.meterThreshold,
  });
  const leadLimit = new Date(
    new Date(now).getTime() + plan.leadDays * 86_400_000,
  ).getTime();
  const calendarWithinLead =
    plan.triggerMode !== "METER" &&
    plan.calendarNextAt !== null &&
    new Date(plan.calendarNextAt).getTime() <= leadLimit;
  if (!evaluation.due && !calendarWithinLead) {
    throw new ApiContractError(
      409,
      "PREVENTIVE_NOT_DUE",
      "El plan aún no está dentro de su ventana de generación.",
    );
  }
  const windowKey = preventiveWindowKey({
    mode: plan.triggerMode,
    calendarDueAt: plan.calendarNextAt,
    meterThreshold: plan.meterThreshold,
    triggerReasons: evaluation.reasons,
  });
  const db = getD1();
  const existing = await db
    .prepare(
      `SELECT number FROM work_orders
       WHERE maintenance_plan_id = ?
         AND (maintenance_window_key = ? OR maintenance_window_key LIKE ?)
       LIMIT 1`,
    )
    .bind(
      plan.id,
      windowKey,
      windowKey.startsWith("CALENDAR:") ? `${windowKey}%` : windowKey,
    )
    .first<{ number: string }>();
  if (existing) return { created: false, number: existing.number };

  const [tasks, skills, certifications, materials] = await Promise.all([
    db
      .prepare(
        `SELECT id, sequence, title, description, required,
          response_type AS responseType, unit,
          minimum_value AS minimumValue, maximum_value AS maximumValue,
          meter_id AS meterId
         FROM maintenance_plan_tasks WHERE maintenance_plan_id = ? ORDER BY sequence`,
      )
      .bind(plan.id)
      .all<{
        id: string;
        sequence: number;
        title: string;
        description: string | null;
        required: number;
        responseType: string;
        unit: string | null;
        minimumValue: number | null;
        maximumValue: number | null;
        meterId: string | null;
      }>(),
    db
      .prepare(
        `SELECT skill_id AS skillId, minimum_level AS minimumLevel
         FROM maintenance_plan_skills WHERE maintenance_plan_id = ?`,
      )
      .bind(plan.id)
      .all<{ skillId: string; minimumLevel: number }>(),
    db
      .prepare(
        `SELECT certification_id AS certificationId
         FROM maintenance_plan_certifications WHERE maintenance_plan_id = ?`,
      )
      .bind(plan.id)
      .all<{ certificationId: string }>(),
    db
      .prepare(
        `SELECT material.part_id AS partId, material.quantity,
          (SELECT stock.bin_id FROM stock_levels stock
            WHERE stock.part_id = material.part_id AND stock.site_id = ?
            ORDER BY (stock.on_hand - stock.reserved) DESC, stock.updated_at DESC LIMIT 1) AS binId
         FROM maintenance_plan_materials material WHERE material.maintenance_plan_id = ?`,
      )
      .bind(context.session.siteId, plan.id)
      .all<{ partId: string; quantity: number; binId: string | null }>(),
  ]);
  const missingBin = (materials.results ?? []).find((item) => !item.binId);
  if (missingBin) {
    throw new ApiContractError(
      409,
      "PLANNED_MATERIAL_BIN_MISSING",
      "Un material previsto no tiene ubicación MRO en este centro.",
    );
  }

  const number = await nextPlantNumber(context.session, "OT", now);
  const orderId = operationId("wo");
  const nextTrigger = advancePreventiveTrigger({
    mode: plan.triggerMode,
    now,
    reasons: evaluation.reasons.length
      ? evaluation.reasons
      : plan.calendarNextAt
        ? ["CALENDAR"]
        : ["METER"],
    calendarNextAt: plan.calendarNextAt,
    calendarInterval: plan.calendarInterval,
    calendarUnit: plan.calendarUnit,
    meterValue: plan.meterValue,
    meterThreshold: plan.meterThreshold,
    meterInterval: plan.meterInterval,
  });
  const dueAt = nextTrigger.occurrenceDueAt;
  const plannedStart = dueAt;
  const plannedEnd = new Date(
    new Date(plannedStart).getTime() + plan.estimatedMinutes * 60_000,
  ).toISOString();
  const nextCalendarAt = nextTrigger.calendarNextAt;
  const nextMeterThreshold = nextTrigger.meterThreshold;
  const nextDueAt = nextTrigger.nextDueAt;
  const nextVersion = plan.version + 1;

  const statements = [
    db
      .prepare(
        `UPDATE maintenance_plans SET calendar_next_at = ?, meter_threshold = ?,
          next_due_at = ?, last_generated_at = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ? AND status = 'ACTIVE' AND version = ?`,
      )
      .bind(
        nextCalendarAt,
        nextMeterThreshold,
        nextDueAt,
        now,
        now,
        plan.id,
        context.session.organizationId,
        context.session.siteId,
        plan.version,
      ),
    db
      .prepare(
        `INSERT INTO work_orders
          (id, organization_id, site_id, asset_id, functional_location_id,
           requested_by_id, maintenance_plan_id, maintenance_window_key,
           preventive_due_at, number, title, description, status, priority, type,
           source, requested_at, due_at, planned_start, planned_end, actual_start,
           actual_end, completed_at, closed_at, cancelled_at, estimated_minutes,
           downtime_minutes, diagnosis, solution, failure_mode, failure_cause,
           production_impact, version, created_at, updated_at)
         SELECT ?, organization_id, site_id, asset_id, functional_location_id,
           owner_id, id, ?, ?, ?, title, description, 'PLANNED', priority,
           'PREVENTIVE', 'PLAN', ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL,
           estimated_minutes, 0, NULL, NULL, NULL, NULL, 'NONE', 1, ?, ?
         FROM maintenance_plans WHERE id = ? AND version = ?`,
      )
      .bind(
        orderId,
        windowKey,
        dueAt,
        number,
        now,
        dueAt,
        plannedStart,
        plannedEnd,
        now,
        now,
        plan.id,
        nextVersion,
      ),
    ...(tasks.results ?? []).map((task) =>
      db
        .prepare(
          `INSERT INTO work_order_tasks
            (id, work_order_id, source_task_id, sequence, title, description,
             required, response_type, unit, minimum_value, maximum_value,
             meter_id, response_value, response_status, responded_at,
             responded_by_id, completed_at, completed_by_id)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'PENDING',
             NULL, NULL, NULL, NULL
           FROM maintenance_plans WHERE id = ? AND version = ?`,
        )
        .bind(
          operationId("wo-task"),
          orderId,
          task.id,
          task.sequence,
          task.title,
          task.description,
          task.required,
          task.responseType,
          task.unit,
          task.minimumValue,
          task.maximumValue,
          task.meterId,
          plan.id,
          nextVersion,
        ),
    ),
    ...(skills.results ?? []).map((skill) =>
      db
        .prepare(
          `INSERT INTO work_order_skill_requirements
            (id, work_order_id, skill_id, minimum_level)
           SELECT ?, ?, ?, ? FROM maintenance_plans WHERE id = ? AND version = ?`,
        )
        .bind(
          operationId("wo-skill"),
          orderId,
          skill.skillId,
          skill.minimumLevel,
          plan.id,
          nextVersion,
        ),
    ),
    ...(certifications.results ?? []).map((certification) =>
      db
        .prepare(
          `INSERT INTO work_order_certification_requirements
            (id, work_order_id, certification_id)
           SELECT ?, ?, ? FROM maintenance_plans WHERE id = ? AND version = ?`,
        )
        .bind(
          operationId("wo-cert"),
          orderId,
          certification.certificationId,
          plan.id,
          nextVersion,
        ),
    ),
    ...(materials.results ?? []).map((material) =>
      db
        .prepare(
          `INSERT INTO work_order_materials
            (id, work_order_id, part_id, bin_id, planned_quantity,
             reserved_quantity, consumed_quantity, returned_quantity,
             created_by_id, version, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, 0, 0, 0, ?, 1, ?, ?
           FROM maintenance_plans WHERE id = ? AND version = ?`,
        )
        .bind(
          operationId("wo-material"),
          orderId,
          material.partId,
          material.binId,
          material.quantity,
          context.session.userId,
          now,
          now,
          plan.id,
          nextVersion,
        ),
    ),
    db
      .prepare(
        `INSERT INTO work_order_events
          (id, work_order_id, actor_id, event_type, from_status, to_status, note, created_at)
         SELECT ?, ?, ?, 'PREVENTIVE_WORK_ORDER_GENERATED', NULL, 'PLANNED', ?, ?
         FROM maintenance_plans WHERE id = ? AND version = ?`,
      )
      .bind(
        operationId("wo-event"),
        orderId,
        context.session.userId,
        `Generada desde ${plan.code}.`,
        now,
        plan.id,
        nextVersion,
      ),
    db
      .prepare(
        `INSERT INTO audit_entries
          (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
           previous_value, new_value, request_id, created_at)
         SELECT ?, organization_id, site_id, ?, 'PREVENTIVE_WORK_ORDER_GENERATED',
           'MAINTENANCE_PLAN', id, ?, ?, ?, ?
         FROM maintenance_plans WHERE id = ? AND version = ?`,
      )
      .bind(
        operationId("audit"),
        context.session.userId,
        jsonValue({ lastGeneratedAt: plan.nextDueAt, version: plan.version }),
        jsonValue({ workOrderId: orderId, number, windowKey }),
        context.requestId,
        now,
        plan.id,
        nextVersion,
      ),
  ];
  let results: D1Result<unknown>[];
  try {
    results = await db.batch(statements);
  } catch (error) {
    const concurrent = await db
      .prepare(
        `SELECT number FROM work_orders
         WHERE maintenance_plan_id = ? AND maintenance_window_key = ? LIMIT 1`,
      )
      .bind(plan.id, windowKey)
      .first<{ number: string }>();
    if (concurrent) return { created: false, number: concurrent.number };
    throw error;
  }
  assertMutationApplied(results[0]);
  assertMutationApplied(
    results[1],
    "No se ha podido materializar la orden preventiva.",
  );
  return { created: true, number };
}

export async function setMaintenancePlanStatus(
  context: OperationContext,
  code: string,
  status: "ACTIVE" | "INACTIVE",
  expectedVersion: number,
): Promise<void> {
  assertPermission(context.session, "MAINTENANCE_PLAN_MANAGE");
  const plan = await findPlan(context.session, code);
  if (plan.version !== expectedVersion) {
    throw new ApiContractError(
      409,
      "CONCURRENT_MODIFICATION",
      "El plan ha cambiado en otra sesión. Actualiza y reintenta.",
    );
  }
  if (plan.status === status) return;
  const now = operationNow(context);
  const db = getD1();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE maintenance_plans SET status = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ? AND version = ?`,
      )
      .bind(
        status,
        now,
        plan.id,
        context.session.organizationId,
        context.session.siteId,
        expectedVersion,
      ),
    db
      .prepare(
        `INSERT INTO audit_entries
          (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
           previous_value, new_value, request_id, created_at)
         SELECT ?, organization_id, site_id, ?, 'MAINTENANCE_PLAN_STATUS_CHANGED',
           'MAINTENANCE_PLAN', id, ?, ?, ?, ?
         FROM maintenance_plans WHERE id = ? AND version = ?`,
      )
      .bind(
        operationId("audit"),
        context.session.userId,
        jsonValue({ status: plan.status }),
        jsonValue({ status }),
        context.requestId,
        now,
        plan.id,
        expectedVersion + 1,
      ),
  ]);
  assertMutationApplied(results[0]);
}

export async function recordMeterReading(
  context: OperationContext,
  meterId: string,
  input: { value: number; recordedAt: string; note?: string | null },
): Promise<{ duePlanCodes: string[] }> {
  assertPermission(context.session, "METER_RECORD");
  await ensureDatabase();
  const db = getD1();
  const meter = await db
    .prepare(
      `SELECT id, code, reading_type AS readingType, last_value AS lastValue,
        last_reading_at AS lastReadingAt, version
       FROM meters WHERE id = ? AND organization_id = ? AND site_id = ?
         AND status = 'ACTIVE' LIMIT 1`,
    )
    .bind(meterId, context.session.organizationId, context.session.siteId)
    .first<{
      id: string;
      code: string;
      readingType: "CUMULATIVE" | "GAUGE";
      lastValue: number | null;
      lastReadingAt: string | null;
      version: number;
    }>();
  if (!meter) {
    throw new ApiContractError(
      404,
      "METER_NOT_FOUND",
      "El contador no existe en el centro activo.",
    );
  }
  assertValidMeterReading({
    readingAt: input.recordedAt,
    value: input.value,
    previousValue: meter.lastValue,
    previousReadingAt: meter.lastReadingAt,
    cumulative: meter.readingType === "CUMULATIVE",
  });
  const now = operationNow(context);
  const nextVersion = meter.version + 1;
  const results = await db.batch([
    db
      .prepare(
        `UPDATE meters SET last_value = ?, last_reading_at = ?,
          version = version + 1, updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ? AND version = ?`,
      )
      .bind(
        input.value,
        input.recordedAt,
        now,
        meter.id,
        context.session.organizationId,
        context.session.siteId,
        meter.version,
      ),
    db
      .prepare(
        `INSERT INTO meter_readings
          (id, meter_id, recorded_by_id, value, recorded_at, source, note, created_at)
         SELECT ?, id, ?, ?, ?, 'MANUAL', ?, ? FROM meters WHERE id = ? AND version = ?`,
      )
      .bind(
        operationId("meter-reading"),
        context.session.userId,
        input.value,
        input.recordedAt,
        input.note?.trim() || null,
        now,
        meter.id,
        nextVersion,
      ),
    db
      .prepare(
        `UPDATE maintenance_plans SET
          next_due_at = CASE
            WHEN trigger_mode = 'METER' THEN ?
            WHEN calendar_next_at IS NULL OR calendar_next_at > ? THEN ?
            ELSE calendar_next_at END,
          version = version + 1, updated_at = ?
         WHERE meter_id = ? AND organization_id = ? AND site_id = ?
           AND status = 'ACTIVE' AND meter_threshold IS NOT NULL
           AND meter_threshold <= ?`,
      )
      .bind(
        input.recordedAt,
        input.recordedAt,
        input.recordedAt,
        now,
        meter.id,
        context.session.organizationId,
        context.session.siteId,
        input.value,
      ),
    db
      .prepare(
        `INSERT INTO audit_entries
          (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
           previous_value, new_value, request_id, created_at)
         SELECT ?, organization_id, site_id, ?, 'METER_READING_RECORDED', 'METER', id,
           ?, ?, ?, ? FROM meters WHERE id = ? AND version = ?`,
      )
      .bind(
        operationId("audit"),
        context.session.userId,
        jsonValue({ value: meter.lastValue, recordedAt: meter.lastReadingAt }),
        jsonValue({ value: input.value, recordedAt: input.recordedAt }),
        context.requestId,
        now,
        meter.id,
        nextVersion,
      ),
  ]);
  assertMutationApplied(results[0]);
  assertMutationApplied(results[1], "No se ha podido registrar la lectura.");
  const due = await db
    .prepare(
      `SELECT code FROM maintenance_plans
       WHERE meter_id = ? AND organization_id = ? AND site_id = ?
         AND status = 'ACTIVE' AND meter_threshold IS NOT NULL
         AND meter_threshold <= ? ORDER BY code`,
    )
    .bind(
      meter.id,
      context.session.organizationId,
      context.session.siteId,
      input.value,
    )
    .all<{ code: string }>();
  return { duePlanCodes: (due.results ?? []).map((item) => item.code) };
}
