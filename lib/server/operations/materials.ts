import { getD1 } from "@/db";
import {
  assertCanConsume,
  assertCanRelease,
  assertCanReserve,
  assertCanReturn,
  assertPositiveQuantity,
  reservationConsumed,
} from "@/lib/domain/inventory";
import { assertPermission } from "@/lib/domain/permissions";
import { ApiContractError } from "@/lib/server/http";
import {
  assertMutationApplied,
  jsonValue,
  operationId,
  operationNow,
  type OperationContext,
} from "./shared";

type OrderRow = {
  id: string;
  number: string;
  status: string;
  assetId: string | null;
};

type StockPartRow = {
  partId: string;
  sku: string;
  partName: string;
  unit: string;
  stockId: string;
  stockVersion: number;
  binId: string;
  onHand: number;
  reservedStock: number;
  onOrder: number;
  unitCost: number;
};

type MaterialRow = StockPartRow & {
  materialId: string;
  materialVersion: number;
  planned: number;
  reservedForOrder: number;
  consumed: number;
  returned: number;
  historicalUnitCost: number | null;
};

async function findOrder(
  context: OperationContext,
  number: string,
): Promise<OrderRow> {
  const order = await getD1()
    .prepare(
      `SELECT id, number, status, asset_id AS assetId FROM work_orders
       WHERE number = ? AND organization_id = ? AND site_id = ? LIMIT 1`,
    )
    .bind(number, context.session.organizationId, context.session.siteId)
    .first<OrderRow>();
  if (!order) {
    throw new ApiContractError(
      404,
      "WORK_ORDER_NOT_FOUND",
      "La orden no existe en el centro activo.",
    );
  }
  if (["CLOSED", "CANCELLED"].includes(order.status)) {
    throw new ApiContractError(
      409,
      "FINAL_WORK_ORDER",
      "Una orden finalizada no admite operaciones de material.",
    );
  }
  return order;
}

async function findStockPart(
  context: OperationContext,
  partId: string,
): Promise<StockPartRow> {
  const row = await getD1()
    .prepare(
      `SELECT part.id AS partId, part.sku, part.name AS partName, part.unit,
        stock.id AS stockId, stock.version AS stockVersion, stock.bin_id AS binId,
        stock.on_hand AS onHand, stock.reserved AS reservedStock,
        stock.on_order AS onOrder, policy.average_cost AS unitCost
       FROM parts part
       INNER JOIN stock_levels stock ON stock.part_id = part.id AND stock.site_id = ?
       INNER JOIN part_site_policies policy ON policy.part_id = part.id AND policy.site_id = stock.site_id
       WHERE part.id = ? AND part.organization_id = ? AND part.status = 'ACTIVE'
       LIMIT 1`,
    )
    .bind(context.session.siteId, partId, context.session.organizationId)
    .first<StockPartRow>();
  if (!row) {
    throw new ApiContractError(
      404,
      "PART_NOT_FOUND",
      "El recambio no existe en el almacén del centro activo.",
    );
  }
  return row;
}

async function findMaterial(
  context: OperationContext,
  orderId: string,
  materialId: string,
): Promise<MaterialRow> {
  const row = await getD1()
    .prepare(
      `SELECT material.id AS materialId, material.version AS materialVersion,
        material.planned_quantity AS planned,
        material.reserved_quantity AS reservedForOrder,
        material.consumed_quantity AS consumed,
        material.returned_quantity AS returned,
        part.id AS partId, part.sku, part.name AS partName, part.unit,
        stock.id AS stockId, stock.version AS stockVersion, stock.bin_id AS binId,
        stock.on_hand AS onHand, stock.reserved AS reservedStock,
        stock.on_order AS onOrder, policy.average_cost AS unitCost,
        (SELECT usage.unit_cost_snapshot FROM work_order_part_usages usage
          WHERE usage.work_order_id = material.work_order_id
            AND usage.part_id = material.part_id AND usage.usage_type = 'CONSUMPTION'
          ORDER BY usage.created_at DESC LIMIT 1) AS historicalUnitCost
       FROM work_order_materials material
       INNER JOIN parts part ON part.id = material.part_id
       INNER JOIN stock_levels stock ON stock.part_id = part.id
         AND stock.bin_id = material.bin_id AND stock.site_id = ?
       INNER JOIN part_site_policies policy ON policy.part_id = part.id AND policy.site_id = stock.site_id
       WHERE material.id = ? AND material.work_order_id = ? LIMIT 1`,
    )
    .bind(context.session.siteId, materialId, orderId)
    .first<MaterialRow>();
  if (!row) {
    throw new ApiContractError(
      404,
      "MATERIAL_NOT_FOUND",
      "El material no está previsto en esta orden.",
    );
  }
  return row;
}

