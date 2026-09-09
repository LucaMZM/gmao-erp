import { getD1 } from "@/db";
import {
  assertPositiveProcurementQuantity,
  assertPurchaseOrderTransition,
  assertReceiptAllowed,
  assertRequisitionTransition,
  assertTransferTransition,
  purchaseOrderTotals,
  type PurchaseOrderStatus,
  type RequisitionStatus,
  type TransferStatus,
} from "@/lib/domain/procurement";
import { assertPermission } from "@/lib/domain/permissions";
import { ApiContractError } from "@/lib/server/http";
import {
  assertMutationApplied,
  assertWarehouseScope,
  jsonValue,
  nextPlantNumber,
  operationId,
  operationNow,
  type OperationContext,
} from "./shared";

type StockSnapshot = {
  partId: string;
  sku: string;
  name: string;
  unit: string;
  available: number;
  onOrder: number;
  averageCost: number;
};

type RequisitionRow = {
  id: string;
  number: string;
  status: RequisitionStatus;
  version: number;
  warehouseId: string;
  workOrderId: string | null;
  requestedById: string;
};

type RequisitionLineRow = {
  id: string;
  partId: string;
  sku: string;
  partName: string;
  manufacturer: string | null;
  quantity: number;
};

type PurchaseOrderRow = {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  version: number;
  vendorId: string;
  warehouseId: string;
  destinationBinId: string;
  requisitionId: string;
  workOrderId: string | null;
  requestedById: string;
};

type PurchaseOrderLineRow = {
  id: string;
  partId: string;
  sku: string;
  unit: string;
  orderedQuantity: number;
  receivedQuantity: number;
  unitPrice: number;
};

type TransferRow = {
  id: string;
  number: string;
  status: TransferStatus;
  version: number;
};

type TransferLineRow = {
  id: string;
  partId: string;
  sku: string;
  unit: string;
  fromBinId: string;
  toBinId: string;
  quantity: number;
  unitCost: number;
};

type MutationGuard = {
  table: "purchase_requisitions" | "purchase_orders" | "stock_transfers";
  entityId: string;
  status: string;
  version: number;
};

function eventStatement(
  db: D1Database,
  context: OperationContext,
  input: {
    entityType: "PURCHASE_REQUISITION" | "PURCHASE_ORDER" | "STOCK_TRANSFER";
    entityId: string;
    eventType: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    note: string;
    now: string;
    guard?: MutationGuard;
  },
) {
  const values = [
    operationId("proc-event"),
    context.session.organizationId,
    context.session.siteId,
    input.entityType,
    input.entityId,
    context.session.userId,
    input.eventType,
    input.fromStatus ?? null,
    input.toStatus ?? null,
    input.note,
    input.now,
  ];
  const insertion = input.guard
    ? `SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM ${input.guard.table}
         WHERE id = ? AND status = ? AND version = ?)`
    : "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return db
    .prepare(
      `INSERT INTO procurement_events
        (id, organization_id, site_id, entity_type, entity_id, actor_id,
         event_type, from_status, to_status, note, created_at)
       ${insertion}`,
    )
    .bind(
      ...values,
      ...(input.guard
        ? [input.guard.entityId, input.guard.status, input.guard.version]
        : []),
    );
}

function auditStatement(
  db: D1Database,
  context: OperationContext,
  input: {
    action: string;
    entityType: string;
    entityId: string;
    previousValue: unknown;
    newValue: unknown;
    now: string;
    guard?: MutationGuard;
  },
) {
  const values = [
    operationId("audit"),
    context.session.organizationId,
    context.session.siteId,
    context.session.userId,
    input.action,
    input.entityType,
    input.entityId,
    jsonValue(input.previousValue),
    jsonValue(input.newValue),
    context.requestId,
    input.now,
  ];
  const insertion = input.guard
    ? `SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM ${input.guard.table}
         WHERE id = ? AND status = ? AND version = ?)`
    : "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return db
    .prepare(
      `INSERT INTO audit_entries
        (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
         previous_value, new_value, request_id, created_at)
       ${insertion}`,
    )
    .bind(
      ...values,
      ...(input.guard
        ? [input.guard.entityId, input.guard.status, input.guard.version]
        : []),
    );
}

async function defaultWarehouseAndBin(
  context: OperationContext,
  warehouseId?: string | null,
): Promise<{ warehouseId: string; binId: string }> {
  const row = await getD1()
    .prepare(
      `SELECT warehouse.id AS warehouseId, bin.id AS binId
       FROM warehouses warehouse
       INNER JOIN warehouse_bins bin ON bin.warehouse_id = warehouse.id
       WHERE warehouse.organization_id = ? AND warehouse.site_id = ?
         AND warehouse.status = 'ACTIVE' AND bin.status = 'ACTIVE'
         AND (? IS NULL OR warehouse.id = ?)
       ORDER BY warehouse.code, bin.code LIMIT 1`,
    )
    .bind(
      context.session.organizationId,
      context.session.siteId,
      warehouseId ?? null,
      warehouseId ?? null,
    )
    .first<{ warehouseId: string; binId: string }>();
  if (!row) {
    throw new ApiContractError(
      404,
      "WAREHOUSE_NOT_FOUND",
      "No existe un almacén operativo en el centro activo.",
    );
  }
  assertWarehouseScope(context.session, row.warehouseId);
  return row;
}

async function partSnapshot(
  context: OperationContext,
  partId: string,
): Promise<StockSnapshot> {
  const row = await getD1()
    .prepare(
      `SELECT part.id AS partId, part.sku, part.name, part.unit,
        COALESCE(SUM(stock.on_hand - stock.reserved), 0) AS available,
        COALESCE(SUM(stock.on_order), 0) AS onOrder,
        policy.average_cost AS averageCost
       FROM parts part
       INNER JOIN part_site_policies policy
         ON policy.part_id = part.id AND policy.site_id = ?
       LEFT JOIN stock_levels stock
         ON stock.part_id = part.id AND stock.site_id = policy.site_id
       WHERE part.id = ? AND part.organization_id = ? AND part.status = 'ACTIVE'
       GROUP BY part.id, policy.average_cost LIMIT 1`,
    )
    .bind(context.session.siteId, partId, context.session.organizationId)
    .first<StockSnapshot>();
  if (!row) {
    throw new ApiContractError(
      404,
      "PART_NOT_FOUND",
      "La referencia no existe en el catálogo del centro activo.",
    );
  }
  return row;
}

