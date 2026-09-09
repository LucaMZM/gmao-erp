import { dateKeyInTimeZone } from "@/lib/presentation";
import { calendarAvailability } from "@/lib/domain/production-calendar";
import { getProductionExposure } from "./governance";
import type { TenantScope } from "./shared";
import { queryAll, queryFirst } from "./shared";

const OPEN_STATES =
  "('REQUESTED','TRIAGE','APPROVED','PLANNED','SCHEDULED','ASSIGNED','IN_PROGRESS','PAUSED','WAITING_PART','WAITING_VENDOR')";

type MetricRow = {
  openOrders: number;
  overdueOrders: number;
  criticalAssets: number;
  riskAssets: number;
  backlogMinutes: number;
  correctiveCount: number;
  correctiveMinutes: number;
  pmScheduled: number;
  pmOnTime: number;
  pmOverdue: number;
  downtimeMinutes: number;
  productionLines: number;
  openIncidents: number;
  criticalIncidents: number;
};

export type OverviewArea = {
  code: string;
  name: string;
  assetCount: number;
  averageHealth: number;
  degradedCount: number;
  downCount: number;
  openOrders: number;
  availability: number;
};

export type OverviewRisk = {
  id: string;
  code: string;
  name: string;
  healthScore: number;
  criticality: string;
  status: string;
  locationName: string;
  openOrders: number;
};

export type OverviewPriorityOrder = {
  id: string;
  number: string;
  title: string;
  priority: string;
  status: string;
  dueAt: string | null;
  assetCode: string;
  assetName: string;
  assigneeName: string | null;
};

export type OverviewPlanItem = {
  id: string;
  number: string;
  title: string;
  plannedStart: string;
  estimatedMinutes: number;
  assigneeName: string | null;
  assetCode: string;
  status: string;
};

export type OverviewReliabilitySignal = {
  assetId: string;
  assetCode: string;
  assetName: string;
  failures: number;
  recentFailures: number;
  previousFailures: number;
  downtimeMinutes: number;
  kind: "DETERIORATING" | "REPEAT_FAILURE" | "CRITICAL_DOWNTIME";
  explanation: string;
};

export type OverviewData = {
  kpis: {
    availability: number;
    openOrders: number;
    overdueOrders: number;
    pmCompliance: number;
    pmScheduled: number;
    pmOnTime: number;
    pmOverdue: number;
    mttrMinutes: number;
    backlogHours: number;
    criticalAssets: number;
    riskAssets: number;
    openIncidents: number;
    criticalIncidents: number;
  };
  areas: OverviewArea[];
  risks: OverviewRisk[];
  priorityOrders: OverviewPriorityOrder[];
  todayPlan: OverviewPlanItem[];
  reliabilitySignals: OverviewReliabilitySignal[];
  supply: {
    criticalStockouts: number;
    delayedOrders: number;
    partialReceipts: number;
    waitingPartOrders: number;
  };
  generatedAt: string;
};

