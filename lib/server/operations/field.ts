import { getD1 } from "@/db";
import {
  assertEvidenceInput,
  assertHandover,
  evaluateChecklistResponse,
  evaluateMeasurement,
  type ChecklistResponseType,
} from "@/lib/domain/field";
import { assertPermission } from "@/lib/domain/permissions";
import { sanitizeEvidenceFileName } from "@/lib/domain/evidence-policy";
import { ApiContractError } from "@/lib/server/http";
import {
  assertLocationScope,
  jsonValue,
  operationId,
  operationNow,
  type OperationContext,
} from "./shared";

type FieldOrder = {
  id: string;
  number: string;
  status: string;
  assetId: string;
  safetyLevel: string;
  safetySummary: string | null;
  ppeRequired: string | null;
  precautions: string | null;
  isolationRequired: number;
  functionalLocationId: string;
};

async function findFieldOrder(
  context: OperationContext,
  number: string,
): Promise<FieldOrder> {
  const order = await getD1()
    .prepare(
      `SELECT work_order.id, work_order.number, work_order.status,
        work_order.asset_id AS assetId,
        work_order.functional_location_id AS functionalLocationId,
        work_order.safety_level AS safetyLevel,
        work_order.safety_summary AS safetySummary,
        work_order.ppe_required AS ppeRequired, work_order.precautions,
        work_order.isolation_required AS isolationRequired
       FROM work_orders work_order
       WHERE work_order.number = ? AND work_order.organization_id = ?
         AND work_order.site_id = ?
       LIMIT 1`,
    )
    .bind(number, context.session.organizationId, context.session.siteId)
    .first<FieldOrder>();
  if (!order) {
    throw new ApiContractError(
      404,
      "WORK_ORDER_NOT_FOUND",
      "La orden no existe en el centro activo.",
    );
  }
  if (!order.assetId) {
    throw new ApiContractError(
      409,
      "WORK_ORDER_ASSET_REQUIRED",
      "La operación de campo requiere un activo identificado.",
    );
  }
  await assertLocationScope(context.session, order.functionalLocationId);
  if (["CLOSED", "CANCELLED"].includes(order.status)) {
    throw new ApiContractError(
      409,
      "WORK_ORDER_NOT_FIELD_EDITABLE",
      "La orden ya no admite registros de campo.",
    );
  }
  if (context.session.roleKey === "TECHNICIAN") {
    const assignment = await getD1()
      .prepare(
        `SELECT id FROM work_order_assignments
         WHERE work_order_id = ? AND user_id = ? AND unassigned_at IS NULL
         LIMIT 1`,
      )
      .bind(order.id, context.session.userId)
      .first<{ id: string }>();
    if (!assignment) {
      throw new ApiContractError(
        403,
        "WORK_ORDER_NOT_ASSIGNED",
        "Solo puedes registrar datos en trabajos que tienes asignados.",
      );
    }
  }
  return order;
}

