import type { DemoUserSession } from "@/lib/server/auth";
import { getD1 } from "@/db";
import { ensureDatabase } from "@/lib/server/database";
import { ApiContractError } from "@/lib/server/http";

export type OperationContext = {
  session: DemoUserSession;
  requestId: string;
  now?: string;
  idempotencyReservationId?: string;
};

export function operationId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function operationNow(context: OperationContext): string {
  return context.now ?? new Date().toISOString();
}

export async function nextPlantNumber(
  session: DemoUserSession,
  entity: "INC" | "OT" | "PM" | "RCA" | "PR" | "PO" | "GR" | "TR",
  now: string,
): Promise<string> {
  await ensureDatabase();
  const key = `sequence:${entity.toLowerCase()}:${session.siteId}`;
  const firstValue =
    entity === "INC"
      ? 101
      : entity === "OT"
        ? 300
        : entity === "PM"
          ? 100
          : entity === "PR" || entity === "PO"
            ? 100
            : 1;
  const table =
    entity === "INC"
      ? "incidents"
      : entity === "OT"
        ? "work_orders"
        : entity === "PM"
          ? "maintenance_plans"
          : entity === "RCA"
            ? "root_cause_analyses"
            : entity === "PR"
              ? "purchase_requisitions"
              : entity === "PO"
                ? "purchase_orders"
                : entity === "GR"
                  ? "goods_receipts"
                  : "stock_transfers";
  const identifierColumn = entity === "PM" ? "code" : "number";
  const width = ["PM", "RCA", "PR", "PO", "GR", "TR"].includes(entity) ? 3 : 4;
  const latest = await getD1()
    .prepare(
      `SELECT MAX(CAST(SUBSTR(${identifierColumn}, -${width}) AS INTEGER)) AS value
       FROM ${table} WHERE organization_id = ? AND site_id = ?`,
    )
    .bind(session.organizationId, session.siteId)
    .first<{ value: number | null }>();
  const nextFloor = Math.max(firstValue, Number(latest?.value ?? 0) + 1);
  const row = await getD1()
    .prepare(
      `
      INSERT INTO system_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = CAST(MAX(CAST(system_state.value AS INTEGER) + 1, CAST(excluded.value AS INTEGER)) AS TEXT),
        updated_at = excluded.updated_at
      RETURNING value
    `,
    )
    .bind(key, String(nextFloor), now)
    .first<{ value: string }>();
  if (!row) {
    throw new ApiContractError(
      503,
      "SEQUENCE_UNAVAILABLE",
      "No se ha podido reservar un identificador industrial.",
    );
  }
  const siteToken = session.siteCode.split("-")[1] ?? session.siteCode;
  const year = new Date(now).getUTCFullYear();
  return `${entity}-${siteToken}-${year}-${String(Number(row.value)).padStart(width, "0")}`;
}

export function jsonValue(value: unknown): string {
  return JSON.stringify(value);
}

export function assertMutationApplied(
  result: D1Result<unknown> | undefined,
  message = "El registro ha cambiado en otra sesión. Actualiza y reintenta.",
): void {
  if (Number(result?.meta?.changes ?? 0) !== 1) {
    throw new ApiContractError(409, "CONCURRENT_MODIFICATION", message);
  }
}

/** Check CAS results inside the transaction, not after D1 has committed it.
 * The assertion INSERT selects no rows on success; on failure its CHECK aborts
 * every statement in the batch, including earlier writes and audit entries.
 */
export async function atomicBatch(
  db: D1Database,
  statements: D1PreparedStatement[],
  requiredChanges: readonly number[] = [0],
): Promise<D1Result<unknown>[]> {
  const required = new Set(requiredChanges);
  const indices: number[] = [];
  let assertionCount = 0;
  const guarded = statements.flatMap((statement, index) => {
    indices.push(index + assertionCount);
    if (required.has(index)) assertionCount += 1;
    return required.has(index)
      ? [
          statement,
          db.prepare(
            "INSERT INTO _mutation_assertions (affected_rows) SELECT changes() WHERE changes() <> 1",
          ),
        ]
      : [statement];
  });
  try {
    const results = await db.batch(guarded);
    return indices.map((index) => results[index]);
  } catch (error) {
    for (const code of [
      "ACTIVE_LABOR_SESSION_EXISTS",
      "ACTIVE_DOWNTIME_EXISTS",
      "RESERVED_MATERIALS",
      "FINAL_WORK_ORDER",
    ] as const) {
      if (String(error).includes(code))
        throw new ApiContractError(
          409,
          code,
          "El estado de la orden ha cambiado o mantiene operaciones pendientes. Actualiza antes de continuar.",
        );
    }
    if (
      String(error).includes("UNIQUE constraint failed: labor_sessions.user_id")
    ) {
      throw new ApiContractError(
        409,
        "ACTIVE_LABOR_SESSION_EXISTS",
        "El técnico ya tiene una sesión activa.",
      );
    }
    if (
      String(error).includes(
        "UNIQUE constraint failed: downtime_events.work_order_id",
      )
    ) {
      throw new ApiContractError(
        409,
        "ACTIVE_DOWNTIME_EXISTS",
        "La orden ya tiene un downtime activo.",
      );
    }
    if (String(error).includes("ck_atomic_mutation_applied")) {
      throw new ApiContractError(
        409,
        "CONCURRENT_MODIFICATION",
        "El registro cambió en otra operación. Actualiza y reintenta.",
      );
    }
    throw error;
  }
}