async function assertTechnicianCanConsume(
  context: OperationContext,
  orderId: string,
): Promise<void> {
  if (context.session.roleKey !== "TECHNICIAN") return;
  const assigned = await getD1()
    .prepare(
      `SELECT id FROM work_order_assignments
       WHERE work_order_id = ? AND user_id = ? AND unassigned_at IS NULL LIMIT 1`,
    )
    .bind(orderId, context.session.userId)
    .first<{ id: string }>();
  if (!assigned) {
    throw new ApiContractError(
      403,
      "TECHNICIAN_NOT_ASSIGNED",
      "Solo puedes consumir material en trabajos asignados.",
    );
  }
}

function materialEvent(
  db: D1Database,
  context: OperationContext,
  input: {
    orderId: string;
    materialId: string;
    materialVersion: number;
    eventType: string;
    note: string;
    now: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO work_order_events
        (id, work_order_id, actor_id, event_type, from_status, to_status, note, created_at)
       SELECT ?, wo.id, ?, ?, NULL, NULL, ?, ?
       FROM work_orders wo
       WHERE wo.id = ? AND EXISTS (
         SELECT 1 FROM work_order_materials material
         WHERE material.id = ? AND material.version = ?
       )`,
    )
    .bind(
      operationId("wo-event"),
      context.session.userId,
      input.eventType,
      input.note,
      input.now,
      input.orderId,
      input.materialId,
      input.materialVersion,
    );
}

function materialAudit(
  db: D1Database,
  context: OperationContext,
  input: {
    action: string;
    materialId: string;
    materialVersion: number;
    previousValue: unknown;
    newValue: unknown;
    now: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO audit_entries
        (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
         previous_value, new_value, request_id, created_at)
       SELECT ?, ?, ?, ?, ?, 'WORK_ORDER_MATERIAL', id, ?, ?, ?, ?
       FROM work_order_materials WHERE id = ? AND version = ?`,
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
      input.materialId,
      input.materialVersion,
    );
}