function workOrderEvent(
  db: D1Database,
  context: OperationContext,
  orderId: string,
  eventType: string,
  note: string,
  now: string,
) {
  return db
    .prepare(
      `INSERT INTO work_order_events
        (id, work_order_id, actor_id, event_type, from_status, to_status, note, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
    )
    .bind(
      operationId("wo-event"),
      orderId,
      context.session.userId,
      eventType,
      note,
      now,
    );
}

function fieldAudit(
  db: D1Database,
  context: OperationContext,
  orderId: string,
  action: string,
  newValue: unknown,
  now: string,
) {
  return db
    .prepare(
      `INSERT INTO audit_entries
        (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
         previous_value, new_value, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'WORK_ORDER', ?, NULL, ?, ?, ?)`,
    )
    .bind(
      operationId("audit"),
      context.session.organizationId,
      context.session.siteId,
      context.session.userId,
      action,
      orderId,
      jsonValue(newValue),
      context.requestId,
      now,
    );
}

export async function acknowledgeWorkOrderSafety(
  context: OperationContext,
  number: string,
): Promise<void> {
  assertPermission(context.session, "FIELD_SAFETY_ACKNOWLEDGE");
  const order = await findFieldOrder(context, number);
  const now = operationNow(context);
  const snapshot = jsonValue({
    level: order.safetyLevel,
    summary: order.safetySummary,
    ppeRequired: order.ppeRequired,
    precautions: order.precautions,
    isolationRequired: Boolean(order.isolationRequired),
  });
  const db = getD1();
  await db.batch([
    db
      .prepare(
        `INSERT INTO work_order_safety_acknowledgements
          (id, work_order_id, user_id, acknowledged_at, safety_snapshot)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(work_order_id, user_id) DO UPDATE SET
           acknowledged_at = excluded.acknowledged_at,
           safety_snapshot = excluded.safety_snapshot`,
      )
      .bind(
        operationId("safety-ack"),
        order.id,
        context.session.userId,
        now,
        snapshot,
      ),
    workOrderEvent(
      db,
      context,
      order.id,
      "SAFETY_ACKNOWLEDGED",
      "Avisos de seguridad revisados antes de la intervención.",
      now,
    ),
    fieldAudit(
      db,
      context,
      order.id,
      "SAFETY_ACKNOWLEDGED",
      { safetyLevel: order.safetyLevel, acknowledgedAt: now },
      now,
    ),
  ]);
}

export async function answerChecklistTask(
  context: OperationContext,
  number: string,
  input: { taskId: string; value: string | number | boolean },
): Promise<{ status: string; satisfiesRequirement: boolean }> {
  assertPermission(context.session, "FIELD_CHECKLIST");
  const order = await findFieldOrder(context, number);
  const task = await getD1()
    .prepare(
      `SELECT id, title, required, response_type AS responseType,
        minimum_value AS minimumValue, maximum_value AS maximumValue
       FROM work_order_tasks WHERE id = ? AND work_order_id = ? LIMIT 1`,
    )
    .bind(input.taskId, order.id)
    .first<{
      id: string;
      title: string;
      required: number;
      responseType: ChecklistResponseType;
      minimumValue: number | null;
      maximumValue: number | null;
    }>();
  if (!task) {
    throw new ApiContractError(
      404,
      "CHECKLIST_TASK_NOT_FOUND",
      "El paso no pertenece a esta orden.",
    );
  }
  const result = evaluateChecklistResponse({
    type: task.responseType,
    value: input.value,
    required: Boolean(task.required),
    minimumValue: task.minimumValue,
    maximumValue: task.maximumValue,
  });
  const now = operationNow(context);
  const db = getD1();
  await db.batch([
    db
      .prepare(
        `UPDATE work_order_tasks SET response_value = ?, response_status = ?,
          responded_at = ?, responded_by_id = ?, completed_at = ?,
          completed_by_id = ? WHERE id = ? AND work_order_id = ?`,
      )
      .bind(
        result.value,
        result.status,
        now,
        context.session.userId,
        result.satisfiesRequirement ? now : null,
        result.satisfiesRequirement ? context.session.userId : null,
        task.id,
        order.id,
      ),
    workOrderEvent(
      db,
      context,
      order.id,
      "CHECKLIST_TASK_RECORDED",
      `${task.title}: ${result.status === "FAIL" ? "no conforme" : "registrado"}.`,
      now,
    ),
    fieldAudit(
      db,
      context,
      order.id,
      "CHECKLIST_TASK_RECORDED",
      {
        taskId: task.id,
        value: result.value,
        status: result.status,
      },
      now,
    ),
  ]);
  return result;
}

export async function recordWorkOrderMeasurement(
  context: OperationContext,
  number: string,
  input: {
    taskId?: string | null;
    meterId?: string | null;
    label: string;
    unit: string;
    value: number;
    minimumValue?: number | null;
    maximumValue?: number | null;
    recordedAt?: string;
    note?: string | null;
  },
): Promise<{ id: string; result: string; meterReadingId: string | null }> {
  assertPermission(context.session, "METER_RECORD");
  const order = await findFieldOrder(context, number);
  const db = getD1();
  const task = input.taskId
    ? await db
        .prepare(
          `SELECT id, unit, minimum_value AS minimumValue,
            maximum_value AS maximumValue, meter_id AS meterId
           FROM work_order_tasks WHERE id = ? AND work_order_id = ? LIMIT 1`,
        )
        .bind(input.taskId, order.id)
        .first<{
          id: string;
          unit: string | null;
          minimumValue: number | null;
          maximumValue: number | null;
          meterId: string | null;
        }>()
    : null;
  if (input.taskId && !task) {
    throw new ApiContractError(
      404,
      "CHECKLIST_TASK_NOT_FOUND",
      "La tarea de medición no pertenece a esta orden.",
    );
  }
  const meterId = input.meterId ?? task?.meterId ?? null;
  const meter = meterId
    ? await db
        .prepare(
          `SELECT id, unit, reading_type AS readingType, last_value AS lastValue,
            last_reading_at AS lastReadingAt, version
           FROM meters WHERE id = ? AND asset_id = ? AND organization_id = ?
             AND site_id = ? AND status = 'ACTIVE' LIMIT 1`,
        )
        .bind(
          meterId,
          order.assetId,
          context.session.organizationId,
          context.session.siteId,
        )
        .first<{
          id: string;
          unit: string;
          readingType: "CUMULATIVE" | "GAUGE";
          lastValue: number | null;
          lastReadingAt: string | null;
          version: number;
        }>()
    : null;
  if (meterId && !meter) {
    throw new ApiContractError(
      422,
      "INVALID_WORK_ORDER_METER",
      "El contador no pertenece al activo de esta orden.",
    );
  }
  const minimumValue = input.minimumValue ?? task?.minimumValue ?? null;
  const maximumValue = input.maximumValue ?? task?.maximumValue ?? null;
  const result = evaluateMeasurement({
    value: input.value,
    unit: input.unit,
    expectedUnit: meter?.unit ?? task?.unit,
    minimumValue,
    maximumValue,
  });
  const recordedAt = input.recordedAt ?? operationNow(context);
  if (!Number.isFinite(new Date(recordedAt).getTime())) {
    throw new ApiContractError(
      422,
      "INVALID_MEASUREMENT_TIME",
      "La fecha de la medición no es válida.",
    );
  }
  if (
    meter?.readingType === "CUMULATIVE" &&
    meter.lastValue != null &&
    input.value < Number(meter.lastValue)
  ) {
    throw new ApiContractError(
      409,
      "METER_READING_REGRESSION",
      "Una lectura acumulativa no puede retroceder.",
    );
  }
  if (meter?.lastReadingAt && recordedAt <= meter.lastReadingAt) {
    throw new ApiContractError(
      409,
      "METER_READING_TIME_REGRESSION",
      "La lectura debe ser posterior a la última registrada.",
    );
  }
  const now = operationNow(context);
  const measurementId = operationId("measurement");
  const meterReadingId = meter ? operationId("meter-reading") : null;
  const statements: D1PreparedStatement[] = [];
  if (meter) {
    statements.push(
      db
        .prepare(
          `UPDATE meters SET last_value = ?, last_reading_at = ?,
            version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .bind(input.value, recordedAt, now, meter.id, meter.version),
      db
        .prepare(
          `INSERT INTO meter_readings
            (id, meter_id, recorded_by_id, value, recorded_at, source, note, created_at)
           SELECT ?, id, ?, ?, ?, 'MANUAL', ?, ? FROM meters
           WHERE id = ? AND version = ?`,
        )
        .bind(
          meterReadingId,
          context.session.userId,
          input.value,
          recordedAt,
          `OT ${order.number}${input.note?.trim() ? ` · ${input.note.trim()}` : ""}`,
          now,
          meter.id,
          meter.version + 1,
        ),
    );
  }
  if (task) {
    const checklistStatus =
      result === "IN_RANGE"
        ? "PASS"
        : result === "OUT_OF_RANGE"
          ? "FAIL"
          : "COMPLETED";
    statements.push(
      db
        .prepare(
          `UPDATE work_order_tasks SET response_value = ?, response_status = ?,
            responded_at = ?, responded_by_id = ?, completed_at = ?,
            completed_by_id = ? WHERE id = ? AND work_order_id = ?`,
        )
        .bind(
          String(input.value),
          checklistStatus,
          recordedAt,
          context.session.userId,
          checklistStatus === "FAIL" ? null : recordedAt,
          checklistStatus === "FAIL" ? null : context.session.userId,
          task.id,
          order.id,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO work_order_measurements
          (id, organization_id, site_id, work_order_id, task_id, asset_id,
           meter_id, meter_reading_id, label, unit, value, minimum_value,
           maximum_value, result, note, recorded_by_id, recorded_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        measurementId,
        context.session.organizationId,
        context.session.siteId,
        order.id,
        task?.id ?? null,
        order.assetId,
        meter?.id ?? null,
        meterReadingId,
        input.label.trim(),
        input.unit.trim(),
        input.value,
        minimumValue,
        maximumValue,
        result,
        input.note?.trim() || null,
        context.session.userId,
        recordedAt,
        now,
      ),
    workOrderEvent(
      db,
      context,
      order.id,
      "MEASUREMENT_RECORDED",
      `${input.label.trim()}: ${input.value} ${input.unit.trim()} · ${result}.`,
      now,
    ),
    fieldAudit(
      db,
      context,
      order.id,
      "MEASUREMENT_RECORDED",
      {
        measurementId,
        value: input.value,
        unit: input.unit.trim(),
        result,
        meterId: meter?.id ?? null,
      },
      now,
    ),
  );
  if (result === "OUT_OF_RANGE") {
    const notificationPrefix = operationId("notification");
    statements.push(
      db
        .prepare(
          `INSERT INTO notifications
            (id, organization_id, site_id, user_id, title, body, severity,
             entity_type, entity_id, read_at, created_at)
           SELECT ? || '-' || membership.user_id, ?, ?, membership.user_id,
             'Medición fuera de rango', ?, 'WARNING', 'WORK_ORDER', ?, NULL, ?
           FROM memberships membership
           WHERE membership.organization_id = ? AND membership.status = 'ACTIVE'
             AND membership.role_key IN ('MAINTENANCE_MANAGER','SUPERVISOR')`,
        )
        .bind(
          notificationPrefix,
          context.session.organizationId,
          context.session.siteId,
          `${order.number} · ${input.label.trim()}: ${input.value} ${input.unit.trim()}.`,
          order.id,
          now,
          context.session.organizationId,
        ),
    );
  }
  await db.batch(statements);
  return { id: measurementId, result, meterReadingId };
}

export async function createEvidenceMetadata(
  context: OperationContext,
  number: string,
  input: {
    id: string;
    kind: "PHOTO" | "DOCUMENT" | "NOTE";
    stage: "BEFORE" | "DURING" | "AFTER" | "GENERAL";
    description: string;
    storageKey?: string | null;
    fileName?: string | null;
    contentType?: string | null;
    sizeBytes?: number | null;
    checksumSha256?: string | null;
  },
): Promise<void> {
  assertPermission(context.session, "FIELD_EVIDENCE");
  const order = await findFieldOrder(context, number);
  assertEvidenceInput(input);
  const now = operationNow(context);
  const retentionUntil = new Date(
    new Date(now).getTime() + 5 * 365 * 86_400_000,
  ).toISOString();
  const db = getD1();
  await db.batch([
    db
      .prepare(
        `INSERT INTO evidence_items
          (id, organization_id, site_id, work_order_id, incident_id, asset_id,
           root_cause_analysis_id, author_id, kind, stage, description,
           storage_provider, storage_key, file_name, safe_file_name, content_type,
           size_bytes, checksum_sha256, retention_until, scan_status, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_CONFIGURED', ?)`,
      )
      .bind(
        input.id,
        context.session.organizationId,
        context.session.siteId,
        order.id,
        order.assetId,
        context.session.userId,
        input.kind,
        input.stage,
        input.description.trim(),
        input.kind === "NOTE" ? "NONE" : "R2",
        input.storageKey ?? null,
        input.fileName ?? null,
        input.fileName ? sanitizeEvidenceFileName(input.fileName) : null,
        input.contentType ?? null,
        input.sizeBytes ?? null,
        input.checksumSha256 ?? null,
        retentionUntil,
        now,
      ),
    workOrderEvent(
      db,
      context,
      order.id,
      "EVIDENCE_ADDED",
      `${input.kind === "NOTE" ? "Nota" : "Evidencia"} ${input.stage.toLowerCase()} añadida: ${input.description.trim()}.`,
      now,
    ),
    fieldAudit(
      db,
      context,
      order.id,
      "EVIDENCE_ADDED",
      {
        evidenceId: input.id,
        kind: input.kind,
        stage: input.stage,
      },
      now,
    ),
  ]);
}

export async function createShiftHandover(
  context: OperationContext,
  input: {
    fromShift: string;
    toShift: string;
    summary: string;
    risks?: string | null;
    partsPending?: string | null;
    workOrderNumbers: string[];
  },
): Promise<{ id: string }> {
  assertPermission(context.session, "SHIFT_HANDOVER_CREATE");
  assertHandover(input);
  const uniqueNumbers = [...new Set(input.workOrderNumbers)].slice(0, 12);
  const placeholders = uniqueNumbers.map(() => "?").join(",");
  const orders = uniqueNumbers.length
    ? await getD1()
        .prepare(
          `SELECT work_order.id, work_order.number, work_order.status
           FROM work_orders work_order
           WHERE work_order.organization_id = ? AND work_order.site_id = ?
             AND work_order.number IN (${placeholders})
             ${context.session.roleKey === "TECHNICIAN" ? "AND EXISTS (SELECT 1 FROM work_order_assignments assignment WHERE assignment.work_order_id = work_order.id AND assignment.user_id = ? AND assignment.unassigned_at IS NULL)" : ""}`,
        )
        .bind(
          context.session.organizationId,
          context.session.siteId,
          ...uniqueNumbers,
          ...(context.session.roleKey === "TECHNICIAN"
            ? [context.session.userId]
            : []),
        )
        .all<{ id: string; number: string; status: string }>()
    : { results: [] as Array<{ id: string; number: string; status: string }> };
  if ((orders.results ?? []).length !== uniqueNumbers.length) {
    throw new ApiContractError(
      422,
      "INVALID_HANDOVER_WORK_ORDER",
      "Alguna orden no pertenece al técnico o al centro activo.",
    );
  }
  const now = operationNow(context);
  const handoverId = operationId("handover");
  const db = getD1();
  await db.batch([
    db
      .prepare(
        `INSERT INTO shift_handovers
          (id, organization_id, site_id, author_id, from_shift, to_shift,
           summary, risks, parts_pending, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        handoverId,
        context.session.organizationId,
        context.session.siteId,
        context.session.userId,
        input.fromShift.trim(),
        input.toShift.trim(),
        input.summary.trim(),
        input.risks?.trim() || null,
        input.partsPending?.trim() || null,
        now,
      ),
    ...(orders.results ?? []).flatMap((order) => [
      db
        .prepare(
          `INSERT INTO shift_handover_work_orders
            (id, handover_id, work_order_id, status_snapshot, note)
           VALUES (?, ?, ?, ?, NULL)`,
        )
        .bind(operationId("handover-work"), handoverId, order.id, order.status),
      workOrderEvent(
        db,
        context,
        order.id,
        "SHIFT_HANDOVER_RECORDED",
        `Incluida en relevo ${input.fromShift.trim()} → ${input.toShift.trim()}.`,
        now,
      ),
    ]),
    db
      .prepare(
        `INSERT INTO audit_entries
          (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
           previous_value, new_value, request_id, created_at)
         VALUES (?, ?, ?, ?, 'SHIFT_HANDOVER_CREATED', 'SHIFT_HANDOVER', ?, NULL, ?, ?, ?)`,
      )
      .bind(
        operationId("audit"),
        context.session.organizationId,
        context.session.siteId,
        context.session.userId,
        handoverId,
        jsonValue({
          fromShift: input.fromShift,
          toShift: input.toShift,
          workOrders: uniqueNumbers,
        }),
        context.requestId,
        now,
      ),
    db
      .prepare(
        `INSERT INTO notifications
          (id, organization_id, site_id, user_id, title, body, severity,
           entity_type, entity_id, read_at, created_at)
         SELECT ? || '-' || profile.user_id, ?, ?, profile.user_id,
           'Relevo de turno disponible', ?, 'INFO', 'SHIFT_HANDOVER', ?, NULL, ?
         FROM workforce_profiles profile
         WHERE profile.organization_id = ? AND profile.site_id = ?
           AND profile.shift_code = ? AND profile.user_id <> ?`,
      )
      .bind(
        operationId("notification"),
        context.session.organizationId,
        context.session.siteId,
        input.summary.trim(),
        handoverId,
        now,
        context.session.organizationId,
        context.session.siteId,
        input.toShift.trim(),
        context.session.userId,
      ),
  ]);
  return { id: handoverId };
}
