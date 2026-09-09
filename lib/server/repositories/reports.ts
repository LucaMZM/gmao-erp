import type { DemoUserSession } from "@/lib/server/auth";
export { reportingCsv } from "@/lib/domain/reporting";
import { getProductionExposure } from "./governance";
import { queryAll, queryFirst } from "./shared";

export type ReportFilters = { from: string; to: string };

export async function getReportingData(
  session: DemoUserSession,
  filters: ReportFilters,
) {
  const from = `${filters.from}T00:00:00.000Z`;
  const to = `${filters.to}T23:59:59.999Z`;
  const calendarExposureMinutes = await getProductionExposure(
    session.siteId,
    new Date(from),
    new Date(to),
  );
  const productionUnits = await queryFirst<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM assets asset
     INNER JOIN asset_classes class ON class.id = asset.asset_class_id
     WHERE asset.organization_id = ? AND asset.site_id = ?
       AND asset.parent_asset_id IS NULL AND asset.status <> 'RETIRED'
       AND class.code IN ('PRINT_LINE','LAM_LINE','COAT_LINE','SLITTER')`,
    [session.organizationId, session.siteId],
  );
  const exposureMinutes =
    calendarExposureMinutes * Math.max(1, Number(productionUnits?.count ?? 0));
  const summary = await queryFirst<{
    workOrders: number;
    completed: number;
    backlog: number;
    downtimeMinutes: number;
    mttrMinutes: number;
    failureCount: number;
    laborCents: number;
    materialCents: number;
    explicitCents: number;
    pmScheduled: number;
    pmOnTime: number;
    purchaseCents: number;
  }>(
    `SELECT
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.site_id = ? AND wo.requested_at BETWEEN ? AND ?) AS workOrders,
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.site_id = ? AND wo.completed_at BETWEEN ? AND ?) AS completed,
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.site_id = ? AND wo.status NOT IN ('COMPLETED','CLOSED','CANCELLED')) AS backlog,
      (SELECT COALESCE(SUM(duration_minutes),0) FROM downtime_events WHERE site_id = ? AND started_at BETWEEN ? AND ?) AS downtimeMinutes,
      (SELECT COALESCE(AVG(downtime_minutes),0) FROM work_orders WHERE site_id = ? AND type = 'CORRECTIVE' AND completed_at BETWEEN ? AND ?) AS mttrMinutes,
      (SELECT COUNT(*) FROM work_orders WHERE site_id = ? AND type = 'CORRECTIVE' AND completed_at BETWEEN ? AND ?) AS failureCount,
      (SELECT COALESCE(SUM(labor.labor_cost_cents),0) FROM labor_sessions labor INNER JOIN work_orders wo ON wo.id = labor.work_order_id WHERE wo.site_id = ? AND labor.started_at BETWEEN ? AND ?) AS laborCents,
      (SELECT COALESCE(ROUND(SUM(usage.total_cost) * 100),0) FROM work_order_part_usages usage INNER JOIN work_orders wo ON wo.id = usage.work_order_id WHERE wo.site_id = ? AND usage.created_at BETWEEN ? AND ?) AS materialCents,
      (SELECT COALESCE(SUM(amount_cents),0) FROM work_order_cost_items WHERE site_id = ? AND recorded_at BETWEEN ? AND ?) AS explicitCents,
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.site_id = ? AND wo.maintenance_plan_id IS NOT NULL AND COALESCE(wo.preventive_due_at,wo.due_at) BETWEEN ? AND ? AND wo.status <> 'CANCELLED') AS pmScheduled,
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.site_id = ? AND wo.maintenance_plan_id IS NOT NULL AND COALESCE(wo.preventive_due_at,wo.due_at) BETWEEN ? AND ? AND wo.completed_at <= COALESCE(wo.preventive_due_at,wo.due_at)) AS pmOnTime,
      (SELECT COALESCE(ROUND(SUM(line.line_total) * 100),0) FROM purchase_order_lines line INNER JOIN purchase_orders po ON po.id = line.purchase_order_id WHERE po.site_id = ? AND po.created_at BETWEEN ? AND ? AND po.status <> 'CANCELLED') AS purchaseCents`,
    [
      session.siteId,
      from,
      to,
      session.siteId,
      from,
      to,
      session.siteId,
      session.siteId,
      from,
      to,
      session.siteId,
      from,
      to,
      session.siteId,
      from,
      to,
      session.siteId,
      from,
      to,
      session.siteId,
      from,
      to,
      session.siteId,
      from,
      to,
      session.siteId,
      from,
      to,
      session.siteId,
      from,
      to,
      session.siteId,
      from,
      to,
    ],
  );
  const safe = summary!;
  const costsByAsset = await queryAll<{
    code: string;
    name: string;
    laborCents: number;
    materialCents: number;
    explicitCents: number;
    totalCents: number;
    downtimeMinutes: number;
  }>(
    `SELECT asset.code, asset.name,
      COALESCE((SELECT SUM(labor.labor_cost_cents) FROM labor_sessions labor INNER JOIN work_orders lwo ON lwo.id = labor.work_order_id WHERE lwo.asset_id = asset.id AND labor.started_at BETWEEN ? AND ?),0) AS laborCents,
      COALESCE((SELECT ROUND(SUM(usage.total_cost) * 100) FROM work_order_part_usages usage INNER JOIN work_orders mwo ON mwo.id = usage.work_order_id WHERE mwo.asset_id = asset.id AND usage.created_at BETWEEN ? AND ?),0) AS materialCents,
      COALESCE((SELECT SUM(cost.amount_cents) FROM work_order_cost_items cost INNER JOIN work_orders cwo ON cwo.id = cost.work_order_id WHERE cwo.asset_id = asset.id AND cost.recorded_at BETWEEN ? AND ?),0) AS explicitCents,
      COALESCE((SELECT SUM(labor.labor_cost_cents) FROM labor_sessions labor INNER JOIN work_orders lwo ON lwo.id = labor.work_order_id WHERE lwo.asset_id = asset.id AND labor.started_at BETWEEN ? AND ?),0)
        + COALESCE((SELECT ROUND(SUM(usage.total_cost) * 100) FROM work_order_part_usages usage INNER JOIN work_orders mwo ON mwo.id = usage.work_order_id WHERE mwo.asset_id = asset.id AND usage.created_at BETWEEN ? AND ?),0)
        + COALESCE((SELECT SUM(cost.amount_cents) FROM work_order_cost_items cost INNER JOIN work_orders cwo ON cwo.id = cost.work_order_id WHERE cwo.asset_id = asset.id AND cost.recorded_at BETWEEN ? AND ?),0) AS totalCents,
      COALESCE((SELECT SUM(duration_minutes) FROM downtime_events down WHERE down.asset_id = asset.id AND down.started_at BETWEEN ? AND ?),0) AS downtimeMinutes
     FROM assets asset WHERE asset.organization_id = ? AND asset.site_id = ?
     ORDER BY totalCents DESC, downtimeMinutes DESC LIMIT 12`,
    [
      from,
      to,
      from,
      to,
      from,
      to,
      from,
      to,
      from,
      to,
      from,
      to,
      from,
      to,
      session.organizationId,
      session.siteId,
    ],
  );
  const technicians = await queryAll<{
    name: string;
    sessions: number;
    minutes: number;
    costCents: number;
  }>(
    `SELECT user.full_name AS name, COUNT(labor.id) AS sessions,
      COALESCE(SUM(labor.minutes),0) AS minutes,
      COALESCE(SUM(labor.labor_cost_cents),0) AS costCents
     FROM users user
     INNER JOIN labor_sessions labor ON labor.user_id = user.id
     INNER JOIN work_orders wo ON wo.id = labor.work_order_id
     WHERE wo.site_id = ? AND labor.started_at BETWEEN ? AND ?
     GROUP BY user.id ORDER BY minutes DESC`,
    [session.siteId, from, to],
  );
  const costsByArea = await queryAll<{
    code: string;
    name: string;
    totalCents: number;
    downtimeMinutes: number;
  }>(
    `WITH RECURSIVE hierarchy(id, area_code, area_name) AS (
       SELECT id, code, name FROM functional_locations
       WHERE site_id = ? AND type = 'AREA'
       UNION ALL
       SELECT child.id, parent.area_code, parent.area_name
       FROM functional_locations child
       INNER JOIN hierarchy parent ON child.parent_id = parent.id
     ), labor_cost AS (
       SELECT work_order_id, SUM(labor_cost_cents) AS cents
       FROM labor_sessions WHERE started_at BETWEEN ? AND ? GROUP BY work_order_id
     ), material_cost AS (
       SELECT work_order_id, ROUND(SUM(total_cost) * 100) AS cents
       FROM work_order_part_usages WHERE created_at BETWEEN ? AND ? GROUP BY work_order_id
     ), explicit_cost AS (
       SELECT work_order_id, SUM(amount_cents) AS cents
       FROM work_order_cost_items WHERE recorded_at BETWEEN ? AND ? GROUP BY work_order_id
     ), downtime_cost AS (
       SELECT work_order_id, SUM(duration_minutes) AS minutes
       FROM downtime_events WHERE started_at BETWEEN ? AND ? GROUP BY work_order_id
     )
     SELECT hierarchy.area_code AS code, hierarchy.area_name AS name,
       COALESCE(SUM(COALESCE(labor_cost.cents,0) + COALESCE(material_cost.cents,0) + COALESCE(explicit_cost.cents,0)),0) AS totalCents,
       COALESCE(SUM(COALESCE(downtime_cost.minutes,0)),0) AS downtimeMinutes
     FROM work_orders work_order
     INNER JOIN assets asset ON asset.id = work_order.asset_id
     INNER JOIN hierarchy ON hierarchy.id = asset.functional_location_id
     LEFT JOIN labor_cost ON labor_cost.work_order_id = work_order.id
     LEFT JOIN material_cost ON material_cost.work_order_id = work_order.id
     LEFT JOIN explicit_cost ON explicit_cost.work_order_id = work_order.id
     LEFT JOIN downtime_cost ON downtime_cost.work_order_id = work_order.id
     WHERE work_order.organization_id = ? AND work_order.site_id = ?
     GROUP BY hierarchy.area_code, hierarchy.area_name
     HAVING totalCents > 0 OR downtimeMinutes > 0
     ORDER BY totalCents DESC, downtimeMinutes DESC`,
    [
      session.siteId,
      from,
      to,
      from,
      to,
      from,
      to,
      from,
      to,
      session.organizationId,
      session.siteId,
    ],
  );
  const totalCostCents =
    Number(safe.laborCents) +
    Number(safe.materialCents) +
    Number(safe.explicitCents);
  return {
    summary: {
      ...safe,
      exposureMinutes,
      availability:
        exposureMinutes > 0
          ? Math.max(
              0,
              (1 - Number(safe.downtimeMinutes) / exposureMinutes) * 100,
            )
          : null,
      pmCompliance:
        Number(safe.pmScheduled) > 0
          ? (Number(safe.pmOnTime) / Number(safe.pmScheduled)) * 100
          : null,
      mtbfMinutes:
        Number(safe.failureCount) > 0
          ? exposureMinutes / Number(safe.failureCount)
          : null,
      totalCostCents,
    },
    costsByAsset,
    costsByArea,
    technicians,
    filters,
  };
}