async function findWorkOrder(
  context: OperationContext,
  number?: string | null,
): Promise<{ id: string; number: string } | null> {
  if (!number) return null;
  const row = await getD1()
    .prepare(
      `SELECT id, number FROM work_orders
       WHERE organization_id = ? AND site_id = ? AND number = ? LIMIT 1`,
    )
    .bind(context.session.organizationId, context.session.siteId, number)
    .first<{ id: string; number: string }>();
  if (!row) {
    throw new ApiContractError(
      404,
      "WORK_ORDER_NOT_FOUND",
      "La orden no existe en el centro activo.",
    );
  }
  return row;
}

export async function createPurchaseRequisition(
  context: OperationContext,
  input: {
    partId: string;
    quantity: number;
    warehouseId?: string | null;
    workOrderNumber?: string | null;
    origin: "WORK_ORDER" | "LOW_STOCK" | "STOCKOUT" | "MANUAL" | "PLANNING";
    urgency: "ROUTINE" | "HIGH" | "CRITICAL";
    needBy?: string | null;
    justification: string;
    submit?: boolean;
  },
): Promise<{ id: string; number: string; status: RequisitionStatus }> {
  assertPermission(context.session, "PURCHASE_REQUISITION_CREATE");
  assertPositiveProcurementQuantity(input.quantity);
  const [part, warehouse, workOrder] = await Promise.all([
    partSnapshot(context, input.partId),
    defaultWarehouseAndBin(context, input.warehouseId),
    findWorkOrder(context, input.workOrderNumber),
  ]);
  const duplicate = await getD1()
    .prepare(
      `SELECT requisition.number
       FROM purchase_requisitions requisition
       INNER JOIN purchase_requisition_lines line
         ON line.purchase_requisition_id = requisition.id
       WHERE requisition.site_id = ? AND line.part_id = ?
         AND requisition.status IN ('DRAFT','SUBMITTED','APPROVED')
         AND ((requisition.work_order_id = ?) OR
           (requisition.work_order_id IS NULL AND ? IS NULL))
       ORDER BY requisition.created_at DESC LIMIT 1`,
    )
    .bind(
      context.session.siteId,
      part.partId,
      workOrder?.id ?? null,
      workOrder?.id ?? null,
    )
    .first<{ number: string }>();
  if (duplicate) {
    throw new ApiContractError(
      409,
      "OPEN_REQUISITION_EXISTS",
      `Ya existe la requisición abierta ${duplicate.number} para esta necesidad.`,
    );
  }
  const now = operationNow(context);
  const number = await nextPlantNumber(context.session, "PR", now);
  const id = operationId("requisition");
  const status: RequisitionStatus = input.submit ? "SUBMITTED" : "DRAFT";
  const db = getD1();
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO purchase_requisitions
          (id, organization_id, site_id, warehouse_id, work_order_id, number,
           origin, urgency, need_by, justification, status, requested_by_id,
           approved_by_id, approved_at, decision_reason, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 1, ?, ?)`,
      )
      .bind(
        id,
        context.session.organizationId,
        context.session.siteId,
        warehouse.warehouseId,
        workOrder?.id ?? null,
        number,
        input.origin,
        input.urgency,
        input.needBy ?? null,
        input.justification.trim(),
        status,
        context.session.userId,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO purchase_requisition_lines
          (id, purchase_requisition_id, part_id, quantity,
           available_snapshot, on_order_snapshot, note)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        operationId("requisition-line"),
        id,
        part.partId,
        input.quantity,
        part.available,
        part.onOrder,
      ),
    eventStatement(db, context, {
      entityType: "PURCHASE_REQUISITION",
      entityId: id,
      eventType: input.submit ? "REQUISITION_SUBMITTED" : "REQUISITION_CREATED",
      toStatus: status,
      note: `${part.sku} × ${input.quantity} ${part.unit}${workOrder ? ` para ${workOrder.number}` : ""}.`,
      now,
    }),
    auditStatement(db, context, {
      action: input.submit
        ? "PURCHASE_REQUISITION_SUBMITTED"
        : "PURCHASE_REQUISITION_CREATED",
      entityType: "PURCHASE_REQUISITION",
      entityId: id,
      previousValue: null,
      newValue: {
        number,
        status,
        partId: part.partId,
        quantity: input.quantity,
        workOrderId: workOrder?.id ?? null,
      },
      now,
    }),
  ]);
  assertMutationApplied(results[0]);
  if (workOrder) {
    await db
      .prepare(
        `INSERT INTO work_order_events
          (id, work_order_id, actor_id, event_type, from_status, to_status, note, created_at)
         VALUES (?, ?, ?, 'PURCHASE_REQUISITION_CREATED', NULL, NULL, ?, ?)`,
      )
      .bind(
        operationId("wo-event"),
        workOrder.id,
        context.session.userId,
        `${number} creada para ${part.sku} × ${input.quantity}.`,
        now,
      )
      .run();
  }
  return { id, number, status };
}

async function getRequisition(
  context: OperationContext,
  number: string,
): Promise<RequisitionRow> {
  const row = await getD1()
    .prepare(
      `SELECT id, number, status, version, warehouse_id AS warehouseId,
        work_order_id AS workOrderId, requested_by_id AS requestedById
       FROM purchase_requisitions
       WHERE organization_id = ? AND site_id = ? AND number = ? LIMIT 1`,
    )
    .bind(context.session.organizationId, context.session.siteId, number)
    .first<RequisitionRow>();
  if (!row) {
    throw new ApiContractError(
      404,
      "REQUISITION_NOT_FOUND",
      "La requisición no existe en el centro activo.",
    );
  }
  assertWarehouseScope(context.session, row.warehouseId);
  return row;
}

export async function changeRequisitionStatus(
  context: OperationContext,
  number: string,
  input: {
    action: "SUBMIT" | "APPROVE" | "REJECT" | "CANCEL";
    reason?: string | null;
    version: number;
  },
): Promise<void> {
  const requisition = await getRequisition(context, number);
  const target: Record<typeof input.action, RequisitionStatus> = {
    SUBMIT: "SUBMITTED",
    APPROVE: "APPROVED",
    REJECT: "REJECTED",
    CANCEL: "CANCELLED",
  };
  const to = target[input.action];
  if (["APPROVE", "REJECT"].includes(input.action)) {
    assertPermission(context.session, "PURCHASE_REQUISITION_APPROVE");
  } else {
    assertPermission(context.session, "PURCHASE_REQUISITION_CREATE");
  }
  if (input.action === "REJECT" && !input.reason?.trim()) {
    throw new ApiContractError(
      400,
      "DECISION_REASON_REQUIRED",
      "Indica el motivo del rechazo.",
    );
  }
  assertRequisitionTransition(requisition.status, to);
  const now = operationNow(context);
  const db = getD1();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE purchase_requisitions SET status = ?,
          approved_by_id = CASE WHEN ? = 'APPROVED' THEN ? ELSE approved_by_id END,
          approved_at = CASE WHEN ? = 'APPROVED' THEN ? ELSE approved_at END,
          decision_reason = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ? AND status = ?`,
      )
      .bind(
        to,
        to,
        context.session.userId,
        to,
        now,
        input.reason?.trim() || null,
        now,
        requisition.id,
        input.version,
        requisition.status,
      ),
    eventStatement(db, context, {
      entityType: "PURCHASE_REQUISITION",
      entityId: requisition.id,
      eventType: `REQUISITION_${to}`,
      fromStatus: requisition.status,
      toStatus: to,
      note: input.reason?.trim() || `Requisición ${to.toLowerCase()}.`,
      now,
      guard: {
        table: "purchase_requisitions",
        entityId: requisition.id,
        status: to,
        version: input.version + 1,
      },
    }),
    auditStatement(db, context, {
      action: `PURCHASE_REQUISITION_${to}`,
      entityType: "PURCHASE_REQUISITION",
      entityId: requisition.id,
      previousValue: {
        status: requisition.status,
        version: requisition.version,
      },
      newValue: { status: to, reason: input.reason?.trim() || null },
      now,
      guard: {
        table: "purchase_requisitions",
        entityId: requisition.id,
        status: to,
        version: input.version + 1,
      },
    }),
  ]);
  assertMutationApplied(results[0]);
}