export async function addPlannedMaterial(
  context: OperationContext,
  number: string,
  partId: string,
  quantity: number,
): Promise<{ materialId: string }> {
  assertPermission(context.session, "MATERIAL_PLAN");
  assertPositiveQuantity(quantity);
  const [order, part] = await Promise.all([
    findOrder(context, number),
    findStockPart(context, partId),
  ]);
  const now = operationNow(context);
  const materialId = operationId("wo-material");
  const db = getD1();
  await db.batch([
    db
      .prepare(
        `INSERT INTO work_order_materials
          (id, work_order_id, part_id, bin_id, planned_quantity,
           reserved_quantity, consumed_quantity, returned_quantity,
           created_by_id, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, 1, ?, ?)
         ON CONFLICT(work_order_id, part_id, bin_id) DO UPDATE SET
           planned_quantity = work_order_materials.planned_quantity + excluded.planned_quantity,
           version = work_order_materials.version + 1,
           updated_at = excluded.updated_at`,
      )
      .bind(
        materialId,
        order.id,
        part.partId,
        part.binId,
        quantity,
        context.session.userId,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO work_order_events
          (id, work_order_id, actor_id, event_type, from_status, to_status, note, created_at)
         VALUES (?, ?, ?, 'PART_PLANNED', NULL, NULL, ?, ?)`,
      )
      .bind(
        operationId("wo-event"),
        order.id,
        context.session.userId,
        `${part.sku} × ${quantity} ${part.unit} añadido como material previsto.`,
        now,
      ),
  ]);
  const material = await db
    .prepare(
      `SELECT id FROM work_order_materials
       WHERE work_order_id = ? AND part_id = ? AND bin_id = ? LIMIT 1`,
    )
    .bind(order.id, part.partId, part.binId)
    .first<{ id: string }>();
  if (!material) {
    throw new ApiContractError(
      409,
      "MATERIAL_PLAN_NOT_CREATED",
      "No se ha podido consolidar el material previsto.",
    );
  }
  return { materialId: material.id };
}

async function notifyInsufficientStock(
  context: OperationContext,
  order: OrderRow,
  part: StockPartRow,
  requested: number,
): Promise<void> {
  const available = Number(part.onHand) - Number(part.reservedStock);
  const now = operationNow(context);
  await getD1()
    .prepare(
      `INSERT INTO notifications
        (id, organization_id, site_id, user_id, title, body, severity,
         entity_type, entity_id, read_at, created_at)
       VALUES (?, ?, ?, ?, 'Stock insuficiente para trabajo', ?, 'WARNING',
         'WORK_ORDER', ?, NULL, ?)`,
    )
    .bind(
      operationId("notification"),
      context.session.organizationId,
      context.session.siteId,
      context.session.userId,
      `${order.number} necesita ${requested} ${part.unit} de ${part.sku}; disponibles ${available}, en pedido ${part.onOrder}.`,
      order.id,
      now,
    )
    .run();
}

export async function reserveMaterial(
  context: OperationContext,
  number: string,
  materialId: string,
  quantity: number,
): Promise<void> {
  assertPermission(context.session, "MATERIAL_RESERVE");
  const order = await findOrder(context, number);
  const material = await findMaterial(context, order.id, materialId);
  try {
    assertCanReserve(
      {
        onHand: material.onHand,
        reserved: material.reservedStock,
        onOrder: material.onOrder,
      },
      quantity,
    );
  } catch (error) {
    await notifyInsufficientStock(context, order, material, quantity);
    if (error instanceof Error) {
      const available =
        Number(material.onHand) - Number(material.reservedStock);
      throw new ApiContractError(
        409,
        "INSUFFICIENT_AVAILABLE_STOCK",
        `Disponibles ${available} ${material.unit}; en pedido ${material.onOrder}. Revisa las alternativas aprobadas del selector o marca la OT esperando recambio.`,
      );
    }
    throw error;
  }
  const now = operationNow(context);
  const stockVersion = material.stockVersion + 1;
  const materialVersion = material.materialVersion + 1;
  const movementId = operationId("movement");
  const db = getD1();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE stock_levels SET reserved = reserved + ?, version = version + 1, updated_at = ?
         WHERE id = ? AND site_id = ? AND version = ? AND on_hand - reserved >= ?
           AND EXISTS (SELECT 1 FROM work_order_materials WHERE id = ? AND version = ?)`,
      )
      .bind(
        quantity,
        now,
        material.stockId,
        context.session.siteId,
        material.stockVersion,
        quantity,
        material.materialId,
        material.materialVersion,
      ),
    db
      .prepare(
        `UPDATE work_order_materials SET reserved_quantity = reserved_quantity + ?,
          version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?
           AND EXISTS (SELECT 1 FROM stock_levels WHERE id = ? AND version = ?)`,
      )
      .bind(
        quantity,
        now,
        material.materialId,
        material.materialVersion,
        material.stockId,
        stockVersion,
      ),
    db
      .prepare(
        `INSERT INTO inventory_movements
          (id, organization_id, site_id, part_id, bin_id, work_order_id,
           actor_id, movement_type, reference, reason, delta_on_hand,
           delta_reserved, delta_on_order, unit_cost, occurred_at, created_at)
         SELECT ?, ?, ?, part_id, bin_id, work_order_id, ?, 'RESERVE', ?,
           'Reserva para orden de trabajo', 0, ?, 0, ?, ?, ?
         FROM work_order_materials WHERE id = ? AND version = ?`,
      )
      .bind(
        movementId,
        context.session.organizationId,
        context.session.siteId,
        context.session.userId,
        order.number,
        quantity,
        material.unitCost,
        now,
        now,
        material.materialId,
        materialVersion,
      ),
    materialEvent(db, context, {
      orderId: order.id,
      materialId: material.materialId,
      materialVersion,
      eventType: "PART_RESERVED",
      note: `${material.sku} × ${quantity} ${material.unit} reservado.`,
      now,
    }),
    materialAudit(db, context, {
      action: "PART_RESERVED",
      materialId: material.materialId,
      materialVersion,
      previousValue: { reserved: material.reservedForOrder },
      newValue: {
        reserved: Number(material.reservedForOrder) + quantity,
        movementId,
      },
      now,
    }),
  ]);
  assertMutationApplied(
    results[0],
    "El stock disponible cambió. Actualiza antes de reservar.",
  );
  assertMutationApplied(results[1]);
}

