import {
  calculateCriticalSpareRisk,
  calculateReorderSuggestion,
  type CriticalSpareRisk,
} from "@/lib/domain/procurement";
import type { TenantScope } from "./shared";
import { queryAll, warehouseScopePredicate } from "./shared";
import { scopedQueries } from "./scoped-queries";

export type ProcurementRequisitionRow = {
  id: string;
  number: string;
  status: string;
  origin: string;
  urgency: string;
  needBy: string | null;
  justification: string;
  createdAt: string;
  version: number;
  requesterName: string;
  warehouseName: string;
  workOrderNumber: string | null;
  lineCount: number;
  itemSummary: string;
};

export type ProcurementOrderRow = {
  id: string;
  number: string;
  status: string;
  expectedAt: string | null;
  sentAt: string | null;
  total: number;
  currency: string;
  version: number;
  vendorName: string;
  vendorCode: string;
  warehouseName: string;
  requisitionNumber: string;
  orderedQuantity: number;
  receivedQuantity: number;
};

export type ProcurementRiskRow = {
  partId: string;
  sku: string;
  name: string;
  unit: string;
  available: number;
  onOrder: number;
  minStock: number;
  maxStock: number;
  reorderPoint: number;
  leadTimeDays: number;
  critical: number;
  approvedSubstitutes: number;
  openDemand: number;
  waitingWorkOrders: number;
  risk: CriticalSpareRisk;
  replenishment: ReturnType<typeof calculateReorderSuggestion>;
};

export type ProcurementTransferRow = {
  id: string;
  number: string;
  status: string;
  version: number;
  createdAt: string;
  shippedAt: string | null;
  receivedAt: string | null;
  fromWarehouse: string;
  toWarehouse: string;
  itemSummary: string;
};

export type ProcurementCenterData = {
  summary: {
    pendingRequisitions: number;
    pendingApproval: number;
    openOrders: number;
    delayedOrders: number;
    partialReceipts: number;
    criticalStockouts: number;
    waitingWorkOrders: number;
    recentSpend: number;
  };
  requisitions: ProcurementRequisitionRow[];
  orders: ProcurementOrderRow[];
  risks: ProcurementRiskRow[];
  transfers: ProcurementTransferRow[];
  parts: Array<{
    id: string;
    sku: string;
    name: string;
    unit: string;
    available: number;
    onOrder: number;
    suggestedQuantity: number;
  }>;
  vendors: Array<{
    id: string;
    code: string;
    name: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    leadTimeDays: number;
    paymentTerms: string;
    suppliedParts: number;
    lastPurchaseAt: string | null;
  }>;
  warehouses: Array<{ id: string; code: string; name: string }>;
  bins: Array<{
    id: string;
    warehouseId: string;
    warehouseName: string;
    zoneName: string | null;
    code: string;
  }>;
  generatedAt: string;
};