export async function convertRequisitionToPurchaseOrder(
  context: OperationContext,
  number: string,
  input: {
    vendorId: string;
    offerId?: string | null;
    warehouseId?: string | null;
    destinationBinId?: string | null;
    expectedAt?: string | null;
    taxRate?: number;
    version: number;
  },
): Promise<{
  id: string;
  number: string;
  lines: Array<{
    id: string;
    partId: string;
    quantity: number;
    unitPrice: number;
  }>;
}> {
  assertPermission(context.session, "PURCHASE_ORDER_MANAGE");
  const requisition = await getRequisition(context, number);
  if (requisition.status !== "APPROVED") {
    throw new ApiContractError(
      409,
      "REQUISITION_NOT_APPROVED",
      "Solo una requisición aprobada puede convertirse en pedido.",
    );
  }
  const lines = await getD1()
    .prepare(
      `SELECT line.id, line.part_id AS partId, part.sku,
        part.name AS partName, part.manufacturer, line.quantity
       FROM purchase_requisition_lines line
       INNER JOIN parts part ON part.id = line.part_id
       WHERE line.purchase_requisition_id = ? ORDER BY part.sku`,
    )
    .bind(requisition.id)
    .all<RequisitionLineRow>();
  if (!lines.results?.length) {
    throw new ApiContractError(
      409,
      "EMPTY_REQUISITION",
      "La requisición no contiene líneas.",
    );
  }
  const warehouse = await defaultWarehouseAndBin(
    context,
    input.warehouseId ?? requisition.warehouseId,
  );
  const destinationBinId = input.destinationBinId ?? warehouse.binId;
  const binValid = await getD1()
    .prepare(
      `SELECT bin.id FROM warehouse_bins bin
       INNER JOIN warehouses warehouse ON warehouse.id = bin.warehouse_id
       WHERE bin.id = ? AND warehouse.id = ? AND warehouse.site_id = ? LIMIT 1`,
    )
    .bind(destinationBinId, warehouse.warehouseId, context.session.siteId)
    .first<{ id: string }>();
  if (!binValid) {
    throw new ApiContractError(
      404,
      "BIN_NOT_FOUND",
      "El bin destino no pertenece al almacén seleccionado.",
    );
  }
  const orderLines: Array<{
    id: string;
    line: RequisitionLineRow;
    offerId: string;
    vendorSku: string;
    unitPrice: number;
    currency: string;
  }> = [];
  for (const line of lines.results) {
    const offer = await getD1()
      .prepare(
        `SELECT id, vendor_sku AS vendorSku, unit_price AS unitPrice, currency
         FROM part_vendor_offers
         WHERE organization_id = ? AND part_id = ? AND vendor_id = ?
           AND status = 'ACTIVE' AND (? IS NULL OR id = ?)
         ORDER BY CASE WHEN preferred = 1 THEN 0 ELSE 1 END, price_at DESC LIMIT 1`,
      )
      .bind(
        context.session.organizationId,
        line.partId,
        input.vendorId,
        input.offerId ?? null,
        input.offerId ?? null,
      )
      .first<{
        id: string;
        vendorSku: string;
        unitPrice: number;
        currency: string;
      }>();
    if (!offer) {
      throw new ApiContractError(
        409,
        "VENDOR_NOT_APPROVED_FOR_PART",
        `El proveedor no tiene una oferta activa aprobada para ${line.sku}.`,
      );
    }
    orderLines.push({
      line,
      ...offer,
      id: operationId("purchase-order-line"),
      offerId: offer.id,
    });
  }
  const taxRate = input.taxRate ?? 21;
  const totals = purchaseOrderTotals(
    orderLines.map((item) => ({
      quantity: item.line.quantity,
      unitPrice: item.unitPrice,
    })),
    taxRate,
  );
  const now = operationNow(context);
  const orderNumber = await nextPlantNumber(context.session, "PO", now);
  const orderId = operationId("purchase-order");
  const db = getD1();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE purchase_requisitions SET status = 'CONVERTED',
          version = version + 1, updated_at = ?
         WHERE id = ? AND status = 'APPROVED' AND version = ?
           AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE requisition_id = ?)`,
      )
      .bind(now, requisition.id, input.version, requisition.id),
    db
      .prepare(
        `INSERT INTO purchase_orders
          (id, organization_id, site_id, requisition_id, vendor_id, warehouse_id,
           destination_bin_id, number, status, currency, ordered_at, expected_at,
           sent_at, received_at, cancelled_at, subtotal, tax_rate, tax_amount,
           total, created_by_id, approved_by_id, version, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, NULL, ?, NULL, NULL, NULL,
           ?, ?, ?, ?, ?, NULL, 1, ?, ?
         WHERE EXISTS (SELECT 1 FROM purchase_requisitions
           WHERE id = ? AND status = 'CONVERTED' AND version = ?)`,
      )
      .bind(
        orderId,
        context.session.organizationId,
        context.session.siteId,
        requisition.id,
        input.vendorId,
        warehouse.warehouseId,
        destinationBinId,
        orderNumber,
        orderLines[0].currency,
        input.expectedAt ?? null,
        totals.subtotal,
        taxRate,
        totals.taxAmount,
        totals.total,
        context.session.userId,
        now,
        now,
        requisition.id,
        requisition.version + 1,
      ),
  ];
  for (const item of orderLines) {
    statements.push(
      db
        .prepare(
          `INSERT INTO purchase_order_lines
            (id, purchase_order_id, part_id, vendor_offer_id, vendor_sku_snapshot,
             description_snapshot, ordered_quantity, received_quantity,
             unit_price_snapshot, line_total)
           SELECT ?, ?, ?, ?, ?, ?, ?, 0, ?, ?
           WHERE EXISTS (SELECT 1 FROM purchase_orders WHERE id = ?)`,
        )
        .bind(
          item.id,
          orderId,
          item.line.partId,
          item.offerId,
          item.vendorSku,
          item.line.partName,
          item.line.quantity,
          item.unitPrice,
          Number((item.line.quantity * item.unitPrice).toFixed(2)),
          orderId,
        ),
    );
  }
  statements.push(
    eventStatement(db, context, {
      entityType: "PURCHASE_REQUISITION",
      entityId: requisition.id,
      eventType: "REQUISITION_CONVERTED",
      fromStatus: "APPROVED",
      toStatus: "CONVERTED",
      note: `Convertida en ${orderNumber}.`,
      now,
      guard: {
        table: "purchase_requisitions",
        entityId: requisition.id,
        status: "CONVERTED",
        version: input.version + 1,
      },
    }),
    eventStatement(db, context, {
      entityType: "PURCHASE_ORDER",
      entityId: orderId,
      eventType: "PURCHASE_ORDER_CREATED",
      toStatus: "DRAFT",
      note: `Pedido creado desde ${requisition.number}.`,
      now,
      guard: {
        table: "purchase_orders",
        entityId: orderId,
        status: "DRAFT",
        version: 1,
      },
    }),
    auditStatement(db, context, {
      action: "PURCHASE_REQUISITION_CONVERTED",
      entityType: "PURCHASE_REQUISITION",
      entityId: requisition.id,
      previousValue: { status: "APPROVED" },
      newValue: { status: "CONVERTED", purchaseOrderId: orderId, orderNumber },
      now,
      guard: {
        table: "purchase_requisitions",
        entityId: requisition.id,
        status: "CONVERTED",
        version: input.version + 1,
      },
    }),
  );
  const results = await db.batch(statements);
  assertMutationApplied(results[0]);
  assertMutationApplied(results[1]);
  return {
    id: orderId,
    number: orderNumber,
    lines: orderLines.map((item) => ({
      id: item.id,
      partId: item.line.partId,
      quantity: Number(item.line.quantity),
      unitPrice: Number(item.unitPrice),
    })),
  };
}

async function getPurchaseOrder(
  context: OperationContext,
  number: string,
): Promise<PurchaseOrderRow> {
  const row = await getD1()
    .prepare(
      `SELECT po.id, po.number, po.status, po.version,
        po.vendor_id AS vendorId, po.warehouse_id AS warehouseId,
        po.destination_bin_id AS destinationBinId,
        po.requisition_id AS requisitionId,
        requisition.work_order_id AS workOrderId,
        requisition.requested_by_id AS requestedById
       FROM purchase_orders po
       INNER JOIN purchase_requisitions requisition ON requisition.id = po.requisition_id
       WHERE po.organization_id = ? AND po.site_id = ? AND po.number = ? LIMIT 1`,
    )
    .bind(context.session.organizationId, context.session.siteId, number)
    .first<PurchaseOrderRow>();
  if (!row) {
    throw new ApiContractError(
      404,
      "PURCHASE_ORDER_NOT_FOUND",
      "El pedido no existe en el centro activo.",
    );
  }
  assertWarehouseScope(context.session, row.warehouseId);
  return row;
}

async function getPurchaseOrderLines(
  orderId: string,
): Promise<PurchaseOrderLineRow[]> {
  const result = await getD1()
    .prepare(
      `SELECT line.id, line.part_id AS partId, part.sku, part.unit,
        line.ordered_quantity AS orderedQuantity,
        line.received_quantity AS receivedQuantity,
        line.unit_price_snapshot AS unitPrice
       FROM purchase_order_lines line
       INNER JOIN parts part ON part.id = line.part_id
       WHERE line.purchase_order_id = ? ORDER BY part.sku`,
    )
    .bind(orderId)
    .all<PurchaseOrderLineRow>();
  return result.results ?? [];
}

async function ensureDestinationStock(
  context: OperationContext,
  partId: string,
  binId: string,
  now: string,
): Promise<void> {
  await getD1()
    .prepare(
      `INSERT OR IGNORE INTO stock_levels
        (id, part_id, site_id, bin_id, on_hand, reserved, on_order, version, updated_at)
       SELECT ?, ?, ?, ?, 0, 0, 0, 1, ?
       WHERE EXISTS (
         SELECT 1 FROM warehouse_bins bin
         INNER JOIN warehouses warehouse ON warehouse.id = bin.warehouse_id
         WHERE bin.id = ? AND warehouse.site_id = ?
       )`,
    )
    .bind(
      operationId("stock"),
      partId,
      context.session.siteId,
      binId,
      now,
      binId,
      context.session.siteId,
    )
    .run();
}

export async function changePurchaseOrderStatus(
  context: OperationContext,
  number: string,
  input: { action: "APPROVE" | "SEND" | "CANCEL"; version: number },
): Promise<void> {
  assertPermission(context.session, "PURCHASE_ORDER_MANAGE");
  const order = await getPurchaseOrder(context, number);
  const to: PurchaseOrderStatus =
    input.action === "APPROVE"
      ? "APPROVED"
      : input.action === "SEND"
        ? "SENT"
        : "CANCELLED";
  assertPurchaseOrderTransition(order.status, to);
  const lines = await getPurchaseOrderLines(order.id);
  if (!lines.length) {
    throw new ApiContractError(
      409,
      "EMPTY_PURCHASE_ORDER",
      "El pedido no contiene líneas.",
    );
  }
  if (
    to === "CANCELLED" &&
    ["SENT", "PARTIALLY_RECEIVED"].includes(order.status)
  ) {
    const hasReceipt = lines.some((line) => Number(line.receivedQuantity) > 0);
    if (hasReceipt) {
      throw new ApiContractError(
        409,
        "RECEIVED_ORDER_CANNOT_CANCEL",
        "Un pedido con recepciones registradas no puede cancelarse.",
      );
    }
  }
  const now = operationNow(context);
  if (to === "SENT") {
    for (const line of lines) {
      await ensureDestinationStock(
        context,
        line.partId,
        order.destinationBinId,
        now,
      );
    }
  }
  const db = getD1();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE purchase_orders SET status = ?,
          approved_by_id = CASE WHEN ? = 'APPROVED' THEN ? ELSE approved_by_id END,
          ordered_at = CASE WHEN ? = 'APPROVED' THEN ? ELSE ordered_at END,
          sent_at = CASE WHEN ? = 'SENT' THEN ? ELSE sent_at END,
          cancelled_at = CASE WHEN ? = 'CANCELLED' THEN ? ELSE cancelled_at END,
          version = version + 1, updated_at = ?
         WHERE id = ? AND status = ? AND version = ?`,
      )
      .bind(
        to,
        to,
        context.session.userId,
        to,
        now,
        to,
        now,
        to,
        now,
        now,
        order.id,
        order.status,
        input.version,
      ),
  ];
  if (to === "SENT" || (to === "CANCELLED" && order.status === "SENT")) {
    const factor = to === "SENT" ? 1 : -1;
    for (const line of lines) {
      const delta =
        factor * (Number(line.orderedQuantity) - Number(line.receivedQuantity));
      statements.push(
        db
          .prepare(
            `UPDATE stock_levels SET on_order = on_order + ?, version = version + 1, updated_at = ?
             WHERE part_id = ? AND site_id = ? AND bin_id = ? AND on_order + ? >= 0
               AND EXISTS (SELECT 1 FROM purchase_orders
                 WHERE id = ? AND status = ? AND version = ?)`,
          )
          .bind(
            delta,
            now,
            line.partId,
            context.session.siteId,
            order.destinationBinId,
            delta,
            order.id,
            to,
            input.version + 1,
          ),
        db
          .prepare(
            `INSERT INTO inventory_movements
              (id, organization_id, site_id, part_id, bin_id, work_order_id,
               purchase_order_id, goods_receipt_id, stock_transfer_id, actor_id,
               movement_type, reference, reason, delta_on_hand, delta_reserved,
               delta_on_order, unit_cost, occurred_at, created_at)
             SELECT ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, 'ORDER', ?, ?, 0, 0, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM purchase_orders
               WHERE id = ? AND status = ? AND version = ?)`,
          )
          .bind(
            operationId("movement"),
            context.session.organizationId,
            context.session.siteId,
            line.partId,
            order.destinationBinId,
            order.id,
            context.session.userId,
            order.number,
            to === "SENT"
              ? "Pedido enviado a proveedor"
              : "Pedido cancelado antes de recepción",
            delta,
            line.unitPrice,
            now,
            now,
            order.id,
            to,
            input.version + 1,
          ),
      );
    }
  }
  statements.push(
    eventStatement(db, context, {
      entityType: "PURCHASE_ORDER",
      entityId: order.id,
      eventType: `PURCHASE_ORDER_${to}`,
      fromStatus: order.status,
      toStatus: to,
      note:
        to === "SENT"
          ? "Pedido enviado al proveedor; cantidades incorporadas a en pedido."
          : `Pedido ${to.toLowerCase()}.`,
      now,
      guard: {
        table: "purchase_orders",
        entityId: order.id,
        status: to,
        version: input.version + 1,
      },
    }),
    auditStatement(db, context, {
      action: `PURCHASE_ORDER_${to}`,
      entityType: "PURCHASE_ORDER",
      entityId: order.id,
      previousValue: { status: order.status, version: order.version },
      newValue: { status: to },
      now,
      guard: {
        table: "purchase_orders",
        entityId: order.id,
        status: to,
        version: input.version + 1,
      },
    }),
  );
  const results = await db.batch(statements);
  assertMutationApplied(results[0]);
  if (to === "SENT" || (to === "CANCELLED" && order.status === "SENT")) {
    for (let index = 1; index < 1 + lines.length * 2; index += 2) {
      assertMutationApplied(
        results[index],
        "La proyección en pedido ha cambiado. Actualiza y reintenta.",
      );
    }
  }
}