export async function releaseMaterial(
  context: OperationContext,
  number: string,
  materialId: string,
  quantity: number,
): Promise<void> {
  assertPermission(context.session, "MATERIAL_RESERVE");
  const order = await findOrder(context, number);
  const material = await findMaterial(context, order.id, materialId);
  assertCanRelease(material.reservedForOrder, quantity);
  const now = operationNow(context);
  const stockVersion = material.stockVersion + 1;
  const materialVersion = material.materialVersion + 1;
  const movementId = operationId("movement");
  const db = getD1();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE stock_levels SET reserved = reserved - ?, version = version + 1, updated_at = ?
         WHERE id = ? AND site_id = ? AND version = ? AND reserved >= ?
           AND EXISTS (SELECT 1 FROM work_order_materials WHERE id = ? AND version = ? AND reserved_quantity >= ?)`,
      )
      .bind(
        quantity,
        now,
        material.stockId,
        context.session.siteId,
        material.stockVersion,
        quantity,
        material.materialId,
        material.materialVersion,
        quantity,
      ),
    db
      .prepare(
        `UPDATE work_order_materials SET reserved_quantity = reserved_quantity - ?,
          version = version + 1, updated_at = ?
         WHERE id = ? AND version = ? AND reserved_quantity >= ?
           AND EXISTS (SELECT 1 FROM stock_levels WHERE id = ? AND version = ?)`,
      )
      .bind(
        quantity,
        now,
        material.materialId,
        material.materialVersion,
        quantity,
        material.stockId,
        stockVersion,
      ),
    db
      .prepare(
        `INSERT INTO inventory_movements
          (id, organization_id, site_id, part_id, bin_id, work_order_id,
           actor_id, movement_type, reference, reason, delta_on_hand,
           delta_reserved, delta_on_order, unit_cost, occurred_at, created_at)
         SELECT ?, ?, ?, part_id, bin_id, work_order_id, ?, 'RELEASE', ?,
           'Liberación de reserva de orden', 0, ?, 0, ?, ?, ?
         FROM work_order_materials WHERE id = ? AND version = ?`,
      )
      .bind(
        movementId,
        context.session.organizationId,
        context.session.siteId,
        context.session.userId,
        order.number,
        -quantity,
        material.unitCost,
        now,
        now,
        material.materialId,
        materialVersion,
      ),
    materialEvent(db, context, {
      orderId: order.id,
      materialId: material.materialId,
      materialVersion,
      eventType: "PART_RELEASED",
      note: `${material.sku} × ${quantity} ${material.unit} liberado.`,
      now,
    }),
    materialAudit(db, context, {
      action: "PART_RELEASED",
      materialId: material.materialId,
      materialVersion,
      previousValue: { reserved: material.reservedForOrder },
      newValue: {
        reserved: Number(material.reservedForOrder) - quantity,
        movementId,
      },
      now,
    }),
  ]);
  assertMutationApplied(results[0]);
  assertMutationApplied(results[1]);
}

export async function consumeMaterial(
  context: OperationContext,
  number: string,
  materialId: string,
  quantity: number,
): Promise<void> {
  assertPermission(context.session, "MATERIAL_CONSUME");
  const order = await findOrder(context, number);
  await assertTechnicianCanConsume(context, order.id);
  const material = await findMaterial(context, order.id, materialId);
  assertCanConsume({
    balance: {
      onHand: material.onHand,
      reserved: material.reservedStock,
      onOrder: material.onOrder,
    },
    reservedForWorkOrder: material.reservedForOrder,
    quantity,
  });
  const reservedUsed = reservationConsumed(material.reservedForOrder, quantity);
  const now = operationNow(context);
  const stockVersion = material.stockVersion + 1;
  const materialVersion = material.materialVersion + 1;
  const movementId = operationId("movement");
  const usageId = operationId("usage");
  const db = getD1();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE stock_levels SET on_hand = on_hand - ?, reserved = reserved - ?,
          version = version + 1, updated_at = ?
         WHERE id = ? AND site_id = ? AND version = ?
           AND on_hand >= ? AND reserved >= ? AND on_hand - ? >= reserved - ?
           AND EXISTS (SELECT 1 FROM work_order_materials
             WHERE id = ? AND version = ? AND reserved_quantity >= ?)`,
      )
      .bind(
        quantity,
        reservedUsed,
        now,
        material.stockId,
        context.session.siteId,
        material.stockVersion,
        quantity,
        reservedUsed,
        quantity,
        reservedUsed,
        material.materialId,
        material.materialVersion,
        reservedUsed,
      ),
    db
      .prepare(
        `UPDATE work_order_materials SET reserved_quantity = reserved_quantity - ?,
          consumed_quantity = consumed_quantity + ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ? AND reserved_quantity >= ?
           AND EXISTS (SELECT 1 FROM stock_levels WHERE id = ? AND version = ?)`,
      )
      .bind(
        reservedUsed,
        quantity,
        now,
        material.materialId,
        material.materialVersion,
        reservedUsed,
        material.stockId,
        stockVersion,
      ),
    db
      .prepare(
        `INSERT INTO inventory_movements
          (id, organization_id, site_id, part_id, bin_id, work_order_id,
           actor_id, movement_type, reference, reason, delta_on_hand,
           delta_reserved, delta_on_order, unit_cost, occurred_at, created_at)
         SELECT ?, ?, ?, part_id, bin_id, work_order_id, ?, 'CONSUMPTION', ?,
           'Consumo documentado en intervención', ?, ?, 0, ?, ?, ?
         FROM work_order_materials WHERE id = ? AND version = ?`,
      )
      .bind(
        movementId,
        context.session.organizationId,
        context.session.siteId,
        context.session.userId,
        order.number,
        -quantity,
        -reservedUsed,
        material.unitCost,
        now,
        now,
        material.materialId,
        materialVersion,
      ),
    db
      .prepare(
        `INSERT INTO work_order_part_usages
          (id, work_order_id, part_id, movement_id, usage_type, quantity,
           unit_cost_snapshot, total_cost, created_at)
         SELECT ?, work_order_id, part_id, ?, 'CONSUMPTION', ?, ?, ?, ?
         FROM work_order_materials WHERE id = ? AND version = ?
           AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = ?)`,
      )
      .bind(
        usageId,
        movementId,
        quantity,
        material.unitCost,
        quantity * material.unitCost,
        now,
        material.materialId,
        materialVersion,
        movementId,
      ),
    materialEvent(db, context, {
      orderId: order.id,
      materialId: material.materialId,
      materialVersion,
      eventType: "PART_CONSUMED",
      note: `${material.sku} × ${quantity} ${material.unit} consumido.`,
      now,
    }),
    materialAudit(db, context, {
      action: "PART_CONSUMED",
      materialId: material.materialId,
      materialVersion,
      previousValue: {
        onHand: material.onHand,
        reservedForOrder: material.reservedForOrder,
      },
      newValue: {
        onHand: Number(material.onHand) - quantity,
        reservedForOrder: Number(material.reservedForOrder) - reservedUsed,
        movementId,
        unitCostSnapshot: material.unitCost,
      },
      now,
    }),
  ]);
  assertMutationApplied(
    results[0],
    "El stock cambió antes de registrar el consumo.",
  );
  assertMutationApplied(results[1]);
}