export async function getOverview(scope: TenantScope): Promise<OverviewData> {
  const now = new Date().toISOString();
  const today = dateKeyInTimeZone(now);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();

  const metrics = await queryFirst<MetricRow>(
    `
    SELECT
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.site_id = ? AND wo.status IN ${OPEN_STATES}) AS openOrders,
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.site_id = ? AND wo.status IN ${OPEN_STATES} AND wo.due_at < ?) AS overdueOrders,
      (SELECT COUNT(*) FROM assets a WHERE a.site_id = ? AND a.criticality = 'CRITICAL' AND a.status != 'RETIRED') AS criticalAssets,
      (SELECT COUNT(*) FROM assets a WHERE a.site_id = ? AND a.status != 'RETIRED' AND (a.health_score < 75 OR a.status IN ('DOWN','DEGRADED'))) AS riskAssets,
      (SELECT COALESCE(SUM(estimated_minutes),0) FROM work_orders wo WHERE wo.site_id = ? AND wo.status IN ${OPEN_STATES}) AS backlogMinutes,
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.site_id = ? AND wo.type = 'CORRECTIVE' AND wo.status IN ('COMPLETED','CLOSED') AND wo.actual_end >= ?) AS correctiveCount,
      (SELECT COALESCE(SUM(downtime_minutes),0) FROM work_orders wo WHERE wo.site_id = ? AND wo.type = 'CORRECTIVE' AND wo.status IN ('COMPLETED','CLOSED') AND wo.actual_end >= ?) AS correctiveMinutes,
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.site_id = ?
        AND wo.maintenance_plan_id IS NOT NULL
        AND COALESCE(wo.preventive_due_at, wo.due_at) BETWEEN ? AND ?
        AND wo.status <> 'CANCELLED') AS pmScheduled,
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.site_id = ?
        AND wo.maintenance_plan_id IS NOT NULL
        AND COALESCE(wo.preventive_due_at, wo.due_at) BETWEEN ? AND ?
        AND wo.completed_at IS NOT NULL
        AND wo.completed_at <= COALESCE(wo.preventive_due_at, wo.due_at)) AS pmOnTime,
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.site_id = ?
        AND wo.maintenance_plan_id IS NOT NULL
        AND COALESCE(wo.preventive_due_at, wo.due_at) BETWEEN ? AND ?
        AND wo.status <> 'CANCELLED'
        AND (wo.completed_at IS NULL OR wo.completed_at > COALESCE(wo.preventive_due_at, wo.due_at))) AS pmOverdue,
      (SELECT COALESCE(SUM(duration_minutes),0) FROM downtime_events d WHERE d.site_id = ? AND d.started_at >= ?) AS downtimeMinutes,
      (SELECT COUNT(*) FROM assets a INNER JOIN asset_classes c ON c.id = a.asset_class_id WHERE a.site_id = ? AND a.parent_asset_id IS NULL AND c.code IN ('PRINT_LINE','LAM_LINE','COAT_LINE','SLITTER')) AS productionLines,
      (SELECT COUNT(*) FROM incidents incident WHERE incident.site_id = ? AND incident.status IN ('NEW','IN_TRIAGE','ACCEPTED')) AS openIncidents,
      (SELECT COUNT(*) FROM incidents incident WHERE incident.site_id = ? AND incident.status IN ('NEW','IN_TRIAGE','ACCEPTED') AND incident.severity = 'CRITICAL') AS criticalIncidents
  `,
    [
      scope.siteId,
      scope.siteId,
      now,
      scope.siteId,
      scope.siteId,
      scope.siteId,
      scope.siteId,
      ninetyDaysAgo,
      scope.siteId,
      ninetyDaysAgo,
      scope.siteId,
      thirtyDaysAgo,
      now,
      scope.siteId,
      thirtyDaysAgo,
      now,
      scope.siteId,
      thirtyDaysAgo,
      now,
      scope.siteId,
      thirtyDaysAgo,
      scope.siteId,
      scope.siteId,
      scope.siteId,
    ],
  );

  const safe = metrics ?? {
    openOrders: 0,
    overdueOrders: 0,
    criticalAssets: 0,
    riskAssets: 0,
    backlogMinutes: 0,
    correctiveCount: 0,
    correctiveMinutes: 0,
    pmScheduled: 0,
    pmOnTime: 0,
    pmOverdue: 0,
    downtimeMinutes: 0,
    productionLines: 1,
    openIncidents: 0,
    criticalIncidents: 0,
  };
  const supply = await queryFirst<OverviewData["supply"]>(
    `SELECT
      (SELECT COUNT(*) FROM part_site_policies policy
       WHERE policy.site_id = ? AND policy.critical = 1
         AND COALESCE((SELECT SUM(stock.on_hand - stock.reserved)
           FROM stock_levels stock WHERE stock.part_id = policy.part_id
             AND stock.site_id = policy.site_id), 0) <= 0) AS criticalStockouts,
      (SELECT COUNT(*) FROM purchase_orders WHERE site_id = ?
       AND status IN ('SENT','PARTIALLY_RECEIVED') AND expected_at < ?) AS delayedOrders,
      (SELECT COUNT(*) FROM purchase_orders WHERE site_id = ?
       AND status = 'PARTIALLY_RECEIVED') AS partialReceipts,
      (SELECT COUNT(*) FROM work_orders WHERE site_id = ?
       AND status = 'WAITING_PART') AS waitingPartOrders`,
    [scope.siteId, scope.siteId, now, scope.siteId, scope.siteId],
  );
  const calendarExposure = await getProductionExposure(
    scope.siteId,
    new Date(thirtyDaysAgo),
    new Date(now),
  );
  const scheduledMinutes = calendarExposure * Math.max(1, safe.productionLines);
  const availability =
    calendarAvailability(scheduledMinutes, safe.downtimeMinutes) ?? 0;

  const areaRows = await queryAll<
    Omit<OverviewArea, "availability"> & { downtimeMinutes: number }
  >(
    `
    SELECT
      COALESCE(parent.code, location.code) AS code,
      COALESCE(parent.name, location.name) AS name,
      COUNT(DISTINCT asset.id) AS assetCount,
      ROUND(AVG(asset.health_score), 0) AS averageHealth,
      SUM(CASE WHEN asset.status = 'DEGRADED' THEN 1 ELSE 0 END) AS degradedCount,
      SUM(CASE WHEN asset.status = 'DOWN' THEN 1 ELSE 0 END) AS downCount,
      COUNT(DISTINCT CASE WHEN wo.status IN ${OPEN_STATES} THEN wo.id END) AS openOrders,
      COALESCE((SELECT SUM(down.duration_minutes)
        FROM downtime_events down
        INNER JOIN assets down_asset ON down_asset.id = down.asset_id
        INNER JOIN functional_locations down_location ON down_location.id = down_asset.functional_location_id
        LEFT JOIN functional_locations down_parent ON down_parent.id = down_location.parent_id
        WHERE down.site_id = ? AND down.started_at >= ?
          AND COALESCE(down_parent.code, down_location.code) = COALESCE(parent.code, location.code)), 0) AS downtimeMinutes
    FROM assets asset
    INNER JOIN functional_locations location ON location.id = asset.functional_location_id
    LEFT JOIN functional_locations parent ON parent.id = location.parent_id
    LEFT JOIN work_orders wo ON wo.asset_id = asset.id
    WHERE asset.site_id = ? AND asset.parent_asset_id IS NULL
    GROUP BY COALESCE(parent.code, location.code), COALESCE(parent.name, location.name)
    ORDER BY averageHealth ASC, name ASC
    LIMIT 8
  `,
    [scope.siteId, thirtyDaysAgo, scope.siteId],
  );
  const areas = areaRows.map(({ downtimeMinutes, ...area }) => ({
    ...area,
    availability:
      calendarAvailability(
        calendarExposure * Math.max(1, Number(area.assetCount)),
        Number(downtimeMinutes),
      ) ?? 0,
  }));

  const risks = await queryAll<OverviewRisk>(
    `
    SELECT
      asset.id,
      asset.code,
      asset.name,
      asset.health_score AS healthScore,
      asset.criticality,
      asset.status,
      location.name AS locationName,
      COUNT(wo.id) AS openOrders
    FROM assets asset
    INNER JOIN functional_locations location ON location.id = asset.functional_location_id
    LEFT JOIN work_orders wo ON wo.asset_id = asset.id AND wo.status IN ${OPEN_STATES}
    WHERE asset.site_id = ?
      AND asset.status != 'RETIRED'
      AND (asset.health_score < 76 OR asset.status IN ('DOWN','DEGRADED'))
    GROUP BY asset.id
    ORDER BY
      CASE asset.criticality WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END,
      asset.health_score ASC
    LIMIT 5
  `,
    [scope.siteId],
  );

  const priorityOrders = await queryAll<OverviewPriorityOrder>(
    `
    SELECT
      wo.id,
      wo.number,
      wo.title,
      wo.priority,
      wo.status,
      wo.due_at AS dueAt,
      asset.code AS assetCode,
      asset.name AS assetName,
      (SELECT user.full_name
       FROM work_order_assignments assignment
       INNER JOIN users user ON user.id = assignment.user_id
       WHERE assignment.work_order_id = wo.id AND assignment.unassigned_at IS NULL
       ORDER BY assignment.assigned_at DESC, assignment.id
       LIMIT 1) AS assigneeName
    FROM work_orders wo
    INNER JOIN assets asset ON asset.id = wo.asset_id
    WHERE wo.site_id = ? AND wo.status IN ${OPEN_STATES}
    ORDER BY
      CASE wo.priority WHEN 'P1_EMERGENCY' THEN 1 WHEN 'P2_URGENT' THEN 2 WHEN 'P3_HIGH' THEN 3 ELSE 4 END,
      wo.due_at ASC
    LIMIT 7
  `,
    [scope.siteId],
  );

  const todayPlan = await queryAll<OverviewPlanItem>(
    `
    SELECT
      wo.id,
      wo.number,
      wo.title,
      wo.planned_start AS plannedStart,
      wo.estimated_minutes AS estimatedMinutes,
      (SELECT user.full_name
       FROM work_order_assignments assignment
       INNER JOIN users user ON user.id = assignment.user_id
       WHERE assignment.work_order_id = wo.id AND assignment.unassigned_at IS NULL
       ORDER BY assignment.assigned_at DESC, assignment.id
       LIMIT 1) AS assigneeName,
      asset.code AS assetCode,
      wo.status
    FROM work_orders wo
    INNER JOIN assets asset ON asset.id = wo.asset_id
    WHERE wo.site_id = ? AND substr(wo.planned_start, 1, 10) = ?
    ORDER BY wo.planned_start
    LIMIT 6
  `,
    [scope.siteId, today],
  );

  const reliabilityRows = await queryAll<
    Omit<OverviewReliabilitySignal, "kind" | "explanation">
  >(
    `SELECT asset.id AS assetId, asset.code AS assetCode, asset.name AS assetName,
      COUNT(*) AS failures,
      SUM(CASE WHEN wo.requested_at >= ? THEN 1 ELSE 0 END) AS recentFailures,
      SUM(CASE WHEN wo.requested_at >= ? AND wo.requested_at < ? THEN 1 ELSE 0 END) AS previousFailures,
      COALESCE(SUM((SELECT COALESCE(SUM(d.duration_minutes), 0)
        FROM downtime_events d WHERE d.work_order_id = wo.id)), 0) AS downtimeMinutes
     FROM work_orders wo INNER JOIN assets asset ON asset.id = wo.asset_id
     WHERE wo.site_id = ? AND wo.type = 'CORRECTIVE'
       AND wo.status IN ('COMPLETED','CLOSED') AND wo.requested_at >= ?
     GROUP BY asset.id HAVING COUNT(*) >= 2 OR downtimeMinutes >= 300
     ORDER BY recentFailures DESC, downtimeMinutes DESC LIMIT 3`,
    [
      thirtyDaysAgo,
      new Date(Date.now() - 60 * 86_400_000).toISOString(),
      thirtyDaysAgo,
      scope.siteId,
      ninetyDaysAgo,
    ],
  );
  const reliabilitySignals: OverviewReliabilitySignal[] = reliabilityRows.map(
    (row) => {
      const failures = Number(row.failures);
      const recentFailures = Number(row.recentFailures);
      const previousFailures = Number(row.previousFailures);
      const downtimeMinutes = Number(row.downtimeMinutes);
      const kind =
        recentFailures >= 2 && recentFailures > previousFailures
          ? "DETERIORATING"
          : failures >= 2
            ? "REPEAT_FAILURE"
            : "CRITICAL_DOWNTIME";
      return {
        ...row,
        failures,
        recentFailures,
        previousFailures,
        downtimeMinutes,
        kind,
        explanation:
          kind === "DETERIORATING"
            ? `${recentFailures} fallos en 30 días frente a ${previousFailures} en el periodo anterior.`
            : kind === "REPEAT_FAILURE"
              ? `${failures} fallos y ${downtimeMinutes} min de downtime en 90 días.`
              : `${downtimeMinutes} min de downtime acumulado en 90 días.`,
      };
    },
  );

  return {
    kpis: {
      availability: Number(availability.toFixed(1)),
      openOrders: Number(safe.openOrders),
      overdueOrders: Number(safe.overdueOrders),
      pmCompliance:
        safe.pmScheduled > 0
          ? Number(((safe.pmOnTime / safe.pmScheduled) * 100).toFixed(1))
          : 100,
      pmScheduled: Number(safe.pmScheduled),
      pmOnTime: Number(safe.pmOnTime),
      pmOverdue: Number(safe.pmOverdue),
      mttrMinutes:
        safe.correctiveCount > 0
          ? Math.round(safe.correctiveMinutes / safe.correctiveCount)
          : 0,
      backlogHours: Number((safe.backlogMinutes / 60).toFixed(1)),
      criticalAssets: Number(safe.criticalAssets),
      riskAssets: Number(safe.riskAssets),
      openIncidents: Number(safe.openIncidents),
      criticalIncidents: Number(safe.criticalIncidents),
    },
    areas,
    risks,
    priorityOrders,
    todayPlan,
    reliabilitySignals,
    supply: supply ?? {
      criticalStockouts: 0,
      delayedOrders: 0,
      partialReceipts: 0,
      waitingPartOrders: 0,
    },
    generatedAt: now,
  };
}