export async function receivePurchaseOrder(
  context: OperationContext,
  number: string,
  input: {
    idempotencyKey: string;
    externalReference?: string | null;
    receivedAt?: string | null;
    version: number;
    lines: Array<{ lineId: string; quantity: number }>;
  },
): Promise<{ id: string; number: string; created: boolean }> {
  assertPermission(context.session, "INVENTORY_RECEIVE");
  const order = await getPurchaseOrder(context, number);
  const existing = await getD1()
    .prepare(
      `SELECT id, number, purchase_order_id AS purchaseOrderId FROM goods_receipts
       WHERE organization_id = ? AND site_id = ? AND idempotency_key = ? LIMIT 1`,
    )
    .bind(
      context.session.organizationId,
      context.session.siteId,
      input.idempotencyKey,
    )
    .first<{ id: string; number: string; purchaseOrderId: string }>();
  if (existing) {
    if (existing.purchaseOrderId !== order.id) {
      throw new ApiContractError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "La clave de idempotencia ya pertenece a otra recepción.",
      );
    }
    return { id: existing.id, number: existing.number, created: false };
  }
  if (order.version !== input.version) {
    throw new ApiContractError(
      409,
      "CONCURRENT_MODIFICATION",
      "El pedido ha cambiado. Actualiza antes de recibir.",
    );
  }
  const orderLines = await getPurchaseOrderLines(order.id);
  if (!input.lines.length) {
    throw new ApiContractError(
      400,
      "EMPTY_RECEIPT",
      "Indica al menos una cantidad recibida.",
    );
  }
  const receiptLines: Array<PurchaseOrderLineRow & { quantity: number }> = [];
  const seen = new Set<string>();
  for (const received of input.lines) {
    if (seen.has(received.lineId)) {
      throw new ApiContractError(
        400,
        "DUPLICATE_RECEIPT_LINE",
        "Una línea no puede repetirse en la misma recepción.",
      );
    }
    seen.add(received.lineId);
    const line = orderLines.find(
      (candidate) => candidate.id === received.lineId,
    );
    if (!line) {
      throw new ApiContractError(
        404,
        "PURCHASE_ORDER_LINE_NOT_FOUND",
        "La línea no pertenece al pedido activo.",
      );
    }
    assertReceiptAllowed({
      status: order.status,
      ordered: Number(line.orderedQuantity),
      received: Number(line.receivedQuantity),
      quantity: received.quantity,
    });
    receiptLines.push({ ...line, quantity: received.quantity });
  }
  const projected = orderLines.map((line) => ({
    ...line,
    receivedQuantity:
      Number(line.receivedQuantity) +
      (receiptLines.find((received) => received.id === line.id)?.quantity ?? 0),
  }));
  const nextStatus: PurchaseOrderStatus = projected.every(
    (line) => Number(line.receivedQuantity) >= Number(line.orderedQuantity),
  )
    ? "RECEIVED"
    : "PARTIALLY_RECEIVED";
  assertPurchaseOrderTransition(order.status, nextStatus);
  const now = operationNow(context);
  const receivedAt = input.receivedAt ?? now;
  const receiptNumber = await nextPlantNumber(context.session, "GR", now);
  const receiptId = operationId("goods-receipt");
  const totalCost = Number(
    receiptLines
      .reduce((sum, line) => sum + line.quantity * Number(line.unitPrice), 0)
      .toFixed(2),
  );
  for (const line of receiptLines) {
    await ensureDestinationStock(
      context,
      line.partId,
      order.destinationBinId,
      now,
    );
    const projectedStock = await getD1()
      .prepare(
        `SELECT on_order AS onOrder FROM stock_levels
         WHERE part_id = ? AND site_id = ? AND bin_id = ? LIMIT 1`,
      )
      .bind(line.partId, context.session.siteId, order.destinationBinId)
      .first<{ onOrder: number }>();
    if (!projectedStock || Number(projectedStock.onOrder) < line.quantity) {
      throw new ApiContractError(
        409,
        "ON_ORDER_PROJECTION_MISMATCH",
        "La proyección en pedido no cubre la recepción. Revisa el ledger antes de continuar.",
      );
    }
  }
  const db = getD1();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO goods_receipts
          (id, organization_id, site_id, purchase_order_id, warehouse_id, number,
           idempotency_key, external_reference, received_by_id, received_at,
           status, total_cost, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?
         WHERE EXISTS (SELECT 1 FROM purchase_orders
           WHERE id = ? AND status = ? AND version = ?)`,
      )
      .bind(
        receiptId,
        context.session.organizationId,
        context.session.siteId,
        order.id,
        order.warehouseId,
        receiptNumber,
        input.idempotencyKey,
        input.externalReference?.trim() || null,
        context.session.userId,
        receivedAt,
        totalCost,
        now,
        order.id,
        order.status,
        input.version,
      ),
    db
      .prepare(
        `UPDATE purchase_orders SET status = ?,
          received_at = CASE WHEN ? = 'RECEIVED' THEN ? ELSE received_at END,
          version = version + 1, updated_at = ?
         WHERE id = ? AND status = ? AND version = ?`,
      )
      .bind(
        nextStatus,
        nextStatus,
        receivedAt,
        now,
        order.id,
        order.status,
        input.version,
      ),
  ];
  for (const line of receiptLines) {
    statements.push(
      db
        .prepare(
          `UPDATE part_site_policies
           SET average_cost = ROUND(
             ((average_cost * COALESCE((SELECT SUM(on_hand) FROM stock_levels
               WHERE part_id = ? AND site_id = ?), 0)) + (? * ?)) /
             NULLIF(COALESCE((SELECT SUM(on_hand) FROM stock_levels
               WHERE part_id = ? AND site_id = ?), 0) + ?, 0), 4)
           WHERE part_id = ? AND site_id = ?`,
        )
        .bind(
          line.partId,
          context.session.siteId,
          line.quantity,
          line.unitPrice,
          line.partId,
          context.session.siteId,
          line.quantity,
          line.partId,
          context.session.siteId,
        ),
      db
        .prepare(
          `UPDATE purchase_order_lines SET received_quantity = received_quantity + ?
           WHERE id = ? AND purchase_order_id = ?
             AND received_quantity + ? <= ordered_quantity`,
        )
        .bind(line.quantity, line.id, order.id, line.quantity),
      db
        .prepare(
          `UPDATE stock_levels SET on_hand = on_hand + ?, on_order = on_order - ?,
            version = version + 1, updated_at = ?
           WHERE part_id = ? AND site_id = ? AND bin_id = ? AND on_order >= ?`,
        )
        .bind(
          line.quantity,
          line.quantity,
          now,
          line.partId,
          context.session.siteId,
          order.destinationBinId,
          line.quantity,
        ),
      db
        .prepare(
          `INSERT INTO goods_receipt_lines
            (id, goods_receipt_id, purchase_order_line_id, part_id, bin_id,
             quantity, unit_cost_snapshot, total_cost)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          operationId("goods-receipt-line"),
          receiptId,
          line.id,
          line.partId,
          order.destinationBinId,
          line.quantity,
          line.unitPrice,
          Number((line.quantity * Number(line.unitPrice)).toFixed(2)),
        ),
      db
        .prepare(
          `INSERT INTO inventory_movements
            (id, organization_id, site_id, part_id, bin_id, work_order_id,
             purchase_order_id, goods_receipt_id, stock_transfer_id, actor_id,
             movement_type, reference, reason, delta_on_hand, delta_reserved,
             delta_on_order, unit_cost, occurred_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'RECEIPT', ?,
             'Recepción de pedido de compra', ?, 0, ?, ?, ?, ?)`,
        )
        .bind(
          operationId("movement"),
          context.session.organizationId,
          context.session.siteId,
          line.partId,
          order.destinationBinId,
          order.workOrderId,
          order.id,
          receiptId,
          context.session.userId,
          receiptNumber,
          line.quantity,
          -line.quantity,
          line.unitPrice,
          receivedAt,
          now,
        ),
    );
  }
  statements.push(
    eventStatement(db, context, {
      entityType: "PURCHASE_ORDER",
      entityId: order.id,
      eventType:
        nextStatus === "RECEIVED"
          ? "PURCHASE_ORDER_RECEIVED"
          : "PURCHASE_ORDER_PARTIALLY_RECEIVED",
      fromStatus: order.status,
      toStatus: nextStatus,
      note: `${receiptNumber}: ${receiptLines.map((line) => `${line.sku} × ${line.quantity}`).join(", ")}.`,
      now,
      guard: {
        table: "purchase_orders",
        entityId: order.id,
        status: nextStatus,
        version: input.version + 1,
      },
    }),
    auditStatement(db, context, {
      action: "GOODS_RECEIPT_POSTED",
      entityType: "GOODS_RECEIPT",
      entityId: receiptId,
      previousValue: null,
      newValue: {
        purchaseOrderId: order.id,
        receiptNumber,
        totalCost,
        lines: receiptLines.map((line) => ({
          partId: line.partId,
          quantity: line.quantity,
          unitCost: line.unitPrice,
        })),
      },
      now,
      guard: {
        table: "purchase_orders",
        entityId: order.id,
        status: nextStatus,
        version: input.version + 1,
      },
    }),
  );
  if (order.workOrderId) {
    statements.push(
      db
        .prepare(
          `INSERT INTO work_order_events
            (id, work_order_id, actor_id, event_type, from_status, to_status, note, created_at)
           VALUES (?, ?, ?, 'PART_RECEIVED', NULL, NULL, ?, ?)`,
        )
        .bind(
          operationId("wo-event"),
          order.workOrderId,
          context.session.userId,
          `${receiptNumber} recibido para ${order.number}. El material ya puede reservarse.`,
          now,
        ),
      db
        .prepare(
          `INSERT INTO notifications
            (id, organization_id, site_id, user_id, title, body, severity,
             entity_type, entity_id, read_at, created_at)
           VALUES (?, ?, ?, ?, 'Material recibido para OT', ?, 'INFO',
             'WORK_ORDER', ?, NULL, ?)`,
        )
        .bind(
          operationId("notification"),
          context.session.organizationId,
          context.session.siteId,
          order.requestedById,
          `${receiptNumber} registrado. Ya puede continuarse la intervención vinculada.`,
          order.workOrderId,
          now,
        ),
    );
  }
  const results = await db.batch(statements);
  assertMutationApplied(results[0]);
  assertMutationApplied(results[1]);
  for (let index = 0; index < receiptLines.length; index += 1) {
    assertMutationApplied(
      results[2 + index * 5 + 1],
      "La línea del pedido ha cambiado. Actualiza y reintenta.",
    );
    assertMutationApplied(
      results[2 + index * 5 + 2],
      "La proyección en pedido ha cambiado. Actualiza y reintenta.",
    );
  }
  return { id: receiptId, number: receiptNumber, created: true };
}

