import type { SqlValue, TenantScope } from "./shared";
import {
  normalizePage,
  normalizeQuery,
  locationScopePredicate,
  queryAll,
  queryFirst,
  warehouseScopePredicate,
} from "./shared";

const PAGE_SIZE = 24;

export type InventoryFilters = {
  q?: string | string[];
  category?: string | string[];
  stock?: string | string[];
  critical?: string | string[];
  part?: string | string[];
  page?: string | string[];
};

export type InventoryListItem = {
  id: string;
  sku: string;
  name: string;
  categoryName: string;
  unit: string;
  manufacturer: string | null;
  manufacturerRef: string | null;
  onHand: number;
  reserved: number;
  available: number;
  onOrder: number;
  minStock: number;
  maxStock: number;
  reorderPoint: number;
  averageCost: number;
  leadTimeDays: number;
  critical: number;
  binCode: string;
  warehouseName: string;
  vendorName: string | null;
  locationCount: number;
};

export type InventoryMovementRow = {
  id: string;
  movementType: string;
  reference: string;
  reason: string;
  deltaOnHand: number;
  deltaReserved: number;
  deltaOnOrder: number;
  unitCost: number;
  occurredAt: string;
  actorName: string;
  workOrderNumber: string | null;
};

export type InventoryCompatibleAsset = {
  id: string;
  code: string;
  name: string;
  relation: string;
  recommendedQuantity: number;
};

export type InventoryLocationRow = {
  id: string;
  warehouseName: string;
  zoneName: string | null;
  binCode: string;
  onHand: number;
  reserved: number;
  available: number;
  onOrder: number;
};

export type InventoryOfferRow = {
  id: string;
  vendorName: string;
  vendorSku: string;
  unitPrice: number;
  currency: string;
  minimumOrderQuantity: number;
  leadTimeDays: number;
  preferred: number;
  priceAt: string;
};

export type InventorySubstituteRow = {
  id: string;
  partId: string;
  sku: string;
  name: string;
  available: number;
  note: string | null;
};

export type InventoryListData = {
  items: InventoryListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  query: string;
  categories: Array<{ code: string; name: string }>;
  summary: {
    belowReorder: number;
    criticalStockouts: number;
    reservedUnits: number;
    onOrderUnits: number;
  };
  selected: null | {
    part: InventoryListItem & { description: string };
    movements: InventoryMovementRow[];
    assets: InventoryCompatibleAsset[];
    locations: InventoryLocationRow[];
    offers: InventoryOfferRow[];
    substitutes: InventorySubstituteRow[];
    recentConsumption: number;
  };
};

