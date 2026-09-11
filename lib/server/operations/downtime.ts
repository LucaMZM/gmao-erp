import { getD1 } from "@/db";
import {
  assertDowntimeImpact,
  calculateDowntimeMinutes,
} from "@/lib/domain/downtime";
import { assertPermission } from "@/lib/domain/permissions";
import { ApiContractError } from "@/lib/server/http";
import {
  atomicBatch,
  assertMutationApplied,
  assertLocationScope,
  jsonValue,
  operationId,
  operationNow,
  type OperationContext,
} from "./shared";

type DowntimeOrder = {
  id: string;
  number: string;
  status: string;
  assetId: string | null;
  functionalLocationId: string;
};

async function findOrder(
  context: OperationContext,
  number: string,
): Promise<DowntimeOrder> {
  const row = await getD1()
    .prepare(
      `SELECT id, number, status, asset_id AS assetId,
        functional_location_id AS functionalLocationId
       FROM work_orders WHERE number = ? AND organization_id = ? AND site_id = ? LIMIT 1`,
    )
    .bind(number, context.session.organizationId, context.session.siteId)
    .first<DowntimeOrder>();
  if (!row) {
    throw new ApiContractError(
      404,
      "WORK_ORDER_NOT_FOUND",
      "La orden no existe en el centro activo.",
    );
  }
  if (!row.assetId) {
    throw new ApiContractError(
      409,
      "DOWNTIME_REQUIRES_ASSET",
      "Identifica el activo antes de registrar downtime.",
    );
  }
  await assertLocationScope(context.session, row.functionalLocationId);
  if (context.session.roleKey === "TECHNICIAN") {
    const assigned = await getD1()
      .prepare(
        "SELECT id FROM work_order_assignments WHERE work_order_id = ? AND user_id = ? AND unassigned_at IS NULL",
      )
      .bind(row.id, context.session.userId)
      .first();
    if (!assigned)
      throw new ApiContractError(
        403,
        "TECHNICIAN_NOT_ASSIGNED",
        "Solo puedes registrar downtime en trabajos asignados.",
      );
  }
  if (["COMPLETED", "CLOSED", "CANCELLED"].includes(row.status)) {
    throw new ApiContractError(
      409,
      "FINAL_WORK_ORDER",
      "No se inicia downtime en una orden finalizada.",
    );
  }
  return row;
}

export async function startDowntime(
  context: OperationContext,
  number: string,
  input: {
    startedAt?: string;
    kind: "PLANNED" | "UNPLANNED";
    productionImpact: string;
    cause?: string | null;
  },
): Promise<{ id: string }> {
  assertPermission(context.session, "DOWNTIME_MANAGE");
  assertDowntimeImpact(input.productionImpact);
  const order = await findOrder(context, number);
  const existing = await getD1()
    .prepare(
      "SELECT id FROM downtime_events WHERE work_order_id = ? AND ended_at IS NULL LIMIT 1",
    )
    .bind(order.id)
    .first<{ id: string }>();
  if (existing) {
    throw new ApiContractError(
      409,
      "ACTIVE_DOWNTIME_EXISTS",
      "La orden ya tiene un downtime activo.",
    );
  }
  const now = operationNow(context);
  const startedAt = input.startedAt ?? now;
  if (!Number.isFinite(new Date(startedAt).getTime())) {
    throw new ApiContractError(
      422,
      "INVALID_DOWNTIME_START",
      "La fecha de inicio de downtime no es válida.",
    );
  }
  const id = operationId("downtime");
  const db = getD1();
  await atomicBatch(db, [
    db
      .prepare(
        `INSERT INTO downtime_events
          (id, organization_id, site_id, asset_id, work_order_id,
           functional_location_id, created_by_id, ended_by_id,
           started_at, ended_at, duration_minutes, kind, production_impact,
           cause, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, 0, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        context.session.organizationId,
        context.session.siteId,
        order.assetId,
        order.id,
        order.functionalLocationId,
        context.session.userId,
        startedAt,
        input.kind,
        input.productionImpact,
        input.cause ?? null,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO work_order_events
          (id, work_order_id, actor_id, event_type, from_status, to_status, note, created_at)
         VALUES (?, ?, ?, 'DOWNTIME_STARTED', NULL, NULL, ?, ?)`,
      )
      .bind(
        operationId("wo-event"),
        order.id,
        context.session.userId,
        `Downtime iniciado · ${input.productionImpact}.`,
        now,
      ),
    db
      .prepare(
        `INSERT INTO audit_entries
          (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
           previous_value, new_value, request_id, created_at)
         VALUES (?, ?, ?, ?, 'DOWNTIME_STARTED', 'DOWNTIME', ?, NULL, ?, ?, ?)`,
      )
      .bind(
        operationId("audit"),
        context.session.organizationId,
        context.session.siteId,
        context.session.userId,
        id,
        jsonValue({ workOrderId: order.id, startedAt, ...input }),
        context.requestId,
        now,
      ),
  ]);
  return { id };
}

