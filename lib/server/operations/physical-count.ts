import { getD1 } from "@/db";
import { ensureDatabase } from "../database";
import { ApiContractError } from "../http";
import {
  assertWarehouseScope,
  atomicBatch,
  assertMutationApplied,
  operationId,
  operationNow,
  type OperationContext,
} from "./shared";

export async function recordPhysicalCount(
  context: OperationContext,
  input: (
    | { stockId: string; expectedVersion: number }
    | {
        partId: string;
        binId: string;
        expectedVersion: 0;
      }
  ) & {
    countedQuantity: number;
    reason: string;
  },
): Promise<{
  movementId: string;
  physical: number;
  reserved: number;
  available: number;
  delta: number;
}> {
  if (!context.session.permissionCodes.includes("inventory.manage"))
    throw new ApiContractError(
      403,
      "FORBIDDEN_OPERATION",
      "No tienes autorización para ajustar inventario.",
    );
  if (
    !Number.isFinite(input.countedQuantity) ||
    input.countedQuantity < 0 ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < ("stockId" in input ? 1 : 0) ||
    (!("stockId" in input) && input.expectedVersion !== 0) ||
    input.reason.trim().length < 8
  )
    throw new ApiContractError(
      422,
      "INVALID_PHYSICAL_COUNT",
      "Indica cantidad, versión y motivo de conteo válidos.",
    );
  await ensureDatabase();
  if (!("stockId" in input)) return recordInitialPhysicalCount(context, input);
  const db = getD1();
  const row = await db
    .prepare(
      `SELECT stock.id,stock.part_id AS partId,stock.bin_id AS binId,
      bin.warehouse_id AS warehouseId,stock.on_hand AS physical,
      stock.reserved,stock.version,policy.average_cost AS unitCost
     FROM stock_levels stock
     INNER JOIN warehouse_bins bin ON bin.id=stock.bin_id
     INNER JOIN warehouses warehouse ON warehouse.id=bin.warehouse_id AND warehouse.site_id=stock.site_id
     INNER JOIN parts part ON part.id=stock.part_id
     INNER JOIN part_site_policies policy ON policy.part_id=part.id AND policy.site_id=stock.site_id
     WHERE stock.id=? AND stock.site_id=? AND part.organization_id=?
       AND part.status='ACTIVE' AND bin.status='ACTIVE' AND warehouse.status='ACTIVE' LIMIT 1`,
    )
    .bind(input.stockId, context.session.siteId, context.session.organizationId)
    .first<{
      id: string;
      partId: string;
      binId: string;
      warehouseId: string;
      physical: number;
      reserved: number;
      version: number;
      unitCost: number;
    }>();
  if (!row)
    throw new ApiContractError(
      404,
      "STOCK_NOT_FOUND",
      "La ubicación de stock no existe en este centro.",
    );
  assertWarehouseScope(context.session, row.warehouseId);
  if (row.version !== input.expectedVersion)
    throw new ApiContractError(
      409,
      "CONCURRENT_MODIFICATION",
      "El stock ha cambiado. Actualiza el conteo antes de confirmar.",
    );
  if (input.countedQuantity < row.reserved)
    throw new ApiContractError(
      409,
      "COUNT_BELOW_RESERVED",
      "El conteo es inferior a las unidades reservadas; resuelve las reservas antes de ajustar.",
    );
  const now = operationNow(context);
  const movementId = operationId("movement");
  const delta = input.countedQuantity - row.physical;
  const results = await atomicBatch(
    db,
    [
      db
        .prepare(
          `UPDATE stock_levels SET on_hand=?,version=version+1,updated_at=?
       WHERE id=? AND site_id=? AND version=? AND reserved<=?`,
        )
        .bind(
          input.countedQuantity,
          now,
          row.id,
          context.session.siteId,
          row.version,
          input.countedQuantity,
        ),
      db
        .prepare(
          `INSERT INTO inventory_movements
        (id,organization_id,site_id,part_id,bin_id,work_order_id,purchase_order_id,
         goods_receipt_id,stock_transfer_id,actor_id,movement_type,reference,reason,
         delta_on_hand,delta_reserved,delta_on_order,unit_cost,occurred_at,created_at)
       SELECT ?,?,?,?,?,NULL,NULL,NULL,NULL,?,'ADJUSTMENT',?,?,?,0,0,?,?,?
       FROM stock_levels WHERE id=? AND version=?`,
        )
        .bind(
          movementId,
          context.session.organizationId,
          context.session.siteId,
          row.partId,
          row.binId,
          context.session.userId,
          `COUNT:${row.id}:${row.version + 1}`,
          input.reason.trim(),
          delta,
          row.unitCost,
          now,
          now,
          row.id,
          row.version + 1,
        ),
      db
        .prepare(
          `INSERT INTO audit_entries
        (id,organization_id,site_id,actor_id,action,entity_type,entity_id,
         previous_value,new_value,request_id,created_at)
       SELECT ?,?,?,?,'PHYSICAL_COUNT_RECORDED','STOCK_LEVEL',?, ?, ?, ?, ?
       FROM stock_levels WHERE id=? AND version=?`,
        )
        .bind(
          operationId("audit"),
          context.session.organizationId,
          context.session.siteId,
          context.session.userId,
          row.id,
          JSON.stringify({ physical: row.physical, reserved: row.reserved }),
          JSON.stringify({
            physical: input.countedQuantity,
            reserved: row.reserved,
            delta,
            reason: input.reason.trim(),
            movementId,
          }),
          context.requestId,
          now,
          row.id,
          row.version + 1,
        ),
    ],
    [0, 1, 2],
  );
  for (const result of results) assertMutationApplied(result);
  return {
    movementId,
    physical: input.countedQuantity,
    reserved: row.reserved,
    available: input.countedQuantity - row.reserved,
    delta,
  };
}