export async function assertLocationScope(
  session: DemoUserSession,
  functionalLocationId: string,
): Promise<void> {
  if (session.fullAreaAccess) return;
  const allowed = await getD1()
    .prepare(
      `WITH RECURSIVE hierarchy(id, parent_id) AS (
        SELECT id, parent_id FROM functional_locations
        WHERE id = ? AND organization_id = ? AND site_id = ?
        UNION ALL
        SELECT parent.id, parent.parent_id FROM functional_locations parent
        INNER JOIN hierarchy child ON child.parent_id = parent.id
      )
      SELECT id FROM hierarchy WHERE id IN (${session.areaIds.map(() => "?").join(",") || "NULL"}) LIMIT 1`,
    )
    .bind(
      functionalLocationId,
      session.organizationId,
      session.siteId,
      ...session.areaIds,
    )
    .first<{ id: string }>();
  if (!allowed) {
    throw new ApiContractError(
      403,
      "AREA_SCOPE_DENIED",
      "La ubicación está fuera de tu ámbito operativo.",
    );
  }
}

export function assertWarehouseScope(
  session: DemoUserSession,
  warehouseId: string,
): void {
  if (
    !session.fullWarehouseAccess &&
    !session.warehouseIds.includes(warehouseId)
  ) {
    throw new ApiContractError(
      403,
      "WAREHOUSE_SCOPE_DENIED",
      "El almacén está fuera de tu ámbito operativo.",
    );
  }
}

export async function resolveLaborRate(
  session: DemoUserSession,
  userId: string,
  at: string,
): Promise<{ hourlyRateCents: number; currency: string }> {
  const row = await getD1()
    .prepare(
      `SELECT hourly_rate_cents AS hourlyRateCents, currency
       FROM labor_rate_cards
       WHERE organization_id = ? AND (user_id = ? OR role_key = (
         SELECT role_key FROM memberships WHERE organization_id = ? AND user_id = ?
       )) AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, effective_from DESC
       LIMIT 1`,
    )
    .bind(
      session.organizationId,
      userId,
      session.organizationId,
      userId,
      at,
      at,
      userId,
    )
    .first<{ hourlyRateCents: number; currency: string }>();
  return row ?? { hourlyRateCents: 0, currency: "EUR" };
}

export async function runIdempotent<T>(
  context: OperationContext,
  idempotencyKey: string | null,
  operation: string,
  execute: () => Promise<T>,
  requestIdentity?: unknown,
): Promise<{ value: T; replayed: boolean }> {
  if (!idempotencyKey) return { value: await execute(), replayed: false };
  if (!/^[a-zA-Z0-9:_-]{12,120}$/.test(idempotencyKey)) {
    throw new ApiContractError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "La clave de sincronización no es válida.",
    );
  }
  const db = getD1();
  if (requestIdentity !== undefined) {
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(requestIdentity)),
    );
    operation += `:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  const id = operationId("idempotency");
  const now = operationNow(context);
  const reservation = await db
    .prepare(
      `INSERT OR IGNORE INTO operation_idempotency
       (id, organization_id, site_id, actor_id, idempotency_key, operation,
        entity_type, entity_id, response_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
    )
    .bind(
      id,
      context.session.organizationId,
      context.session.siteId,
      context.session.userId,
      idempotencyKey,
      operation,
      now,
    )
    .run();
  if (Number(reservation.meta?.changes ?? 0) === 0) {
    const existing = await db
      .prepare(
        `SELECT operation, response_json AS responseJson
         FROM operation_idempotency
         WHERE organization_id = ? AND site_id = ?
           AND actor_id = ? AND idempotency_key = ?`,
      )
      .bind(
        context.session.organizationId,
        context.session.siteId,
        context.session.userId,
        idempotencyKey,
      )
      .first<{ operation: string; responseJson: string | null }>();
    if (!existing || existing.operation !== operation) {
      throw new ApiContractError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "La clave ya identifica otra operación.",
      );
    }
    if (!existing.responseJson) {
      throw new ApiContractError(
        409,
        "OPERATION_SYNCING",
        "La operación ya se está sincronizando.",
      );
    }
    return { value: JSON.parse(existing.responseJson) as T, replayed: true };
  }
  try {
    context.idempotencyReservationId = id;
    const value = await execute();
    // The business batch persists its response before committing, never here.
    const committed = await db
      .prepare("SELECT response_json FROM operation_idempotency WHERE id = ?")
      .bind(id)
      .first<{ response_json: string | null }>();
    if (!committed?.response_json)
      throw new Error("IDEMPOTENCY_TRANSACTION_NOT_COMMITTED");
    return { value, replayed: false };
  } catch (error) {
    await db
      .prepare(
        "DELETE FROM operation_idempotency WHERE id = ? AND response_json IS NULL",
      )
      .bind(id)
      .run();
    throw error;
  } finally {
    delete context.idempotencyReservationId;
  }
}

/** Durable response and domain writes share one SQLite transaction. An injected
 * audit/ledger/response failure rolls the entire operation back. */
export async function commitIdempotentOperation<T>(
  context: OperationContext,
  statements: D1PreparedStatement[],
  response: T,
): Promise<void> {
  const db = getD1();
  if (!context.idempotencyReservationId) {
    await atomicBatch(db, statements);
    return;
  }
  await atomicBatch(
    db,
    [
      ...statements,
      db
        .prepare(
          "UPDATE operation_idempotency SET response_json = ? WHERE id = ? AND response_json IS NULL",
        )
        .bind(JSON.stringify(response), context.idempotencyReservationId),
    ],
    [0, statements.length],
  );
}