export async function listInventory(
  scope: TenantScope,
  filters: InventoryFilters,
): Promise<InventoryListData> {
  const page = normalizePage(filters.page);
  const query = normalizeQuery(filters.q);
  const category = normalizeQuery(filters.category, 30);
  const stockState = normalizeQuery(filters.stock, 30);
  const critical = normalizeQuery(filters.critical, 10);
  const selectedId = normalizeQuery(filters.part, 80);
  const warehouseScope = warehouseScopePredicate(
    scope,
    "scoped_bin.warehouse_id",
  );
  const movementWarehouseScope = warehouseScopePredicate(
    scope,
    "movement_bin.warehouse_id",
  );
  const locationWarehouseScope = warehouseScopePredicate(scope, "warehouse.id");
  const substituteWarehouseScope = warehouseScopePredicate(
    scope,
    "substitute_bin.warehouse_id",
  );
  const consumptionWarehouseScope = warehouseScopePredicate(
    scope,
    "consumption_bin.warehouse_id",
  );
  const compatibleAssetScope = locationScopePredicate(
    scope,
    "asset.functional_location_id",
  );
  const conditions = ["stock.site_id = ?", "part.status = ?"];
  const params: SqlValue[] = [scope.siteId, "ACTIVE"];

  if (query) {
    const like = `%${query}%`;
    conditions.push(
      "(part.sku LIKE ? OR part.name LIKE ? OR part.manufacturer LIKE ? OR part.manufacturer_ref LIKE ?)",
    );
    params.push(like, like, like, like);
  }
  if (category) {
    conditions.push("category.code = ?");
    params.push(category);
  }
  if (critical === "1") conditions.push("policy.critical = 1");
  if (stockState === "STOCKOUT")
    conditions.push("(stock.on_hand - stock.reserved) <= 0");
  if (stockState === "REORDER")
    conditions.push("(stock.on_hand - stock.reserved) <= policy.reorder_point");
  if (stockState === "AVAILABLE")
    conditions.push("(stock.on_hand - stock.reserved) > policy.reorder_point");
  const where = conditions.join(" AND ");

  const [countRow, items, categories, summary] = await Promise.all([
    queryFirst<{ count: number }>(
      `
      WITH stock AS (
        SELECT stock_level.part_id, stock_level.site_id,
          MIN(stock_level.bin_id) AS bin_id,
          SUM(stock_level.on_hand) AS on_hand,
          SUM(stock_level.reserved) AS reserved,
          SUM(stock_level.on_order) AS on_order, COUNT(*) AS location_count
        FROM stock_levels stock_level
        INNER JOIN warehouse_bins scoped_bin ON scoped_bin.id = stock_level.bin_id
        WHERE stock_level.site_id = ? AND ${warehouseScope.sql}
        GROUP BY stock_level.part_id, stock_level.site_id
      )
      SELECT COUNT(*) AS count
      FROM parts part
      INNER JOIN part_categories category ON category.id = part.category_id
      INNER JOIN stock ON stock.part_id = part.id
      INNER JOIN part_site_policies policy ON policy.part_id = part.id AND policy.site_id = stock.site_id
      WHERE ${where}
    `,
      [scope.siteId, ...warehouseScope.params, ...params],
    ),
    queryAll<InventoryListItem>(
      `
      WITH stock AS (
        SELECT stock_level.part_id, stock_level.site_id,
          MIN(stock_level.bin_id) AS bin_id,
          SUM(stock_level.on_hand) AS on_hand,
          SUM(stock_level.reserved) AS reserved,
          SUM(stock_level.on_order) AS on_order, COUNT(*) AS location_count
        FROM stock_levels stock_level
        INNER JOIN warehouse_bins scoped_bin ON scoped_bin.id = stock_level.bin_id
        WHERE stock_level.site_id = ? AND ${warehouseScope.sql}
        GROUP BY stock_level.part_id, stock_level.site_id
      )
      SELECT
        part.id,
        part.sku,
        part.name,
        category.name AS categoryName,
        part.unit,
        part.manufacturer,
        part.manufacturer_ref AS manufacturerRef,
        stock.on_hand AS onHand,
        stock.reserved,
        stock.on_hand - stock.reserved AS available,
        stock.on_order AS onOrder,
        policy.min_stock AS minStock,
        policy.max_stock AS maxStock,
        policy.reorder_point AS reorderPoint,
        policy.average_cost AS averageCost,
        policy.lead_time_days AS leadTimeDays,
        policy.critical,
        bin.code AS binCode,
        warehouse.name AS warehouseName,
        vendor.name AS vendorName,
        stock.location_count AS locationCount
      FROM parts part
      INNER JOIN part_categories category ON category.id = part.category_id
      INNER JOIN stock ON stock.part_id = part.id
      INNER JOIN part_site_policies policy ON policy.part_id = part.id AND policy.site_id = stock.site_id
      INNER JOIN warehouse_bins bin ON bin.id = stock.bin_id
      INNER JOIN warehouses warehouse ON warehouse.id = bin.warehouse_id
      LEFT JOIN vendors vendor ON vendor.id = policy.primary_vendor_id
      WHERE ${where}
      ORDER BY
        CASE WHEN (stock.on_hand - stock.reserved) <= 0 AND policy.critical = 1 THEN 0
             WHEN (stock.on_hand - stock.reserved) <= policy.reorder_point THEN 1 ELSE 2 END,
        policy.critical DESC,
        part.sku
      LIMIT ? OFFSET ?
    `,
      [
        scope.siteId,
        ...warehouseScope.params,
        ...params,
        PAGE_SIZE,
        (page - 1) * PAGE_SIZE,
      ],
    ),
    queryAll<{ code: string; name: string }>(
      `
      SELECT code, name FROM part_categories
      WHERE organization_id = ?
      ORDER BY name
    `,
      [scope.organizationId],
    ),
    queryFirst<{
      belowReorder: number;
      criticalStockouts: number;
      reservedUnits: number;
      onOrderUnits: number;
    }>(
      `
      WITH stock AS (
        SELECT stock_level.part_id, stock_level.site_id,
          SUM(stock_level.on_hand) AS on_hand,
          SUM(stock_level.reserved) AS reserved,
          SUM(stock_level.on_order) AS on_order
        FROM stock_levels stock_level
        INNER JOIN warehouse_bins scoped_bin ON scoped_bin.id = stock_level.bin_id
        WHERE stock_level.site_id = ? AND ${warehouseScope.sql}
        GROUP BY stock_level.part_id, stock_level.site_id
      )
      SELECT
        SUM(CASE WHEN (stock.on_hand - stock.reserved) <= policy.reorder_point THEN 1 ELSE 0 END) AS belowReorder,
        SUM(CASE WHEN (stock.on_hand - stock.reserved) <= 0 AND policy.critical = 1 THEN 1 ELSE 0 END) AS criticalStockouts,
        COALESCE(SUM(stock.reserved), 0) AS reservedUnits,
        COALESCE(SUM(stock.on_order), 0) AS onOrderUnits
      FROM stock
      INNER JOIN part_site_policies policy ON policy.part_id = stock.part_id AND policy.site_id = stock.site_id
      WHERE stock.site_id = ?
    `,
      [scope.siteId, ...warehouseScope.params, scope.siteId],
    ),
  ]);

  let selected: InventoryListData["selected"] = null;
  if (selectedId) {
    const selectedPart = await queryFirst<
      InventoryListItem & { description: string }
    >(
      `
      WITH stock AS (
        SELECT stock_level.part_id, stock_level.site_id,
          MIN(stock_level.bin_id) AS bin_id,
          SUM(stock_level.on_hand) AS on_hand,
          SUM(stock_level.reserved) AS reserved,
          SUM(stock_level.on_order) AS on_order, COUNT(*) AS location_count
        FROM stock_levels stock_level
        INNER JOIN warehouse_bins scoped_bin ON scoped_bin.id = stock_level.bin_id
        WHERE stock_level.site_id = ? AND ${warehouseScope.sql}
        GROUP BY stock_level.part_id, stock_level.site_id
      )
      SELECT
        part.id, part.sku, part.name, part.description, category.name AS categoryName,
        part.unit, part.manufacturer, part.manufacturer_ref AS manufacturerRef,
        stock.on_hand AS onHand, stock.reserved,
        stock.on_hand - stock.reserved AS available, stock.on_order AS onOrder,
        policy.min_stock AS minStock, policy.max_stock AS maxStock,
        policy.reorder_point AS reorderPoint, policy.average_cost AS averageCost,
        policy.lead_time_days AS leadTimeDays, policy.critical,
        bin.code AS binCode, warehouse.name AS warehouseName, vendor.name AS vendorName,
        stock.location_count AS locationCount
      FROM parts part
      INNER JOIN part_categories category ON category.id = part.category_id
      INNER JOIN stock ON stock.part_id = part.id
      INNER JOIN part_site_policies policy ON policy.part_id = part.id AND policy.site_id = stock.site_id
      INNER JOIN warehouse_bins bin ON bin.id = stock.bin_id
      INNER JOIN warehouses warehouse ON warehouse.id = bin.warehouse_id
      LEFT JOIN vendors vendor ON vendor.id = policy.primary_vendor_id
      WHERE part.id = ? AND part.organization_id = ?
      LIMIT 1
    `,
      [
        scope.siteId,
        ...warehouseScope.params,
        selectedId,
        scope.organizationId,
      ],
    );
    if (selectedPart) {
      const [movements, assets, locations, offers, substitutes, consumption] =
        await Promise.all([
          queryAll<InventoryMovementRow>(
            `
          SELECT movement.id, movement.movement_type AS movementType,
            movement.reference, movement.reason,
            movement.delta_on_hand AS deltaOnHand,
            movement.delta_reserved AS deltaReserved,
            movement.delta_on_order AS deltaOnOrder,
            movement.unit_cost AS unitCost,
            movement.occurred_at AS occurredAt,
            actor.full_name AS actorName,
            wo.number AS workOrderNumber
          FROM inventory_movements movement
          INNER JOIN users actor ON actor.id = movement.actor_id
          INNER JOIN warehouse_bins movement_bin ON movement_bin.id = movement.bin_id
          LEFT JOIN work_orders wo ON wo.id = movement.work_order_id
          WHERE movement.part_id = ? AND movement.site_id = ?
            AND ${movementWarehouseScope.sql}
          ORDER BY movement.occurred_at DESC
          LIMIT 12
        `,
            [selectedPart.id, scope.siteId, ...movementWarehouseScope.params],
          ),
          queryAll<InventoryCompatibleAsset>(
            `
          SELECT asset.id, asset.code, asset.name, compatibility.relation,
            compatibility.recommended_quantity AS recommendedQuantity
          FROM asset_part_compatibilities compatibility
          INNER JOIN assets asset ON asset.id = compatibility.asset_id
          WHERE compatibility.part_id = ? AND asset.site_id = ?
            AND ${compatibleAssetScope.sql}
          ORDER BY compatibility.relation DESC, asset.code
          LIMIT 8
        `,
            [selectedPart.id, scope.siteId, ...compatibleAssetScope.params],
          ),
          queryAll<InventoryLocationRow>(
            `SELECT stock.id, warehouse.name AS warehouseName,
            zone.name AS zoneName, bin.code AS binCode,
            stock.on_hand AS onHand, stock.reserved,
            stock.on_hand - stock.reserved AS available, stock.on_order AS onOrder
           FROM stock_levels stock
           INNER JOIN warehouse_bins bin ON bin.id = stock.bin_id
           INNER JOIN warehouses warehouse ON warehouse.id = bin.warehouse_id
           LEFT JOIN warehouse_zones zone ON zone.id = bin.zone_id
           WHERE stock.part_id = ? AND stock.site_id = ?
             AND ${locationWarehouseScope.sql}
           ORDER BY warehouse.code, zone.code, bin.code`,
            [selectedPart.id, scope.siteId, ...locationWarehouseScope.params],
          ),
          queryAll<InventoryOfferRow>(
            `SELECT offer.id, vendor.name AS vendorName,
            offer.vendor_sku AS vendorSku, offer.unit_price AS unitPrice,
            offer.currency, offer.minimum_order_quantity AS minimumOrderQuantity,
            offer.lead_time_days AS leadTimeDays, offer.preferred,
            offer.price_at AS priceAt
           FROM part_vendor_offers offer
           INNER JOIN vendors vendor ON vendor.id = offer.vendor_id
           WHERE offer.part_id = ? AND offer.organization_id = ? AND offer.status = 'ACTIVE'
           ORDER BY offer.preferred DESC, offer.unit_price, offer.price_at DESC`,
            [selectedPart.id, scope.organizationId],
          ),
          queryAll<InventorySubstituteRow>(
            `SELECT substitute.id, part.id AS partId, part.sku, part.name,
            COALESCE((SELECT SUM(stock.on_hand - stock.reserved)
              FROM stock_levels stock
              INNER JOIN warehouse_bins substitute_bin ON substitute_bin.id = stock.bin_id
              WHERE stock.part_id = part.id AND stock.site_id = ?
                AND ${substituteWarehouseScope.sql}), 0) AS available,
            substitute.note
           FROM part_substitutes substitute
           INNER JOIN parts part ON part.id = substitute.substitute_part_id
           WHERE substitute.part_id = ? AND substitute.organization_id = ?
             AND substitute.approval_status = 'APPROVED'
           ORDER BY part.sku`,
            [
              scope.siteId,
              ...substituteWarehouseScope.params,
              selectedPart.id,
              scope.organizationId,
            ],
          ),
          queryFirst<{ quantity: number }>(
            `SELECT COALESCE(SUM(usage.quantity), 0) AS quantity
           FROM work_order_part_usages usage
           INNER JOIN work_orders wo ON wo.id = usage.work_order_id
           INNER JOIN inventory_movements consumption_movement
             ON consumption_movement.id = usage.movement_id
           INNER JOIN warehouse_bins consumption_bin
             ON consumption_bin.id = consumption_movement.bin_id
           WHERE usage.part_id = ? AND wo.site_id = ?
             AND ${consumptionWarehouseScope.sql}
             AND usage.usage_type = 'CONSUMPTION'
             AND usage.created_at >= datetime('now', '-90 days')`,
            [
              selectedPart.id,
              scope.siteId,
              ...consumptionWarehouseScope.params,
            ],
          ),
        ]);
      selected = {
        part: selectedPart,
        movements,
        assets,
        locations,
        offers,
        substitutes,
        recentConsumption: Number(consumption?.quantity ?? 0),
      };
    }
  }

  const total = Number(countRow?.count ?? 0);
  return {
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    query,
    categories,
    summary: {
      belowReorder: Number(summary?.belowReorder ?? 0),
      criticalStockouts: Number(summary?.criticalStockouts ?? 0),
      reservedUnits: Number(summary?.reservedUnits ?? 0),
      onOrderUnits: Number(summary?.onOrderUnits ?? 0),
    },
    selected,
  };
}