export async function getProcurementCenter(
  scope: TenantScope,
): Promise<ProcurementCenterData> {
  const { queryAll, queryFirst } = scopedQueries(scope);
  const now = new Date().toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const warehouseScope = warehouseScopePredicate(scope, "warehouse.id");
  const stockWarehouseScope = warehouseScopePredicate(
    scope,
    "stock_bin.warehouse_id",
  );
  const requisitionSummaryScope = warehouseScopePredicate(
    scope,
    "requisition.warehouse_id",
  );
  const orderSummaryScope = warehouseScopePredicate(
    scope,
    "purchase_order.warehouse_id",
  );
  const waitingSummaryScope = warehouseScopePredicate(
    scope,
    "material_bin.warehouse_id",
  );
  const demandWarehouseScope = warehouseScopePredicate(
    scope,
    "demand_bin.warehouse_id",
  );
  const waitingWarehouseScope = warehouseScopePredicate(
    scope,
    "waiting_bin.warehouse_id",
  );
  const vendorOrderScope = warehouseScopePredicate(scope, "po.warehouse_id");
  const receiptSummaryScope = warehouseScopePredicate(
    scope,
    "receipt.warehouse_id",
  );
  const transferScope =
    scope.fullWarehouseAccess === false
      ? scope.warehouseIds?.length
        ? {
            sql: `(source.id IN (${scope.warehouseIds.map(() => "?").join(",")})
              OR target.id IN (${scope.warehouseIds.map(() => "?").join(",")}))`,
            params: [...scope.warehouseIds, ...scope.warehouseIds],
          }
        : { sql: "1 = 0", params: [] }
      : { sql: "1 = 1", params: [] };
  const [
    summary,
    requisitions,
    orders,
    rawRisks,
    transfers,
    rawParts,
    vendors,
    warehouses,
    bins,
  ] = await Promise.all([
    queryFirst<ProcurementCenterData["summary"]>(
      `SELECT
          (SELECT COUNT(*) FROM scope_purchase_requisitions requisition WHERE requisition.site_id = ?
            AND requisition.status IN ('DRAFT','SUBMITTED','APPROVED')
            AND ${requisitionSummaryScope.sql}) AS pendingRequisitions,
          (SELECT COUNT(*) FROM scope_purchase_requisitions requisition WHERE requisition.site_id = ?
            AND requisition.status = 'SUBMITTED'
            AND ${requisitionSummaryScope.sql}) AS pendingApproval,
          (SELECT COUNT(*) FROM scope_purchase_orders purchase_order WHERE purchase_order.site_id = ?
            AND purchase_order.status IN ('DRAFT','APPROVED','SENT','PARTIALLY_RECEIVED')
            AND ${orderSummaryScope.sql}) AS openOrders,
          (SELECT COUNT(*) FROM scope_purchase_orders purchase_order WHERE purchase_order.site_id = ?
            AND purchase_order.status IN ('SENT','PARTIALLY_RECEIVED')
            AND purchase_order.expected_at < ? AND ${orderSummaryScope.sql}) AS delayedOrders,
          (SELECT COUNT(*) FROM scope_purchase_orders purchase_order WHERE purchase_order.site_id = ?
            AND purchase_order.status = 'PARTIALLY_RECEIVED'
            AND ${orderSummaryScope.sql}) AS partialReceipts,
          (SELECT COUNT(*) FROM part_site_policies policy
            WHERE policy.site_id = ? AND policy.critical = 1
              AND COALESCE((SELECT SUM(stock.on_hand - stock.reserved)
                FROM scope_stock_levels stock
                INNER JOIN warehouse_bins stock_bin ON stock_bin.id = stock.bin_id
                WHERE stock.part_id = policy.part_id
                  AND stock.site_id = policy.site_id
                  AND ${stockWarehouseScope.sql}), 0) <= 0) AS criticalStockouts,
          (SELECT COUNT(DISTINCT work_order.id) FROM scope_work_orders work_order
            INNER JOIN work_order_materials material ON material.work_order_id = work_order.id
            INNER JOIN warehouse_bins material_bin ON material_bin.id = material.bin_id
            WHERE work_order.site_id = ? AND work_order.status = 'WAITING_PART'
              AND ${waitingSummaryScope.sql}) AS waitingWorkOrders,
          (SELECT COALESCE(SUM(receipt.total_cost), 0) FROM scope_goods_receipts receipt
            WHERE receipt.site_id = ? AND receipt.received_at >= ?
              AND ${receiptSummaryScope.sql}) AS recentSpend`,
      [
        scope.siteId,
        ...requisitionSummaryScope.params,
        scope.siteId,
        ...requisitionSummaryScope.params,
        scope.siteId,
        ...orderSummaryScope.params,
        scope.siteId,
        now,
        ...orderSummaryScope.params,
        scope.siteId,
        ...orderSummaryScope.params,
        scope.siteId,
        ...stockWarehouseScope.params,
        scope.siteId,
        ...waitingSummaryScope.params,
        scope.siteId,
        ninetyDaysAgo,
        ...receiptSummaryScope.params,
      ],
    ),
    queryAll<ProcurementRequisitionRow>(
      `SELECT requisition.id, requisition.number, requisition.status,
          requisition.origin, requisition.urgency, requisition.need_by AS needBy,
          requisition.justification, requisition.created_at AS createdAt,
          requisition.version, requester.full_name AS requesterName,
          warehouse.name AS warehouseName, wo.number AS workOrderNumber,
          COUNT(line.id) AS lineCount,
          GROUP_CONCAT(part.sku || ' × ' || line.quantity, ', ') AS itemSummary
         FROM scope_purchase_requisitions requisition
         INNER JOIN users requester ON requester.id = requisition.requested_by_id
         INNER JOIN warehouses warehouse ON warehouse.id = requisition.warehouse_id
         INNER JOIN purchase_requisition_lines line
           ON line.purchase_requisition_id = requisition.id
         INNER JOIN parts part ON part.id = line.part_id
         LEFT JOIN scope_work_orders wo ON wo.id = requisition.work_order_id
         WHERE requisition.organization_id = ? AND requisition.site_id = ?
           AND ${warehouseScope.sql}
         GROUP BY requisition.id
         ORDER BY CASE requisition.status WHEN 'SUBMITTED' THEN 0 WHEN 'APPROVED' THEN 1
           WHEN 'DRAFT' THEN 2 ELSE 3 END,
           CASE requisition.urgency WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
           requisition.created_at DESC LIMIT 30`,
      [scope.organizationId, scope.siteId, ...warehouseScope.params],
    ),
    queryAll<ProcurementOrderRow>(
      `SELECT po.id, po.number, po.status, po.expected_at AS expectedAt,
          po.sent_at AS sentAt, po.total, po.currency, po.version,
          vendor.name AS vendorName, vendor.code AS vendorCode,
          warehouse.name AS warehouseName, requisition.number AS requisitionNumber,
          COALESCE(SUM(line.ordered_quantity), 0) AS orderedQuantity,
          COALESCE(SUM(line.received_quantity), 0) AS receivedQuantity
         FROM scope_purchase_orders po
         INNER JOIN vendors vendor ON vendor.id = po.vendor_id
         INNER JOIN warehouses warehouse ON warehouse.id = po.warehouse_id
         INNER JOIN scope_purchase_requisitions requisition ON requisition.id = po.requisition_id
         INNER JOIN purchase_order_lines line ON line.purchase_order_id = po.id
         WHERE po.organization_id = ? AND po.site_id = ?
           AND ${warehouseScope.sql}
         GROUP BY po.id
         ORDER BY CASE po.status WHEN 'PARTIALLY_RECEIVED' THEN 0 WHEN 'SENT' THEN 1
           WHEN 'APPROVED' THEN 2 WHEN 'DRAFT' THEN 3 ELSE 4 END,
           po.expected_at, po.created_at DESC LIMIT 30`,
      [scope.organizationId, scope.siteId, ...warehouseScope.params],
    ),
    queryAll<Omit<ProcurementRiskRow, "risk" | "replenishment">>(
      `SELECT part.id AS partId, part.sku, part.name, part.unit,
          COALESCE(SUM(stock.on_hand - stock.reserved), 0) AS available,
          COALESCE(SUM(stock.on_order), 0) AS onOrder,
          policy.min_stock AS minStock, policy.max_stock AS maxStock,
          policy.reorder_point AS reorderPoint,
          policy.lead_time_days AS leadTimeDays, policy.critical,
          (SELECT COUNT(*) FROM part_substitutes substitute
            WHERE substitute.part_id = part.id AND substitute.approval_status = 'APPROVED') AS approvedSubstitutes,
          COALESCE((SELECT SUM(MAX(material.planned_quantity - material.reserved_quantity - material.consumed_quantity, 0))
            FROM work_order_materials material
            INNER JOIN scope_work_orders wo ON wo.id = material.work_order_id
            INNER JOIN warehouse_bins demand_bin ON demand_bin.id = material.bin_id
            WHERE material.part_id = part.id AND wo.site_id = policy.site_id
              AND ${demandWarehouseScope.sql}
              AND wo.status IN ('REQUESTED','TRIAGE','APPROVED','PLANNED','SCHEDULED','ASSIGNED','IN_PROGRESS','PAUSED','WAITING_PART','WAITING_VENDOR')), 0) AS openDemand,
          (SELECT COUNT(DISTINCT wo.id) FROM work_order_materials material
            INNER JOIN scope_work_orders wo ON wo.id = material.work_order_id
            INNER JOIN warehouse_bins waiting_bin ON waiting_bin.id = material.bin_id
            WHERE material.part_id = part.id AND wo.site_id = policy.site_id
              AND ${waitingWarehouseScope.sql}
              AND wo.status = 'WAITING_PART') AS waitingWorkOrders
         FROM parts part
         INNER JOIN part_site_policies policy ON policy.part_id = part.id AND policy.site_id = ?
         LEFT JOIN scope_stock_levels stock ON stock.part_id = part.id
           AND stock.site_id = policy.site_id AND EXISTS (
             SELECT 1 FROM warehouse_bins stock_bin WHERE stock_bin.id = stock.bin_id
               AND ${stockWarehouseScope.sql}
           )
         WHERE part.organization_id = ? AND part.status = 'ACTIVE'
         GROUP BY part.id, policy.id
         HAVING available <= policy.reorder_point OR waitingWorkOrders > 0
         ORDER BY policy.critical DESC, available ASC, policy.lead_time_days DESC LIMIT 40`,
      [
        ...demandWarehouseScope.params,
        ...waitingWarehouseScope.params,
        scope.siteId,
        ...stockWarehouseScope.params,
        scope.organizationId,
      ],
    ),
    queryAll<ProcurementTransferRow>(
      `SELECT transfer.id, transfer.number, transfer.status, transfer.version,
          transfer.created_at AS createdAt, transfer.shipped_at AS shippedAt,
          transfer.received_at AS receivedAt,
          source.name AS fromWarehouse, target.name AS toWarehouse,
          GROUP_CONCAT(part.sku || ' × ' || line.quantity, ', ') AS itemSummary
         FROM stock_transfers transfer
         INNER JOIN warehouses source ON source.id = transfer.from_warehouse_id
         INNER JOIN warehouses target ON target.id = transfer.to_warehouse_id
         INNER JOIN stock_transfer_lines line ON line.stock_transfer_id = transfer.id
         INNER JOIN parts part ON part.id = line.part_id
         WHERE transfer.organization_id = ? AND transfer.site_id = ?
           AND ${transferScope.sql}
         GROUP BY transfer.id ORDER BY transfer.created_at DESC LIMIT 15`,
      [scope.organizationId, scope.siteId, ...transferScope.params],
    ),
    queryAll<{
      id: string;
      sku: string;
      name: string;
      unit: string;
      available: number;
      onOrder: number;
      maxStock: number;
      reorderPoint: number;
    }>(
      `SELECT part.id, part.sku, part.name, part.unit,
          COALESCE(SUM(stock.on_hand - stock.reserved), 0) AS available,
          COALESCE(SUM(stock.on_order), 0) AS onOrder,
          policy.max_stock AS maxStock, policy.reorder_point AS reorderPoint
         FROM parts part
         INNER JOIN part_site_policies policy ON policy.part_id = part.id AND policy.site_id = ?
         LEFT JOIN scope_stock_levels stock ON stock.part_id = part.id
           AND stock.site_id = policy.site_id AND EXISTS (
             SELECT 1 FROM warehouse_bins stock_bin WHERE stock_bin.id = stock.bin_id
               AND ${stockWarehouseScope.sql}
           )
         WHERE part.organization_id = ? AND part.status = 'ACTIVE'
         GROUP BY part.id, policy.id ORDER BY part.sku LIMIT 240`,
      [scope.siteId, ...stockWarehouseScope.params, scope.organizationId],
    ),
    queryAll<ProcurementCenterData["vendors"][number]>(
      `SELECT vendor.id, vendor.code, vendor.name,
          vendor.contact_name AS contactName, vendor.email, vendor.phone,
          vendor.lead_time_days AS leadTimeDays,
          vendor.payment_terms AS paymentTerms,
          COUNT(DISTINCT offer.part_id) AS suppliedParts,
          MAX(po.ordered_at) AS lastPurchaseAt
         FROM vendors vendor
         LEFT JOIN part_vendor_offers offer
           ON offer.vendor_id = vendor.id AND offer.status = 'ACTIVE'
         LEFT JOIN scope_purchase_orders po ON po.vendor_id = vendor.id
           AND po.site_id = ? AND ${vendorOrderScope.sql}
         WHERE vendor.organization_id = ? AND vendor.status = 'ACTIVE'
         GROUP BY vendor.id ORDER BY suppliedParts DESC, vendor.name`,
      [scope.siteId, ...vendorOrderScope.params, scope.organizationId],
    ),
    queryAll<ProcurementCenterData["warehouses"][number]>(
      `SELECT id, code, name FROM warehouses warehouse
         WHERE organization_id = ? AND site_id = ? AND status = 'ACTIVE'
           AND ${warehouseScope.sql}
         ORDER BY code`,
      [scope.organizationId, scope.siteId, ...warehouseScope.params],
    ),
    queryAll<ProcurementCenterData["bins"][number]>(
      `SELECT bin.id, bin.warehouse_id AS warehouseId,
          warehouse.name AS warehouseName, zone.name AS zoneName, bin.code
         FROM warehouse_bins bin
         INNER JOIN warehouses warehouse ON warehouse.id = bin.warehouse_id
         LEFT JOIN warehouse_zones zone ON zone.id = bin.zone_id
         WHERE warehouse.organization_id = ? AND warehouse.site_id = ?
           AND warehouse.status = 'ACTIVE' AND bin.status = 'ACTIVE'
           AND ${warehouseScope.sql}
         ORDER BY warehouse.code, zone.code, bin.code`,
      [scope.organizationId, scope.siteId, ...warehouseScope.params],
    ),
  ]);

  const risks = rawRisks
    .map((row) => ({
      ...row,
      risk: calculateCriticalSpareRisk({
        critical: Boolean(row.critical),
        available: Number(row.available),
        onOrder: Number(row.onOrder),
        leadTimeDays: Number(row.leadTimeDays),
        approvedSubstitutes: Number(row.approvedSubstitutes),
        openDemand: Number(row.openDemand),
        waitingWorkOrders: Number(row.waitingWorkOrders),
      }),
      replenishment: calculateReorderSuggestion({
        available: Number(row.available),
        onOrder: Number(row.onOrder),
        maxStock: Number(row.maxStock),
        reorderPoint: Number(row.reorderPoint),
      }),
    }))
    .sort((a, b) => b.risk.score - a.risk.score)
    .slice(0, 12);
  const parts = rawParts.map((part) => ({
    id: part.id,
    sku: part.sku,
    name: part.name,
    unit: part.unit,
    available: Number(part.available),
    onOrder: Number(part.onOrder),
    suggestedQuantity: calculateReorderSuggestion({
      available: Number(part.available),
      onOrder: Number(part.onOrder),
      maxStock: Number(part.maxStock),
      reorderPoint: Number(part.reorderPoint),
    }).suggestedQuantity,
  }));

  return {
    summary: summary ?? {
      pendingRequisitions: 0,
      pendingApproval: 0,
      openOrders: 0,
      delayedOrders: 0,
      partialReceipts: 0,
      criticalStockouts: 0,
      waitingWorkOrders: 0,
      recentSpend: 0,
    },
    requisitions,
    orders,
    risks,
    transfers,
    parts,
    vendors,
    warehouses,
    bins,
    generatedAt: now,
  };
}

