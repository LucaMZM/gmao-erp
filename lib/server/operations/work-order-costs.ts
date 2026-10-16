import { getD1 } from "@/db";
import { assertEnterprisePermission } from "@/lib/domain/governance";
import { ensureDatabase } from "../database";
import { ApiContractError } from "../http";
import {
  assertLocationScope,
  atomicBatch,
  assertMutationApplied,
  operationId,
  operationNow,
  type OperationContext,
} from "./shared";

export type CostKind = "EXTERNAL_VENDOR" | "OTHER";

export async function recordWorkOrderCost(
  context: OperationContext,
  number: string,
  input: {
    kind: CostKind;
    description: string;
    amountCents: number;
    vendorId: string | null;
  },
): Promise<{ id: string }> {
  assertEnterprisePermission(
    context.session.permissionCodes,
    "workorder.close",
  );
  if (
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents <= 0 ||
    input.amountCents > 100_000_000 ||
    input.description.trim().length < 5
  )
    throw new ApiContractError(
      422,
      "INVALID_WORK_ORDER_COST",
      "Indica un importe y descripción válidos.",
    );
  await ensureDatabase();
  const db = getD1();
  const order = await db
    .prepare(
      "SELECT id,status,functional_location_id AS locationId FROM work_orders WHERE number=? AND organization_id=? AND site_id=? LIMIT 1",
    )
    .bind(number, context.session.organizationId, context.session.siteId)
    .first<{ id: string; status: string; locationId: string }>();
  if (!order)
    throw new ApiContractError(
      404,
      "WORK_ORDER_NOT_FOUND",
      "La orden no existe en este centro.",
    );
  await assertLocationScope(context.session, order.locationId);
  if (["CLOSED", "CANCELLED"].includes(order.status))
    throw new ApiContractError(
      409,
      "FINAL_WORK_ORDER",
      "No se añaden costes a órdenes cerradas o canceladas.",
    );
  if (input.vendorId) {
    const vendor = await db
      .prepare(
        "SELECT id FROM vendors WHERE id=? AND organization_id=? AND status='ACTIVE'",
      )
      .bind(input.vendorId, context.session.organizationId)
      .first();
    if (!vendor)
      throw new ApiContractError(
        422,
        "INVALID_VENDOR",
        "El proveedor no pertenece a la organización.",
      );
  }
  const id = operationId("wo-cost");
  const now = operationNow(context);
  const results = await atomicBatch(
    db,
    [
      db
        .prepare(
          `INSERT INTO work_order_cost_items
        (id,organization_id,site_id,work_order_id,kind,description,amount_cents,currency,vendor_id,recorded_by_id,recorded_at)
       SELECT ?,?,?,id,?,?,?,'EUR',?,?,? FROM work_orders
       WHERE id=? AND organization_id=? AND site_id=? AND status NOT IN ('CLOSED','CANCELLED')`,
        )
        .bind(
          id,
          context.session.organizationId,
          context.session.siteId,
          input.kind,
          input.description.trim(),
          input.amountCents,
          input.vendorId,
          context.session.userId,
          now,
          order.id,
          context.session.organizationId,
          context.session.siteId,
        ),
      db
        .prepare(
          `INSERT INTO audit_entries
        (id,organization_id,site_id,actor_id,action,entity_type,entity_id,
         previous_value,new_value,request_id,created_at)
       SELECT ?,?,?,?,'WORK_ORDER_COST_RECORDED','WORK_ORDER',?,NULL,?,?,?
       FROM work_order_cost_items WHERE id=?`,
        )
        .bind(
          operationId("audit"),
          context.session.organizationId,
          context.session.siteId,
          context.session.userId,
          order.id,
          JSON.stringify({
            costId: id,
            kind: input.kind,
            amountCents: input.amountCents,
            vendorId: input.vendorId,
          }),
          context.requestId,
          now,
          id,
        ),
    ],
    [0, 1],
  );
  for (const result of results) assertMutationApplied(result);
  return { id };
}