export async function createStockTransfer(
  context: OperationContext,
  input: {
    partId: string;
    fromBinId: string;
    toBinId: string;
    quantity: number;
    note?: string | null;
  },
): Promise<{ id: string; number: string }> {
  assertPermission(context.session, "INVENTORY_TRANSFER");
  assertPositiveProcurementQuantity(input.quantity);
  const row = await getD1()
    .prepare(
      `SELECT part.id AS partId, part.sku, part.unit,
        source.id AS sourceStockId, source.on_hand - source.reserved AS available,
        source_bin.warehouse_id AS fromWarehouseId,
        target_bin.warehouse_id AS toWarehouseId,
        source_warehouse.site_id AS sourceSiteId,
        target_warehouse.site_id AS targetSiteId,
        policy.average_cost AS unitCost
       FROM parts part
       INNER JOIN stock_levels source
         ON source.part_id = part.id AND source.bin_id = ?
       INNER JOIN warehouse_bins source_bin ON source_bin.id = source.bin_id
       INNER JOIN warehouses source_warehouse ON source_warehouse.id = source_bin.warehouse_id
       INNER JOIN warehouse_bins target_bin ON target_bin.id = ?
       INNER JOIN warehouses target_warehouse ON target_warehouse.id = target_bin.warehouse_id
       INNER JOIN part_site_policies policy
         ON policy.part_id = part.id AND policy.site_id = source.site_id
       WHERE part.id = ? AND part.organization_id = ? LIMIT 1`,
    )
    .bind(
      input.fromBinId,
      input.toBinId,
      input.partId,
      context.session.organizationId,
    )
    .first<{
      partId: string;
      sku: string;
      unit: string;
      sourceStockId: string;
      available: number;
      fromWarehouseId: string;
      toWarehouseId: string;
      sourceSiteId: string;
      targetSiteId: string;
      unitCost: number;
    }>();
  if (!row) {
    throw new ApiContractError(
      404,
      "TRANSFER_CONTEXT_NOT_FOUND",
      "No se encuentran las ubicaciones y stock indicados.",
    );
  }
  if (
    row.sourceSiteId !== context.session.siteId ||
    row.targetSiteId !== context.session.siteId
  ) {
    throw new ApiContractError(
      409,
      "CROSS_SITE_TRANSFER_UNSUPPORTED",
      "Las transferencias entre plantas requieren el futuro flujo intercentros.",
    );
  }
  assertWarehouseScope(context.session, row.fromWarehouseId);
  assertWarehouseScope(context.session, row.toWarehouseId);
  if (input.fromBinId === input.toBinId) {
    throw new ApiContractError(
      409,
      "SAME_TRANSFER_BIN",
      "El origen y el destino deben ser distintos.",
    );
  }
  if (Number(row.available) < input.quantity) {
    throw new ApiContractError(
      409,
      "INSUFFICIENT_AVAILABLE_STOCK",
      `Solo hay ${row.available} ${row.unit} disponibles en origen.`,
    );
  }
  const now = operationNow(context);
  const number = await nextPlantNumber(context.session, "TR", now);
  const id = operationId("stock-transfer");
  const db = getD1();
  await db.batch([
    db
      .prepare(
        `INSERT INTO stock_transfers
          (id, organization_id, site_id, number, from_warehouse_id,
           to_warehouse_id, requested_by_id, status, note, shipped_at,
           received_at, cancelled_at, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'CREATED', ?, NULL, NULL, NULL, 1, ?, ?)`,
      )
      .bind(
        id,
        context.session.organizationId,
        context.session.siteId,
        number,
        row.fromWarehouseId,
        row.toWarehouseId,
        context.session.userId,
        input.note?.trim() || null,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO stock_transfer_lines
          (id, stock_transfer_id, part_id, from_bin_id, to_bin_id, quantity, unit_cost_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        operationId("stock-transfer-line"),
        id,
        row.partId,
        input.fromBinId,
        input.toBinId,
        input.quantity,
        row.unitCost,
      ),
    eventStatement(db, context, {
      entityType: "STOCK_TRANSFER",
      entityId: id,
      eventType: "STOCK_TRANSFER_CREATED",
      toStatus: "CREATED",
      note: `${row.sku} × ${input.quantity} ${row.unit}.`,
      now,
    }),
    auditStatement(db, context, {
      action: "STOCK_TRANSFER_CREATED",
      entityType: "STOCK_TRANSFER",
      entityId: id,
      previousValue: null,
      newValue: {
        number,
        partId: row.partId,
        quantity: input.quantity,
        fromBinId: input.fromBinId,
        toBinId: input.toBinId,
      },
      now,
    }),
  ]);
  return { id, number };
}

async function getTransfer(
  context: OperationContext,
  number: string,
): Promise<TransferRow> {
  const row = await getD1()
    .prepare(
      `SELECT id, number, status, version FROM stock_transfers
       WHERE organization_id = ? AND site_id = ? AND number = ? LIMIT 1`,
    )
    .bind(context.session.organizationId, context.session.siteId, number)
    .first<TransferRow>();
  if (!row) {
    throw new ApiContractError(
      404,
      "STOCK_TRANSFER_NOT_FOUND",
      "La transferencia no existe en el centro activo.",
    );
  }
  return row;
}

export async function changeStockTransferStatus(
  context: OperationContext,
  number: string,
  input: { action: "DISPATCH" | "RECEIVE" | "CANCEL"; version: number },
): Promise<void> {
  assertPermission(context.session, "INVENTORY_TRANSFER");
  const transfer = await getTransfer(context, number);
  const to: TransferStatus =
    input.action === "DISPATCH"
      ? "IN_TRANSIT"
      : input.action === "RECEIVE"
        ? "RECEIVED"
        : "CANCELLED";
  assertTransferTransition(transfer.status, to);
  const result = await getD1()
    .prepare(
      `SELECT line.id, line.part_id AS partId, part.sku, part.unit,
        line.from_bin_id AS fromBinId, line.to_bin_id AS toBinId,
        line.quantity, line.unit_cost_snapshot AS unitCost
       FROM stock_transfer_lines line
       INNER JOIN parts part ON part.id = line.part_id
       WHERE line.stock_transfer_id = ?`,
    )
    .bind(transfer.id)
    .all<TransferLineRow>();
  const lines = result.results ?? [];
  if (!lines.length) {
    throw new ApiContractError(
      409,
      "EMPTY_STOCK_TRANSFER",
      "La transferencia no contiene líneas.",
    );
  }
  const now = operationNow(context);
  if (to === "RECEIVED") {
    for (const line of lines) {
      await ensureDestinationStock(context, line.partId, line.toBinId, now);
    }
  }
  const db = getD1();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE stock_transfers SET status = ?,
          shipped_at = CASE WHEN ? = 'IN_TRANSIT' THEN ? ELSE shipped_at END,
          received_at = CASE WHEN ? = 'RECEIVED' THEN ? ELSE received_at END,
          cancelled_at = CASE WHEN ? = 'CANCELLED' THEN ? ELSE cancelled_at END,
          version = version + 1, updated_at = ?
         WHERE id = ? AND status = ? AND version = ?`,
      )
      .bind(
        to,
        to,
        now,
        to,
        now,
        to,
        now,
        now,
        transfer.id,
        transfer.status,
        input.version,
      ),
  ];
  if (to === "IN_TRANSIT" || to === "RECEIVED") {
    for (const line of lines) {
      const binId = to === "IN_TRANSIT" ? line.fromBinId : line.toBinId;
      const delta =
        to === "IN_TRANSIT" ? -Number(line.quantity) : Number(line.quantity);
      statements.push(
        db
          .prepare(
            to === "IN_TRANSIT"
              ? `UPDATE stock_levels SET on_hand = on_hand - ?, version = version + 1, updated_at = ?
                 WHERE part_id = ? AND site_id = ? AND bin_id = ?
                   AND on_hand - reserved >= ?
                   AND EXISTS (SELECT 1 FROM stock_transfers
                     WHERE id = ? AND status = ? AND version = ?)`
              : `UPDATE stock_levels SET on_hand = on_hand + ?, version = version + 1, updated_at = ?
                 WHERE part_id = ? AND site_id = ? AND bin_id = ?
                   AND EXISTS (SELECT 1 FROM stock_transfers
                     WHERE id = ? AND status = ? AND version = ?)`,
          )
          .bind(
            line.quantity,
            now,
            line.partId,
            context.session.siteId,
            binId,
            ...(to === "IN_TRANSIT" ? [line.quantity] : []),
            transfer.id,
            to,
            input.version + 1,
          ),
        db
          .prepare(
            `INSERT INTO inventory_movements
              (id, organization_id, site_id, part_id, bin_id, work_order_id,
               purchase_order_id, goods_receipt_id, stock_transfer_id, actor_id,
               movement_type, reference, reason, delta_on_hand, delta_reserved,
               delta_on_order, unit_cost, occurred_at, created_at)
             SELECT ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 'TRANSFER', ?, ?, ?, 0, 0, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM stock_transfers
               WHERE id = ? AND status = ? AND version = ?)`,
          )
          .bind(
            operationId("movement"),
            context.session.organizationId,
            context.session.siteId,
            line.partId,
            binId,
            transfer.id,
            context.session.userId,
            transfer.number,
            to === "IN_TRANSIT"
              ? "Salida por transferencia interna"
              : "Entrada por transferencia interna",
            delta,
            line.unitCost,
            now,
            now,
            transfer.id,
            to,
            input.version + 1,
          ),
      );
    }
  }
  statements.push(
    eventStatement(db, context, {
      entityType: "STOCK_TRANSFER",
      entityId: transfer.id,
      eventType: `STOCK_TRANSFER_${to}`,
      fromStatus: transfer.status,
      toStatus: to,
      note:
        to === "IN_TRANSIT"
          ? "Material expedido; stock en tránsito."
          : to === "RECEIVED"
            ? "Material recibido en la ubicación destino."
            : "Transferencia cancelada sin movimiento de stock.",
      now,
      guard: {
        table: "stock_transfers",
        entityId: transfer.id,
        status: to,
        version: input.version + 1,
      },
    }),
    auditStatement(db, context, {
      action: `STOCK_TRANSFER_${to}`,
      entityType: "STOCK_TRANSFER",
      entityId: transfer.id,
      previousValue: { status: transfer.status, version: transfer.version },
      newValue: { status: to },
      now,
      guard: {
        table: "stock_transfers",
        entityId: transfer.id,
        status: to,
        version: input.version + 1,
      },
    }),
  );
  const results = await db.batch(statements);
  assertMutationApplied(results[0]);
  for (
    let index = 1;
    index <
    1 + (to === "IN_TRANSIT" || to === "RECEIVED" ? lines.length * 2 : 0);
    index += 2
  ) {
    assertMutationApplied(
      results[index],
      "El stock de la transferencia ha cambiado. Actualiza y reintenta.",
    );
  }
}