export async function endDowntime(
  context: OperationContext,
  number: string,
  downtimeId: string,
  endedAt?: string,
): Promise<void> {
  assertPermission(context.session, "DOWNTIME_MANAGE");
  const order = await findOrder(context, number);
  const downtime = await getD1()
    .prepare(
      `SELECT id, started_at AS startedAt, production_impact AS productionImpact
       FROM downtime_events
       WHERE id = ? AND work_order_id = ? AND organization_id = ? AND site_id = ?
         AND ended_at IS NULL LIMIT 1`,
    )
    .bind(
      downtimeId,
      order.id,
      context.session.organizationId,
      context.session.siteId,
    )
    .first<{ id: string; startedAt: string; productionImpact: string }>();
  if (!downtime) {
    throw new ApiContractError(
      404,
      "ACTIVE_DOWNTIME_NOT_FOUND",
      "El downtime ya no está activo.",
    );
  }
  const now = operationNow(context);
  const end = endedAt ?? now;
  const minutes = calculateDowntimeMinutes(downtime.startedAt, end);
  const db = getD1();
  const results = await atomicBatch(
    db,
    [
      db
        .prepare(
          `UPDATE downtime_events SET ended_at = ?, duration_minutes = ?,
          ended_by_id = ?, updated_at = ?
         WHERE id = ? AND work_order_id = ? AND ended_at IS NULL`,
        )
        .bind(end, minutes, context.session.userId, now, downtime.id, order.id),
      db
        .prepare(
          `UPDATE work_orders SET downtime_minutes = (
           SELECT COALESCE(SUM(duration_minutes), 0) FROM downtime_events
           WHERE work_order_id = ? AND ended_at IS NOT NULL
         ), updated_at = ?
         WHERE id = ? AND organization_id = ? AND site_id = ?
           AND EXISTS (SELECT 1 FROM downtime_events WHERE id = ? AND ended_at = ?)`,
        )
        .bind(
          order.id,
          now,
          order.id,
          context.session.organizationId,
          context.session.siteId,
          downtime.id,
          end,
        ),
      db
        .prepare(
          `INSERT INTO work_order_events
          (id, work_order_id, actor_id, event_type, from_status, to_status, note, created_at)
         SELECT ?, id, ?, 'DOWNTIME_ENDED', NULL, NULL, ?, ? FROM work_orders
         WHERE id = ? AND EXISTS (SELECT 1 FROM downtime_events WHERE id = ? AND ended_at = ?)`,
        )
        .bind(
          operationId("wo-event"),
          context.session.userId,
          `Downtime finalizado · ${minutes} minutos.`,
          now,
          order.id,
          downtime.id,
          end,
        ),
      db
        .prepare(
          `INSERT INTO audit_entries
          (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
           previous_value, new_value, request_id, created_at)
         SELECT ?, ?, ?, ?, 'DOWNTIME_ENDED', 'DOWNTIME', id, ?, ?, ?, ?
         FROM downtime_events WHERE id = ? AND ended_at = ?`,
        )
        .bind(
          operationId("audit"),
          context.session.organizationId,
          context.session.siteId,
          context.session.userId,
          jsonValue({ endedAt: null, durationMinutes: 0 }),
          jsonValue({ endedAt: end, durationMinutes: minutes }),
          context.requestId,
          now,
          downtime.id,
          end,
        ),
    ],
    [0, 1],
  );
  assertMutationApplied(results[0]);
  assertMutationApplied(results[1]);
}