export type RequisitionDetailData = ProcurementRequisitionRow & {
  warehouseId: string;
  approvedAt: string | null;
  approverName: string | null;
  decisionReason: string | null;
  lines: Array<{
    id: string;
    partId: string;
    sku: string;
    name: string;
    unit: string;
    quantity: number;
    availableSnapshot: number;
    onOrderSnapshot: number;
    currentAvailable: number;
    currentOnOrder: number;
  }>;
  offers: Array<{
    id: string;
    partId: string;
    vendorId: string;
    vendorCode: string;
    vendorName: string;
    vendorSku: string;
    unitPrice: number;
    currency: string;
    minimumOrderQuantity: number;
    leadTimeDays: number;
    preferred: number;
    priceAt: string;
  }>;
  purchaseOrderNumber: string | null;
  events: ProcurementEventRow[];
};

export type ProcurementEventRow = {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  createdAt: string;
  actorName: string;
};

export async function getRequisitionDetail(
  scope: TenantScope,
  number: string,
): Promise<RequisitionDetailData | null> {
  const { queryAll, queryFirst } = scopedQueries(scope);
  const warehouseScope = warehouseScopePredicate(scope, "warehouse.id");
  const requisition = await queryFirst<
    ProcurementRequisitionRow & {
      warehouseId: string;
      approvedAt: string | null;
      approverName: string | null;
      decisionReason: string | null;
      purchaseOrderNumber: string | null;
    }
  >(
    `SELECT requisition.id, requisition.number, requisition.status,
      requisition.origin, requisition.urgency, requisition.need_by AS needBy,
      requisition.justification, requisition.created_at AS createdAt,
      requisition.version, requester.full_name AS requesterName,
      warehouse.id AS warehouseId, warehouse.name AS warehouseName,
      wo.number AS workOrderNumber,
      1 AS lineCount,
      (SELECT GROUP_CONCAT(part.sku || ' × ' || line.quantity, ', ')
       FROM purchase_requisition_lines line INNER JOIN parts part ON part.id = line.part_id
       WHERE line.purchase_requisition_id = requisition.id) AS itemSummary,
      requisition.approved_at AS approvedAt, approver.full_name AS approverName,
      requisition.decision_reason AS decisionReason,
      po.number AS purchaseOrderNumber
     FROM scope_purchase_requisitions requisition
     INNER JOIN users requester ON requester.id = requisition.requested_by_id
     INNER JOIN warehouses warehouse ON warehouse.id = requisition.warehouse_id
     LEFT JOIN users approver ON approver.id = requisition.approved_by_id
     LEFT JOIN scope_work_orders wo ON wo.id = requisition.work_order_id
     LEFT JOIN scope_purchase_orders po ON po.requisition_id = requisition.id
     WHERE requisition.organization_id = ? AND requisition.site_id = ?
       AND requisition.number = ? AND ${warehouseScope.sql} LIMIT 1`,
    [scope.organizationId, scope.siteId, number, ...warehouseScope.params],
  );
  if (!requisition) return null;
  const [lines, offers, events] = await Promise.all([
    queryAll<RequisitionDetailData["lines"][number]>(
      `SELECT line.id, line.part_id AS partId, part.sku, part.name, part.unit,
        line.quantity, line.available_snapshot AS availableSnapshot,
        line.on_order_snapshot AS onOrderSnapshot,
        COALESCE((SELECT SUM(stock.on_hand - stock.reserved) FROM scope_stock_levels stock
          INNER JOIN warehouse_bins stock_bin ON stock_bin.id = stock.bin_id
          WHERE stock.part_id = part.id AND stock.site_id = ?
            AND stock_bin.warehouse_id = ?), 0) AS currentAvailable,
        COALESCE((SELECT SUM(stock.on_order) FROM scope_stock_levels stock
          INNER JOIN warehouse_bins stock_bin ON stock_bin.id = stock.bin_id
          WHERE stock.part_id = part.id AND stock.site_id = ?
            AND stock_bin.warehouse_id = ?), 0) AS currentOnOrder
       FROM purchase_requisition_lines line
       INNER JOIN parts part ON part.id = line.part_id
       WHERE line.purchase_requisition_id = ? ORDER BY part.sku`,
      [
        scope.siteId,
        requisition.warehouseId,
        scope.siteId,
        requisition.warehouseId,
        requisition.id,
      ],
    ),
    queryAll<RequisitionDetailData["offers"][number]>(
      `SELECT offer.id, offer.part_id AS partId, offer.vendor_id AS vendorId,
        vendor.code AS vendorCode, vendor.name AS vendorName,
        offer.vendor_sku AS vendorSku, offer.unit_price AS unitPrice,
        offer.currency, offer.minimum_order_quantity AS minimumOrderQuantity,
        offer.lead_time_days AS leadTimeDays, offer.preferred,
        offer.price_at AS priceAt
       FROM part_vendor_offers offer
       INNER JOIN vendors vendor ON vendor.id = offer.vendor_id
       WHERE offer.organization_id = ? AND offer.status = 'ACTIVE'
         AND offer.part_id IN (SELECT part_id FROM purchase_requisition_lines
           WHERE purchase_requisition_id = ?)
       ORDER BY offer.preferred DESC, offer.unit_price, offer.price_at DESC`,
      [scope.organizationId, requisition.id],
    ),
    getProcurementEvents(scope, "PURCHASE_REQUISITION", requisition.id),
  ]);
  return { ...requisition, lines, offers, events };
}