async function recordInitialPhysicalCount(
  context: OperationContext,
  input: {
    partId: string;
    binId: string;
    countedQuantity: number;
    reason: string;
  },
) {
  const db = getD1();
  const target = await db
    .prepare(
      `SELECT part.id AS partId,bin.id AS binId,wh.id AS warehouseId,
      policy.average_cost AS unitCost
     FROM parts part
     JOIN part_site_policies policy ON policy.part_id=part.id AND policy.site_id=?
     JOIN warehouse_bins bin ON bin.id=? AND bin.status='ACTIVE'
     JOIN warehouses wh ON wh.id=bin.warehouse_id AND wh.site_id=? AND wh.organization_id=? AND wh.status='ACTIVE'
     WHERE part.id=? AND part.organization_id=? AND part.status='ACTIVE' LIMIT 1`,
    )
    .bind(
      context.session.siteId,
      input.binId,
      context.session.siteId,
      context.session.organizationId,
      input.partId,
      context.session.organizationId,
    )
    .first<{
      partId: string;
      binId: string;
      warehouseId: string;
      unitCost: number;
    }>();
  if (!target)
    throw new ApiContractError(
      404,
      "STOCK_TARGET_NOT_FOUND",
      "La pieza o ubicación no está disponible en este centro.",
    );
  assertWarehouseScope(context.session, target.warehouseId);
  const now = operationNow(context);
  const stockId = operationId("stock");
  const movementId = operationId("movement");
  const results = await atomicBatch(
    db,
    [
      db
        .prepare(
          `INSERT INTO stock_levels(id,part_id,site_id,bin_id,on_hand,reserved,on_order,version,updated_at)
       SELECT ?,?,?,?, ?,0,0,1,? WHERE NOT EXISTS
         (SELECT 1 FROM stock_levels WHERE part_id=? AND bin_id=?)`,
        )
        .bind(
          stockId,
          input.partId,
          context.session.siteId,
          input.binId,
          input.countedQuantity,
          now,
          input.partId,
          input.binId,
        ),
      db
        .prepare(
          `INSERT INTO inventory_movements
       (id,organization_id,site_id,part_id,bin_id,work_order_id,purchase_order_id,
        goods_receipt_id,stock_transfer_id,actor_id,movement_type,reference,reason,
        delta_on_hand,delta_reserved,delta_on_order,unit_cost,occurred_at,created_at)
       SELECT ?,?,?,?,?,NULL,NULL,NULL,NULL,?,'ADJUSTMENT',?,?,?,0,0,?,?,?
       FROM stock_levels WHERE id=? AND version=1`,
        )
        .bind(
          movementId,
          context.session.organizationId,
          context.session.siteId,
          input.partId,
          input.binId,
          context.session.userId,
          `COUNT_INIT:${stockId}:1`,
          input.reason.trim(),
          input.countedQuantity,
          target.unitCost,
          now,
          now,
          stockId,
        ),
      db
        .prepare(
          `INSERT INTO audit_entries
       (id,organization_id,site_id,actor_id,action,entity_type,entity_id,
        previous_value,new_value,request_id,created_at)
       SELECT ?,?,?,?,'PHYSICAL_COUNT_RECORDED','STOCK_LEVEL',?,NULL,?,?,?
       FROM stock_levels WHERE id=? AND version=1`,
        )
        .bind(
          operationId("audit"),
          context.session.organizationId,
          context.session.siteId,
          context.session.userId,
          stockId,
          JSON.stringify({
            physical: input.countedQuantity,
            reserved: 0,
            delta: input.countedQuantity,
            reason: input.reason.trim(),
            movementId,
          }),
          context.requestId,
          now,
          stockId,
        ),
    ],
    [0, 1, 2],
  );
  for (const result of results) assertMutationApplied(result);
  return {
    movementId,
    physical: input.countedQuantity,
    reserved: 0,
    available: input.countedQuantity,
    delta: input.countedQuantity,
  };
}
