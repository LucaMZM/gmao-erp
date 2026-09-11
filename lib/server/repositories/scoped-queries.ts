import {
  locationScopePredicate,
  warehouseScopePredicate,
  queryAll,
  queryFirst,
  type TenantScope,
  type SqlValue,
} from "./shared";

/** Common SQL visibility boundary for cross-domain aggregates. Repositories
 * explicitly use scope_* relations so detail, totals and exports share scope.
 * Filtering happens in SQLite, before aggregation, pagination or projection.
 */
export function scopedQueries(scope: TenantScope) {
  const area = locationScopePredicate(scope, "entity.functional_location_id");
  const warehouse = warehouseScopePredicate(scope, "entity.warehouse_id");
  const params: SqlValue[] = [
    scope.organizationId,
    scope.siteId,
    ...area.params,
    ...area.params,
    scope.userId ?? null,
    ...area.params,
    ...warehouse.params,
  ];
  const ctes = `scope_context AS (SELECT ? AS organization_id, ? AS site_id), scope_assets AS (
    SELECT entity.* FROM assets entity WHERE entity.organization_id = (SELECT organization_id FROM scope_context) AND entity.site_id = (SELECT site_id FROM scope_context) AND ${area.sql}
  ), scope_work_orders AS (
    SELECT entity.* FROM work_orders entity WHERE entity.organization_id = (SELECT organization_id FROM scope_context) AND entity.site_id = (SELECT site_id FROM scope_context) AND ${area.sql}
  ), scope_field_orders AS (
    SELECT work.* FROM scope_work_orders work WHERE ${scope.roleKey === "TECHNICIAN" ? "EXISTS (SELECT 1 FROM work_order_assignments assignment WHERE assignment.work_order_id = work.id AND assignment.user_id = (SELECT user_id FROM scope_actor) AND assignment.unassigned_at IS NULL)" : "1 = 1"}
  ), scope_actor AS (SELECT ? AS user_id), scope_incidents AS (
    SELECT entity.* FROM incidents entity WHERE entity.organization_id = (SELECT organization_id FROM scope_context) AND entity.site_id = (SELECT site_id FROM scope_context) AND ${area.sql}
  ), scope_warehouses AS (
    SELECT entity.* FROM warehouses entity WHERE entity.organization_id = (SELECT organization_id FROM scope_context) AND entity.site_id = (SELECT site_id FROM scope_context) AND ${warehouse.sql.replaceAll("entity.warehouse_id", "entity.id")}
  ), scope_stock_levels AS (
    SELECT stock.* FROM stock_levels stock INNER JOIN warehouse_bins bin ON bin.id = stock.bin_id
    WHERE bin.warehouse_id IN (SELECT id FROM scope_warehouses)
  ), scope_maintenance_plans AS (
    SELECT plan.* FROM maintenance_plans plan WHERE plan.asset_id IN (SELECT id FROM scope_assets)
  ), scope_meters AS (
    SELECT meter.* FROM meters meter WHERE meter.asset_id IN (SELECT id FROM scope_assets)
  ), scope_root_cause_analyses AS (
    SELECT rca.* FROM root_cause_analyses rca WHERE rca.asset_id IN (SELECT id FROM scope_assets)
  ), scope_downtime_events AS (
    SELECT down.* FROM downtime_events down WHERE down.asset_id IN (SELECT id FROM scope_assets)
  ), scope_work_order_part_usages AS (
    SELECT usage.* FROM work_order_part_usages usage
    INNER JOIN inventory_movements movement ON movement.id = usage.movement_id
    INNER JOIN warehouse_bins bin ON bin.id = movement.bin_id
    WHERE usage.work_order_id IN (SELECT id FROM scope_work_orders)
      AND bin.warehouse_id IN (SELECT id FROM scope_warehouses)
  ), scope_work_order_cost_items AS (
    SELECT cost.* FROM work_order_cost_items cost WHERE cost.work_order_id IN (SELECT id FROM scope_work_orders)
  ), scope_purchase_requisitions AS (
    SELECT pr.* FROM purchase_requisitions pr WHERE pr.warehouse_id IN (SELECT id FROM scope_warehouses)
      AND (pr.work_order_id IS NULL OR pr.work_order_id IN (SELECT id FROM scope_work_orders))
  ), scope_purchase_orders AS (
    SELECT po.* FROM purchase_orders po WHERE po.warehouse_id IN (SELECT id FROM scope_warehouses)
      AND po.requisition_id IN (SELECT id FROM scope_purchase_requisitions)
  ), scope_goods_receipts AS (
    SELECT receipt.* FROM goods_receipts receipt WHERE receipt.purchase_order_id IN (SELECT id FROM scope_purchase_orders)
  ), scope_shift_handovers AS (
    SELECT handover.* FROM shift_handovers handover
    WHERE handover.organization_id = (SELECT organization_id FROM scope_context)
      AND ${scope.permissionCodes?.includes("workorder.execute") ? "1=1" : "1=0"}
      AND handover.site_id = (SELECT site_id FROM scope_context)
      AND (${scope.fullAreaAccess === true && scope.roleKey !== "TECHNICIAN" ? "1" : "0"} = 1 OR (
        EXISTS (SELECT 1 FROM shift_handover_work_orders link WHERE link.handover_id = handover.id)
        AND NOT EXISTS (SELECT 1 FROM shift_handover_work_orders link WHERE link.handover_id = handover.id
          AND link.work_order_id NOT IN (SELECT id FROM scope_field_orders))
      ))
  ), scope_notifications AS (
    SELECT notification.* FROM notifications notification
    WHERE notification.organization_id = (SELECT organization_id FROM scope_context)
      AND notification.site_id = (SELECT site_id FROM scope_context)
      AND CASE notification.entity_type
        WHEN 'WORK_ORDER' THEN notification.entity_id IN (SELECT id FROM scope_field_orders)
        WHEN 'ASSET' THEN notification.entity_id IN (SELECT id FROM scope_assets)
        WHEN 'INCIDENT' THEN ${scope.permissionCodes?.includes("incident.report") ? "1=1" : "1=0"} AND notification.entity_id IN (SELECT id FROM scope_incidents)
        WHEN 'SHIFT_HANDOVER' THEN notification.entity_id IN (SELECT id FROM scope_shift_handovers)
        WHEN 'MAINTENANCE_PLAN' THEN ${scope.permissionCodes?.includes("preventive.manage") ? "1=1" : "1=0"} AND notification.entity_id IN (SELECT id FROM scope_maintenance_plans)
        WHEN 'PURCHASE_REQUISITION' THEN ${scope.permissionCodes?.some((code) => code === "procurement.approve" || code === "procurement.receive") ? "1=1" : "1=0"} AND notification.entity_id IN (SELECT id FROM scope_purchase_requisitions)
        WHEN 'PURCHASE_ORDER' THEN ${scope.permissionCodes?.some((code) => code === "procurement.approve" || code === "procurement.receive") ? "1=1" : "1=0"} AND notification.entity_id IN (SELECT id FROM scope_purchase_orders)
        WHEN 'INVENTORY' THEN ${scope.fullWarehouseAccess === true ? "1" : "0"}
        ELSE 0 END
  ), scope_audit_entries AS (
    SELECT audit.* FROM audit_entries audit
    WHERE audit.organization_id = (SELECT organization_id FROM scope_context)
      AND audit.site_id = (SELECT site_id FROM scope_context)
      AND (${scope.fullAreaAccess === true && scope.fullWarehouseAccess === true ? "1" : "0"} = 1 OR CASE audit.entity_type
        WHEN 'WORK_ORDER' THEN audit.entity_id IN (SELECT id FROM scope_work_orders)
        WHEN 'ASSET' THEN audit.entity_id IN (SELECT id FROM scope_assets)
        WHEN 'INCIDENT' THEN audit.entity_id IN (SELECT id FROM scope_incidents)
        WHEN 'MAINTENANCE_PLAN' THEN audit.entity_id IN (SELECT id FROM scope_maintenance_plans)
        WHEN 'METER' THEN audit.entity_id IN (SELECT id FROM scope_meters)
        WHEN 'ROOT_CAUSE_ANALYSIS' THEN audit.entity_id IN (SELECT id FROM scope_root_cause_analyses)
        WHEN 'DOWNTIME' THEN audit.entity_id IN (SELECT id FROM scope_downtime_events)
        WHEN 'SHIFT_HANDOVER' THEN audit.entity_id IN (SELECT id FROM scope_shift_handovers)
        WHEN 'PURCHASE_REQUISITION' THEN audit.entity_id IN (SELECT id FROM scope_purchase_requisitions)
        WHEN 'PURCHASE_ORDER' THEN audit.entity_id IN (SELECT id FROM scope_purchase_orders)
        WHEN 'GOODS_RECEIPT' THEN audit.entity_id IN (SELECT id FROM scope_goods_receipts)
        WHEN 'WORK_ORDER_MATERIAL' THEN audit.entity_id IN (
          SELECT material.id FROM work_order_materials material INNER JOIN warehouse_bins bin ON bin.id = material.bin_id
          WHERE material.work_order_id IN (SELECT id FROM scope_work_orders) AND bin.warehouse_id IN (SELECT id FROM scope_warehouses))
        ELSE 0 END)
  )`;
  const withScope = (sql: string) =>
    /^\s*WITH\s+(?:RECURSIVE\s+)?/i.test(sql)
      ? sql.replace(/^\s*WITH\s+(?:RECURSIVE\s+)?/i, `WITH RECURSIVE ${ctes}, `)
      : `WITH RECURSIVE ${ctes} ${sql}`;
  return {
    queryAll: <T>(sql: string, values: SqlValue[] = []) =>
      queryAll<T>(withScope(sql), [...params, ...values]),
    queryFirst: <T>(sql: string, values: SqlValue[] = []) =>
      queryFirst<T>(withScope(sql), [...params, ...values]),
  };
}