export async function returnMaterial(
  context: OperationContext,
  number: string,
  materialId: string,
  quantity: number,
): Promise<void> {
  assertPermission(context.session, "MATERIAL_CONSUME");
  const order = await findOrder(context, number);
  await assertTechnicianCanConsume(context, order.id);
  const material = await findMaterial(context, order.id, materialId);
  assertCanReturn({
    consumed: material.consumed,
    returned: material.returned,
    quantity,
  });
  const now = operationNow(context);
  const stockVersion = material.stockVersion + 1;
  const materialVersion = material.materialVersion + 1;
  const unitCost = Number(material.historicalUnitCost ?? material.unitCost);
  const movementId = operationId("movement");
  const db = getD1();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE stock_levels SET on_hand = on_hand + ?, version = version + 1, updated_at = ?
         WHERE id = ? AND site_id = ? AND version = ?
           AND EXISTS (SELECT 1 FROM work_order_materials
             WHERE id = ? AND version = ? AND consumed_quantity - returned_quantity >= ?)`,
      )
      .bind(
        quantity,
        now,
        material.stockId,
        context.session.siteId,
        material.stockVersion,
        material.materialId,
        material.materialVersion,
        quantity,
      ),
    db
      .prepare(
        `UPDATE work_order_materials SET returned_quantity = returned_quantity + ?,
          version = version + 1, updated_at = ?
         WHERE id = ? AND version = ? AND consumed_quantity - returned_quantity >= ?
           AND EXISTS (SELECT 1 FROM stock_levels WHERE id = ? AND version = ?)`,
      )
      .bind(
        quantity,
        now,
        material.materialId,
        material.materialVersion,
        quantity,
        material.stockId,
        stockVersion,
      ),
    db
      .prepare(
        `INSERT INTO inventory_movements
          (id, organization_id, site_id, part_id, bin_id, work_order_id,
           actor_id, movement_type, reference, reason, delta_on_hand,
           delta_reserved, delta_on_order, unit_cost, occurred_at, created_at)
         SELECT ?, ?, ?, part_id, bin_id, work_order_id, ?, 'RETURN', ?,
           'Devolución de material no utilizado', ?, 0, 0, ?, ?, ?
         FROM work_order_materials WHERE id = ? AND version = ?`,
      )
      .bind(
        movementId,
        context.session.organizationId,
        context.session.siteId,
        context.session.userId,
        order.number,
        quantity,
        unitCost,
        now,
        now,
        material.materialId,
        materialVersion,
      ),
    db
      .prepare(
        `INSERT INTO work_order_part_usages
          (id, work_order_id, part_id, movement_id, usage_type, quantity,
           unit_cost_snapshot, total_cost, created_at)
         SELECT ?, work_order_id, part_id, ?, 'RETURN', ?, ?, ?, ?
         FROM work_order_materials WHERE id = ? AND version = ?`,
      )
      .bind(
        operationId("usage"),
        movementId,
        quantity,
        unitCost,
        -quantity * unitCost,
        now,
        material.materialId,
        materialVersion,
      ),
    materialEvent(db, context, {
      orderId: order.id,
      materialId: material.materialId,
      materialVersion,
      eventType: "PART_RETURNED",
      note: `${material.sku} × ${quantity} ${material.unit} devuelto al almacén.`,
      now,
    }),
    materialAudit(db, context, {
      action: "PART_RETURNED",
      materialId: material.materialId,
      materialVersion,
      previousValue: { returned: material.returned },
      newValue: {
        returned: Number(material.returned) + quantity,
        movementId,
        unitCostSnapshot: unitCost,
      },
      now,
    }),
  ]);
  assertMutationApplied(results[0]);
  assertMutationApplied(results[1]);
}