export type PurchaseOrderDetailData = ProcurementOrderRow & {
  orderedAt: string | null;
  receivedAt: string | null;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  destinationBin: string;
  contactName: string | null;
  vendorEmail: string | null;
  paymentTerms: string;
  workOrderNumber: string | null;
  lines: Array<{
    id: string;
    partId: string;
    sku: string;
    name: string;
    unit: string;
    vendorSku: string;
    orderedQuantity: number;
    receivedQuantity: number;
    outstandingQuantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  receipts: Array<{
    id: string;
    number: string;
    externalReference: string | null;
    receivedAt: string;
    receiverName: string;
    totalCost: number;
    itemSummary: string;
  }>;
  events: ProcurementEventRow[];
};

export async function getPurchaseOrderDetail(
  scope: TenantScope,
  number: string,
): Promise<PurchaseOrderDetailData | null> {
  const { queryAll, queryFirst } = scopedQueries(scope);
  const warehouseScope = warehouseScopePredicate(scope, "warehouse.id");
  const order = await queryFirst<
    Omit<PurchaseOrderDetailData, "lines" | "receipts" | "events">
  >(
    `SELECT po.id, po.number, po.status, po.expected_at AS expectedAt,
      po.sent_at AS sentAt, po.received_at AS receivedAt,
      po.ordered_at AS orderedAt, po.total, po.subtotal,
      po.tax_rate AS taxRate, po.tax_amount AS taxAmount, po.currency, po.version,
      vendor.name AS vendorName, vendor.code AS vendorCode,
      vendor.contact_name AS contactName, vendor.email AS vendorEmail,
      vendor.payment_terms AS paymentTerms,
      warehouse.name AS warehouseName, bin.code AS destinationBin,
      requisition.number AS requisitionNumber, wo.number AS workOrderNumber,
      COALESCE((SELECT SUM(ordered_quantity) FROM purchase_order_lines
        WHERE purchase_order_id = po.id), 0) AS orderedQuantity,
      COALESCE((SELECT SUM(received_quantity) FROM purchase_order_lines
        WHERE purchase_order_id = po.id), 0) AS receivedQuantity
     FROM scope_purchase_orders po
     INNER JOIN vendors vendor ON vendor.id = po.vendor_id
     INNER JOIN warehouses warehouse ON warehouse.id = po.warehouse_id
     INNER JOIN warehouse_bins bin ON bin.id = po.destination_bin_id
     INNER JOIN scope_purchase_requisitions requisition ON requisition.id = po.requisition_id
     LEFT JOIN scope_work_orders wo ON wo.id = requisition.work_order_id
     WHERE po.organization_id = ? AND po.site_id = ? AND po.number = ?
       AND ${warehouseScope.sql} LIMIT 1`,
    [scope.organizationId, scope.siteId, number, ...warehouseScope.params],
  );
  if (!order) return null;
  const [lines, receipts, events] = await Promise.all([
    queryAll<PurchaseOrderDetailData["lines"][number]>(
      `SELECT line.id, line.part_id AS partId, part.sku, part.name, part.unit,
        line.vendor_sku_snapshot AS vendorSku,
        line.ordered_quantity AS orderedQuantity,
        line.received_quantity AS receivedQuantity,
        line.ordered_quantity - line.received_quantity AS outstandingQuantity,
        line.unit_price_snapshot AS unitPrice, line.line_total AS lineTotal
       FROM purchase_order_lines line INNER JOIN parts part ON part.id = line.part_id
       WHERE line.purchase_order_id = ? ORDER BY part.sku`,
      [order.id],
    ),
    queryAll<PurchaseOrderDetailData["receipts"][number]>(
      `SELECT receipt.id, receipt.number,
        receipt.external_reference AS externalReference,
        receipt.received_at AS receivedAt, receiver.full_name AS receiverName,
        receipt.total_cost AS totalCost,
        GROUP_CONCAT(part.sku || ' × ' || line.quantity, ', ') AS itemSummary
       FROM scope_goods_receipts receipt
       INNER JOIN users receiver ON receiver.id = receipt.received_by_id
       INNER JOIN goods_receipt_lines line ON line.goods_receipt_id = receipt.id
       INNER JOIN parts part ON part.id = line.part_id
       WHERE receipt.purchase_order_id = ?
       GROUP BY receipt.id ORDER BY receipt.received_at DESC`,
      [order.id],
    ),
    getProcurementEvents(scope, "PURCHASE_ORDER", order.id),
  ]);
  return { ...order, lines, receipts, events };
}

async function getProcurementEvents(
  scope: TenantScope,
  entityType: string,
  entityId: string,
): Promise<ProcurementEventRow[]> {
  return queryAll<ProcurementEventRow>(
    `SELECT event.id, event.event_type AS eventType,
      event.from_status AS fromStatus, event.to_status AS toStatus,
      event.note, event.created_at AS createdAt, actor.full_name AS actorName
     FROM procurement_events event
     INNER JOIN users actor ON actor.id = event.actor_id
     WHERE event.organization_id = ? AND event.site_id = ?
       AND event.entity_type = ? AND event.entity_id = ?
     ORDER BY event.created_at DESC`,
    [scope.organizationId, scope.siteId, entityType, entityId],
  );
}
