import { scopedQueries } from "./scoped-queries";
import {
  calculateHealthScore,
  calculateTrend,
  classifyFailurePattern,
  type HealthBreakdownItem,
  type TrendDirection,
} from "@/lib/domain/reliability";
import type { TenantScope } from "./shared";

const OPEN_STATES =
  "('REQUESTED','TRIAGE','APPROVED','PLANNED','SCHEDULED','ASSIGNED','IN_PROGRESS','PAUSED','WAITING_PART','WAITING_VENDOR')";

function daysBefore(value: string, days: number): string {
  return new Date(new Date(value).getTime() - days * 86_400_000).toISOString();
}

function safeNumber(value: number | null | undefined): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

function reliabilityMetrics(input: {
  failures: number;
  downtimeMinutes: number;
  repairMinutes: number;
  repairSamples: number;
  exposureMinutes: number;
}) {
  const operatingMinutes = Math.max(
    0,
    input.exposureMinutes - input.downtimeMinutes,
  );
  return {
    failureCount: input.failures,
    downtimeMinutes: input.downtimeMinutes,
    averageDowntimeMinutes:
      input.failures > 0 ? input.downtimeMinutes / input.failures : null,
    mtbfMinutes: input.failures >= 2 ? operatingMinutes / input.failures : null,
    mttrMinutes:
      input.repairSamples > 0
        ? input.repairMinutes / input.repairSamples
        : null,
    availability: Math.max(
      0,
      Math.min(
        100,
        ((input.exposureMinutes - input.downtimeMinutes) /
          input.exposureMinutes) *
          100,
      ),
    ),
  };
}

type AssetMetricRow = {
  id: string;
  code: string;
  name: string;
  criticality: string;
  status: string;
  commissionedAt: string | null;
  areaCode: string;
  areaName: string;
  failures: number;
  repeatedFailures: number;
  emergencyFailures: number;
  repairMinutes: number;
  repairSamples: number;
  downtimeMinutes: number;
  downtimeMinutes30: number;
  overdueWorkOrders: number;
  overduePreventive: number;
  openIncidents: number;
  criticalIncidents: number;
  criticalBacklog: number;
  recentCompletedMaintenance: number;
  preventiveOrders: number;
  maintenanceCost: number;
  mroQuantity: number;
};

export type ReliabilityBadActor = {
  id: string;
  code: string;
  name: string;
  areaCode: string;
  areaName: string;
  criticality: string;
  status: string;
  healthScore: number;
  healthBreakdown: HealthBreakdownItem[];
  failureCount: number;
  downtimeMinutes: number;
  averageDowntimeMinutes: number | null;
  mtbfMinutes: number | null;
  mttrMinutes: number | null;
  availability: number;
  repeatFailureRate: number | null;
  emergencyCorrectiveRatio: number | null;
  preventiveCorrectiveRatio: number | null;
  maintenanceCost: number;
  mroQuantity: number;
  impactScore: number;
};

export type FailureSignal = {
  assetId: string;
  assetCode: string;
  assetName: string;
  failureModeId: string | null;
  failureModeCode: string;
  failureModeName: string;
  category: string;
  count90: number;
  recent30: number;
  previous30: number;
  downtimeMinutes: number;
  firstAt: string;
  lastAt: string;
  pattern: "GROWING" | "RECURRENT" | "STABLE" | "ISOLATED";
  explanation: string;
  causes: string[];
  effects: string[];
};

export type ReliabilityRca = {
  id: string;
  number: string;
  problem: string;
  impact: string;
  status: string;
  targetAt: string | null;
  assetCode: string;
  assetName: string;
  failureModeName: string | null;
  ownerName: string;
  openActions: number;
};

export type PreventiveEffectiveness = {
  planId: string;
  planCode: string;
  planTitle: string;
  assetCode: string;
  assetName: string;
  pmWindows: number;
  pmOnTime: number;
  compliance: number | null;
  correctiveCount: number;
  indicator: "EFFECTIVE" | "ATTENTION" | "LOW_COMPLIANCE" | "INSUFFICIENT";
  explanation: string;
};

export type ReliabilityTrend = {
  key: "failures" | "downtime" | "mttr";
  label: string;
  direction: TrendDirection;
  current: number;
  previous: number;
  changePercent: number | null;
  unit: string;
};

export type ReliabilityCenterData = {
  window: { days: 90; startsAt: string; endsAt: string; basis: string };
  summary: {
    failureCount: number;
    downtimeMinutes: number;
    averageDowntimeMinutes: number | null;
    mtbfMinutes: number | null;
    mttrMinutes: number | null;
    availability: number;
    repeatFailureRate: number | null;
    emergencyCorrectiveRatio: number | null;
    preventiveCorrectiveRatio: number | null;
    maintenanceCost: number;
    mroQuantity: number;
    insufficient: string[];
  };
  badActors: ReliabilityBadActor[];
  signals: FailureSignal[];
  pareto: {
    downtimeByAsset: Array<{
      id: string;
      label: string;
      value: number;
      share: number;
      cumulativeShare: number;
    }>;
    downtimeByArea: Array<{
      id: string;
      label: string;
      value: number;
      share: number;
      cumulativeShare: number;
    }>;
    failuresByMode: Array<{
      id: string;
      label: string;
      value: number;
      share: number;
      cumulativeShare: number;
    }>;
    costByAsset: Array<{
      id: string;
      label: string;
      value: number;
      share: number;
      cumulativeShare: number;
    }>;
    mroByAsset: Array<{
      id: string;
      label: string;
      value: number;
      share: number;
      cumulativeShare: number;
    }>;
  };
  downtime: Array<{
    key: string;
    label: string;
    minutes: number;
    events: number;
    share: number;
  }>;
  trends: ReliabilityTrend[];
  preventiveEffectiveness: PreventiveEffectiveness[];
  rcas: ReliabilityRca[];
  catalogs: {
    assets: Array<{ id: string; code: string; name: string }>;
    failureModes: Array<{ id: string; code: string; name: string }>;
    owners: Array<{ id: string; name: string }>;
  };
};

function assetMetricQuery(scope: TenantScope, now: string, assetId?: string) {
  const start90 = daysBefore(now, 90);
  const start30 = daysBefore(now, 30);
  const assetFilter = assetId ? "AND asset.id = ?" : "";
  const params: Array<string | number | null> = [
    now,
    start90,
    start90,
    start30,
    start90,
    now,
    now,
    start30,
    start90,
    start90,
    start90,
    start90,
    scope.organizationId,
    scope.siteId,
  ];
  if (assetId) params.push(assetId);
  return {
    sql: `
    WITH metric_cutoff AS (SELECT ? AS ends_at), failure_groups AS (
      SELECT wo.asset_id, COUNT(*) AS occurrences
      FROM scope_work_orders wo
      WHERE wo.type='CORRECTIVE' AND wo.status IN ('COMPLETED','CLOSED') AND wo.requested_at >= ? AND wo.requested_at <= (SELECT ends_at FROM metric_cutoff)
      GROUP BY wo.asset_id, COALESCE(wo.failure_mode_id,wo.failure_mode)
    ), recurrence AS (
      SELECT asset_id,SUM(occurrences-1) AS repeatedFailures FROM failure_groups GROUP BY asset_id
    ), failure AS (
      SELECT wo.asset_id AS assetId,
        COUNT(*) AS failures,
        SUM(CASE WHEN wo.priority = 'P1_EMERGENCY' THEN 1 ELSE 0 END) AS emergencyFailures,
        SUM(CASE WHEN wo.actual_start IS NOT NULL AND wo.actual_end IS NOT NULL
          THEN MAX(0, (julianday(wo.actual_end) - julianday(wo.actual_start)) * 1440)
          ELSE 0 END) AS repairMinutes,
        SUM(CASE WHEN wo.actual_start IS NOT NULL AND wo.actual_end IS NOT NULL THEN 1 ELSE 0 END) AS repairSamples
      FROM scope_work_orders wo
      WHERE wo.type = 'CORRECTIVE' AND wo.status IN ('COMPLETED','CLOSED')
        AND wo.requested_at >= ? AND wo.requested_at <= (SELECT ends_at FROM metric_cutoff)
      GROUP BY wo.asset_id
    ), downtime AS (
      SELECT d.asset_id AS assetId,
        SUM(d.duration_minutes) AS downtimeMinutes,
        SUM(CASE WHEN d.started_at >= ? THEN d.duration_minutes ELSE 0 END) AS downtimeMinutes30
      FROM scope_downtime_events d WHERE d.started_at >= ?
        AND d.started_at <= (SELECT ends_at FROM metric_cutoff)
        AND d.kind <> 'PLANNED'
        AND (d.work_order_id IS NULL OR EXISTS (
          SELECT 1 FROM scope_work_orders downtime_work
          WHERE downtime_work.id = d.work_order_id AND downtime_work.type = 'CORRECTIVE'
        ))
      GROUP BY d.asset_id
    ), work AS (
      SELECT wo.asset_id AS assetId,
        SUM(CASE WHEN wo.status IN ${OPEN_STATES} AND wo.due_at < ? THEN 1 ELSE 0 END) AS overdueWorkOrders,
        SUM(CASE WHEN wo.maintenance_plan_id IS NOT NULL AND wo.status IN ${OPEN_STATES}
          AND COALESCE(wo.preventive_due_at, wo.due_at) < ? THEN 1 ELSE 0 END) AS overduePreventive,
        SUM(CASE WHEN wo.status IN ${OPEN_STATES} AND wo.priority IN ('P1_EMERGENCY','P2_URGENT') THEN 1 ELSE 0 END) AS criticalBacklog,
        SUM(CASE WHEN wo.status IN ('COMPLETED','CLOSED') AND wo.actual_end >= ? THEN 1 ELSE 0 END) AS recentCompletedMaintenance,
        SUM(CASE WHEN wo.maintenance_plan_id IS NOT NULL AND wo.requested_at >= ? AND wo.status <> 'CANCELLED' THEN 1 ELSE 0 END) AS preventiveOrders
      FROM scope_work_orders wo WHERE wo.requested_at <= (SELECT ends_at FROM metric_cutoff) GROUP BY wo.asset_id
    ), incident AS (
      SELECT i.asset_id AS assetId,
        COUNT(*) AS openIncidents,
        SUM(CASE WHEN i.severity = 'CRITICAL' THEN 1 ELSE 0 END) AS criticalIncidents
      FROM scope_incidents i
      WHERE i.status IN ('NEW','IN_TRIAGE','ACCEPTED')
      GROUP BY i.asset_id
    ), material AS (
      SELECT wo.asset_id AS assetId,
        SUM(usage.total_cost) AS maintenanceCost,
        SUM(CASE WHEN usage.usage_type = 'RETURN' THEN -usage.quantity ELSE usage.quantity END) AS mroQuantity
      FROM scope_work_order_part_usages usage
      INNER JOIN scope_work_orders wo ON wo.id = usage.work_order_id
      WHERE usage.created_at >= ? AND usage.created_at <= (SELECT ends_at FROM metric_cutoff)
      GROUP BY wo.asset_id
    ), metric_rows AS (
    SELECT asset.id, asset.code, asset.name, asset.criticality, asset.status,
      asset.commissioned_at AS commissionedAt,
      COALESCE(area.code, location.code) AS areaCode,
      COALESCE(area.name, location.name) AS areaName,
      COALESCE(failure.failures, 0) AS failures,
      COALESCE(recurrence.repeatedFailures, 0) AS repeatedFailures,
      COALESCE(failure.emergencyFailures, 0) AS emergencyFailures,
      COALESCE(failure.repairMinutes, 0) AS repairMinutes,
      COALESCE(failure.repairSamples, 0) AS repairSamples,
      COALESCE(downtime.downtimeMinutes, 0) AS downtimeMinutes,
      COALESCE(downtime.downtimeMinutes30, 0) AS downtimeMinutes30,
      COALESCE(work.overdueWorkOrders, 0) AS overdueWorkOrders,
      COALESCE(work.overduePreventive, 0) AS overduePreventive,
      COALESCE(incident.openIncidents, 0) AS openIncidents,
      COALESCE(incident.criticalIncidents, 0) AS criticalIncidents,
      COALESCE(work.criticalBacklog, 0) AS criticalBacklog,
      COALESCE(work.recentCompletedMaintenance, 0) AS recentCompletedMaintenance,
      COALESCE(work.preventiveOrders, 0) AS preventiveOrders,
      COALESCE(material.maintenanceCost, 0)
        + COALESCE((SELECT SUM(labor.labor_cost_cents) / 100.0
          FROM labor_sessions labor INNER JOIN scope_work_orders labor_work ON labor_work.id = labor.work_order_id
          WHERE labor_work.asset_id = asset.id AND labor.started_at >= ? AND labor.started_at <= (SELECT ends_at FROM metric_cutoff)), 0)
        + COALESCE((SELECT SUM(cost.amount_cents) / 100.0
          FROM scope_work_order_cost_items cost INNER JOIN scope_work_orders cost_work ON cost_work.id = cost.work_order_id
          WHERE cost_work.asset_id = asset.id AND cost.recorded_at >= ? AND cost.recorded_at <= (SELECT ends_at FROM metric_cutoff)), 0) AS maintenanceCost,
      COALESCE(material.mroQuantity, 0) AS mroQuantity
    FROM scope_assets asset
    INNER JOIN functional_locations location ON location.id = asset.functional_location_id
    LEFT JOIN functional_locations area ON area.id = location.parent_id
    LEFT JOIN failure ON failure.assetId = asset.id
    LEFT JOIN recurrence ON recurrence.asset_id = asset.id
    LEFT JOIN downtime ON downtime.assetId = asset.id
    LEFT JOIN work ON work.assetId = asset.id
    LEFT JOIN incident ON incident.assetId = asset.id
    LEFT JOIN material ON material.assetId = asset.id
    WHERE asset.organization_id = ? AND asset.site_id = ? AND asset.status <> 'RETIRED'
      ${assetFilter}
    )`,
    params,
  };
}

async function loadAssetRows(
  scope: TenantScope,
  now: string,
  assetId?: string,
): Promise<AssetMetricRow[]> {
  const query = assetMetricQuery(scope, now, assetId);
  return scopedQueries(scope).queryAll<AssetMetricRow>(
    `${query.sql}
    SELECT * FROM metric_rows ORDER BY (downtimeMinutes*2+failures*120) DESC,criticality,code LIMIT 250`,
    query.params,
  );
}

async function loadAssetPopulation(scope: TenantScope, now: string) {
  const query = assetMetricQuery(scope, now);
  return scopedQueries(scope).queryFirst<{
    assets: number;
    failures: number;
    repeated: number;
    downtime: number;
    repair: number;
    samples: number;
    preventive: number;
    emergency: number;
    cost: number;
    mro: number;
  }>(
    `${query.sql} SELECT COUNT(*) AS assets,COALESCE(SUM(failures),0) AS failures,COALESCE(SUM(repeatedFailures),0) AS repeated,
    COALESCE(SUM(downtimeMinutes),0) AS downtime,COALESCE(SUM(repairMinutes),0) AS repair,
    COALESCE(SUM(repairSamples),0) AS samples,COALESCE(SUM(preventiveOrders),0) AS preventive,
    COALESCE(SUM(emergencyFailures),0) AS emergency,COALESCE(SUM(maintenanceCost),0) AS cost,
    COALESCE(SUM(mroQuantity),0) AS mro FROM metric_rows`,
    query.params,
  );
}

async function loadPopulationPareto(
  scope: TenantScope,
  now: string,
): Promise<ReliabilityCenterData["pareto"]> {
  const query = assetMetricQuery(scope, now);
  type Dimension = keyof ReliabilityCenterData["pareto"];
  const rows = await scopedQueries(scope).queryAll<{
    dimension: Dimension;
    id: string;
    label: string;
    value: number;
    share: number;
    cumulativeShare: number;
  }>(
    `${query.sql}, dimensions AS (
    SELECT 'downtimeByAsset' AS dimension,id,code || ' · ' || name AS label,downtimeMinutes AS value FROM metric_rows
    UNION ALL SELECT 'downtimeByArea',areaCode,areaName,SUM(downtimeMinutes) FROM metric_rows GROUP BY areaCode,areaName
    UNION ALL SELECT 'costByAsset',id,code || ' · ' || name,maintenanceCost FROM metric_rows
    UNION ALL SELECT 'mroByAsset',id,code || ' · ' || name,mroQuantity FROM metric_rows
    UNION ALL SELECT 'failuresByMode',COALESCE(mode.code,'UNCLASSIFIED'),COALESCE(mode.name,'Sin clasificar'),COUNT(*)
      FROM scope_work_orders wo INNER JOIN scope_assets asset ON asset.id=wo.asset_id LEFT JOIN failure_modes mode ON mode.id=wo.failure_mode_id
      WHERE wo.type='CORRECTIVE' AND wo.status IN ('COMPLETED','CLOSED') AND wo.requested_at>=? AND wo.requested_at <= (SELECT ends_at FROM metric_cutoff) GROUP BY COALESCE(mode.code,'UNCLASSIFIED'),mode.name
    ), ranked AS (
      SELECT *,SUM(value) OVER(PARTITION BY dimension) AS total,
        SUM(value) OVER(PARTITION BY dimension ORDER BY value DESC,id ROWS UNBOUNDED PRECEDING) AS cumulative,
        ROW_NUMBER() OVER(PARTITION BY dimension ORDER BY value DESC,id) AS position FROM dimensions WHERE value>0
    ) SELECT dimension,id,label,value,value*100.0/total AS share,cumulative*100.0/total AS cumulativeShare
      FROM ranked WHERE position<=10 ORDER BY dimension,position`,
    [...query.params, daysBefore(now, 90)],
  );
  const result: ReliabilityCenterData["pareto"] = {
    downtimeByAsset: [],
    downtimeByArea: [],
    costByAsset: [],
    mroByAsset: [],
    failuresByMode: [],
  };
  for (const { dimension, ...row } of rows) result[dimension].push(row);
  return result;
}

async function loadFailureSignals(
  scope: TenantScope,
  now: string,
  assetId?: string,
): Promise<FailureSignal[]> {
  const { queryAll } = scopedQueries(scope);
  const start90 = daysBefore(now, 90);
  const start60 = daysBefore(now, 60);
  const start30 = daysBefore(now, 30);
  const filter = assetId ? "AND wo.asset_id = ?" : "";
  const params: Array<string | null> = [
    start30,
    start60,
    start30,
    start90,
    now,
    scope.organizationId,
    scope.siteId,
  ];
  if (assetId) params.push(assetId);
  const rows = await queryAll<{
    assetId: string;
    assetCode: string;
    assetName: string;
    failureModeId: string | null;
    failureModeCode: string | null;
    failureModeName: string | null;
    category: string | null;
    count90: number;
    recent30: number;
    previous30: number;
    downtimeMinutes: number;
    firstAt: string;
    lastAt: string;
    causes: string | null;
    effects: string | null;
  }>(
    `
    SELECT asset.id AS assetId, asset.code AS assetCode, asset.name AS assetName,
      wo.failure_mode_id AS failureModeId,
      mode.code AS failureModeCode, mode.name AS failureModeName, mode.category,
      COUNT(*) AS count90,
      SUM(CASE WHEN wo.requested_at >= ? THEN 1 ELSE 0 END) AS recent30,
      SUM(CASE WHEN wo.requested_at >= ? AND wo.requested_at < ? THEN 1 ELSE 0 END) AS previous30,
      COALESCE(SUM((SELECT COALESCE(SUM(d.duration_minutes), 0)
        FROM scope_downtime_events d WHERE d.work_order_id = wo.id)), 0) AS downtimeMinutes,
      MIN(wo.requested_at) AS firstAt, MAX(wo.requested_at) AS lastAt,
      GROUP_CONCAT(DISTINCT wo.failure_cause) AS causes,
      GROUP_CONCAT(DISTINCT wo.failure_effect) AS effects
    FROM scope_work_orders wo
    INNER JOIN scope_assets asset ON asset.id = wo.asset_id
    LEFT JOIN failure_modes mode ON mode.id = wo.failure_mode_id
    WHERE wo.type = 'CORRECTIVE' AND wo.status IN ('COMPLETED','CLOSED')
      AND wo.requested_at BETWEEN ? AND ? AND wo.organization_id = ? AND wo.site_id = ?
      ${filter}
    GROUP BY asset.id, COALESCE(wo.failure_mode_id, wo.failure_mode)
    ORDER BY count90 DESC, downtimeMinutes DESC
    LIMIT 100
  `,
    params,
  );
  return rows.map((row) => {
    const count90 = safeNumber(row.count90);
    const recent30 = safeNumber(row.recent30);
    const previous30 = safeNumber(row.previous30);
    const pattern = classifyFailurePattern({
      total90: count90,
      recent30,
      previous30,
    });
    const explanation =
      pattern === "GROWING"
        ? `${recent30} ocurrencias en 30 días frente a ${previous30} en los 30 anteriores.`
        : pattern === "RECURRENT"
          ? `${count90} ocurrencias del mismo modo en 90 días.`
          : pattern === "STABLE"
            ? `${count90} ocurrencias sin aceleración reciente.`
            : "Una única ocurrencia en la ventana; no existe patrón repetitivo todavía.";
    return {
      ...row,
      failureModeCode: row.failureModeCode ?? "UNCLASSIFIED",
      failureModeName: row.failureModeName ?? "Sin formalizar",
      category: row.category ?? "UNCLASSIFIED",
      count90,
      recent30,
      previous30,
      downtimeMinutes: safeNumber(row.downtimeMinutes),
      pattern,
      explanation,
      causes: row.causes?.split(",").filter(Boolean) ?? [],
      effects: row.effects?.split(",").filter(Boolean) ?? [],
    };
  });
}

function makeBadActors(
  rows: AssetMetricRow[],
  now: string,
): ReliabilityBadActor[] {
  const exposureMinutes = 90 * 24 * 60;
  return rows.map((row) => {
    const repeated = safeNumber(row.repeatedFailures);
    const health = calculateHealthScore(
      {
        criticality: row.criticality,
        status: row.status,
        commissionedAt: row.commissionedAt,
        recentFailures: safeNumber(row.failures),
        recurrentFailures: repeated,
        downtimeMinutes30: safeNumber(row.downtimeMinutes30),
        overdueWorkOrders: safeNumber(row.overdueWorkOrders),
        overduePreventive: safeNumber(row.overduePreventive),
        openIncidents: safeNumber(row.openIncidents),
        criticalIncidents: safeNumber(row.criticalIncidents),
        criticalBacklog: safeNumber(row.criticalBacklog),
        recentCompletedMaintenance: safeNumber(row.recentCompletedMaintenance),
      },
      now,
    );
    const metrics = reliabilityMetrics({
      failures: safeNumber(row.failures),
      downtimeMinutes: safeNumber(row.downtimeMinutes),
      repairMinutes: safeNumber(row.repairMinutes),
      repairSamples: safeNumber(row.repairSamples),
      exposureMinutes,
    });
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      areaCode: row.areaCode,
      areaName: row.areaName,
      criticality: row.criticality,
      status: row.status,
      healthScore: health.score,
      healthBreakdown: health.breakdown,
      ...metrics,
      repeatFailureRate:
        row.failures > 0 ? (repeated / safeNumber(row.failures)) * 100 : null,
      emergencyCorrectiveRatio: ratio(
        safeNumber(row.emergencyFailures),
        safeNumber(row.failures),
      ),
      preventiveCorrectiveRatio: ratio(
        safeNumber(row.preventiveOrders),
        safeNumber(row.preventiveOrders) + safeNumber(row.failures),
      ),
      maintenanceCost: safeNumber(row.maintenanceCost),
      mroQuantity: safeNumber(row.mroQuantity),
      impactScore:
        safeNumber(row.downtimeMinutes) *
          (row.criticality === "CRITICAL"
            ? 1.5
            : row.criticality === "HIGH"
              ? 1.2
              : 1) +
        safeNumber(row.failures) * 120 +
        (100 - health.score) * 10,
    };
  });
}

async function loadTrends(
  scope: TenantScope,
  now: string,
): Promise<ReliabilityTrend[]> {
  const { queryFirst } = scopedQueries(scope);
  const currentStart = daysBefore(now, 30);
  const previousStart = daysBefore(now, 60);
  const row = await queryFirst<{
    currentFailures: number;
    previousFailures: number;
    currentDowntime: number;
    previousDowntime: number;
    currentRepair: number;
    previousRepair: number;
    currentRepairSamples: number;
    previousRepairSamples: number;
  }>(
    `WITH trend_orders AS (SELECT * FROM scope_work_orders WHERE requested_at <= ?),
      trend_downtime AS (SELECT * FROM scope_downtime_events WHERE started_at <= ?)
    SELECT
      (SELECT COUNT(*) FROM trend_orders wo WHERE wo.site_id = ? AND wo.type = 'CORRECTIVE' AND wo.status IN ('COMPLETED','CLOSED') AND wo.requested_at >= ?) AS currentFailures,
      (SELECT COUNT(*) FROM trend_orders wo WHERE wo.site_id = ? AND wo.type = 'CORRECTIVE' AND wo.status IN ('COMPLETED','CLOSED') AND wo.requested_at >= ? AND wo.requested_at < ?) AS previousFailures,
      (SELECT COALESCE(SUM(duration_minutes),0) FROM trend_downtime d WHERE d.site_id = ? AND d.started_at >= ?) AS currentDowntime,
      (SELECT COALESCE(SUM(duration_minutes),0) FROM trend_downtime d WHERE d.site_id = ? AND d.started_at >= ? AND d.started_at < ?) AS previousDowntime,
      (SELECT COALESCE(SUM((julianday(actual_end)-julianday(actual_start))*1440),0) FROM trend_orders wo WHERE wo.site_id = ? AND wo.type = 'CORRECTIVE' AND wo.actual_start IS NOT NULL AND wo.actual_end IS NOT NULL AND wo.requested_at >= ?) AS currentRepair,
      (SELECT COALESCE(SUM((julianday(actual_end)-julianday(actual_start))*1440),0) FROM trend_orders wo WHERE wo.site_id = ? AND wo.type = 'CORRECTIVE' AND wo.actual_start IS NOT NULL AND wo.actual_end IS NOT NULL AND wo.requested_at >= ? AND wo.requested_at < ?) AS previousRepair,
      (SELECT COUNT(*) FROM trend_orders wo WHERE wo.site_id = ? AND wo.type = 'CORRECTIVE' AND wo.actual_start IS NOT NULL AND wo.actual_end IS NOT NULL AND wo.requested_at >= ?) AS currentRepairSamples,
      (SELECT COUNT(*) FROM trend_orders wo WHERE wo.site_id = ? AND wo.type = 'CORRECTIVE' AND wo.actual_start IS NOT NULL AND wo.actual_end IS NOT NULL AND wo.requested_at >= ? AND wo.requested_at < ?) AS previousRepairSamples`,
    [
      now,
      now,
      scope.siteId,
      currentStart,
      scope.siteId,
      previousStart,
      currentStart,
      scope.siteId,
      currentStart,
      scope.siteId,
      previousStart,
      currentStart,
      scope.siteId,
      currentStart,
      scope.siteId,
      previousStart,
      currentStart,
      scope.siteId,
      currentStart,
      scope.siteId,
      previousStart,
      currentStart,
    ],
  );
  const safe = row ?? {
    currentFailures: 0,
    previousFailures: 0,
    currentDowntime: 0,
    previousDowntime: 0,
    currentRepair: 0,
    previousRepair: 0,
    currentRepairSamples: 0,
    previousRepairSamples: 0,
  };
  const currentMttr = safe.currentRepairSamples
    ? safe.currentRepair / safe.currentRepairSamples
    : 0;
  const previousMttr = safe.previousRepairSamples
    ? safe.previousRepair / safe.previousRepairSamples
    : 0;
  const definitions = [
    {
      key: "failures" as const,
      label: "Fallos",
      current: safeNumber(safe.currentFailures),
      previous: safeNumber(safe.previousFailures),
      currentSamples: safeNumber(safe.currentFailures),
      previousSamples: safeNumber(safe.previousFailures),
      unit: "eventos",
    },
    {
      key: "downtime" as const,
      label: "Downtime",
      current: safeNumber(safe.currentDowntime),
      previous: safeNumber(safe.previousDowntime),
      currentSamples: safe.currentDowntime > 0 ? 1 : 0,
      previousSamples: safe.previousDowntime > 0 ? 1 : 0,
      unit: "min",
    },
    {
      key: "mttr" as const,
      label: "MTTR",
      current: currentMttr,
      previous: previousMttr,
      currentSamples: safeNumber(safe.currentRepairSamples),
      previousSamples: safeNumber(safe.previousRepairSamples),
      unit: "min",
    },
  ];
  return definitions.map((definition) => ({
    key: definition.key,
    label: definition.label,
    current: definition.current,
    previous: definition.previous,
    unit: definition.unit,
    ...calculateTrend({
      current: definition.current,
      previous: definition.previous,
      currentSamples: definition.currentSamples,
      previousSamples: definition.previousSamples,
    }),
  }));
}

async function loadPreventiveEffectiveness(
  scope: TenantScope,
  now: string,
): Promise<PreventiveEffectiveness[]> {
  const { queryAll } = scopedQueries(scope);
  const start90 = daysBefore(now, 90);
  const rows = await queryAll<{
    planId: string;
    planCode: string;
    planTitle: string;
    assetCode: string;
    assetName: string;
    pmWindows: number;
    pmOnTime: number;
    correctiveCount: number;
  }>(
    `SELECT plan.id AS planId, plan.code AS planCode, plan.title AS planTitle,
      asset.code AS assetCode, asset.name AS assetName,
      COUNT(DISTINCT CASE WHEN preventive.id IS NOT NULL AND preventive.status <> 'CANCELLED' THEN preventive.id END) AS pmWindows,
      COUNT(DISTINCT CASE WHEN preventive.completed_at IS NOT NULL AND preventive.completed_at <= COALESCE(preventive.preventive_due_at, preventive.due_at) THEN preventive.id END) AS pmOnTime,
      COUNT(DISTINCT corrective.id) AS correctiveCount
    FROM scope_maintenance_plans plan
    INNER JOIN scope_assets asset ON asset.id = plan.asset_id
    LEFT JOIN scope_work_orders preventive ON preventive.maintenance_plan_id = plan.id
      AND COALESCE(preventive.preventive_due_at, preventive.due_at) >= ?
    LEFT JOIN scope_work_orders corrective ON corrective.asset_id = plan.asset_id
      AND corrective.type = 'CORRECTIVE' AND corrective.status IN ('COMPLETED','CLOSED')
      AND corrective.requested_at >= ?
    WHERE plan.organization_id = ? AND plan.site_id = ? AND plan.status = 'ACTIVE'
    GROUP BY plan.id
    ORDER BY correctiveCount DESC, plan.code
    LIMIT 20`,
    [start90, start90, scope.organizationId, scope.siteId],
  );
  return rows.map((row) => {
    const windows = safeNumber(row.pmWindows);
    const onTime = safeNumber(row.pmOnTime);
    const correctives = safeNumber(row.correctiveCount);
    const compliance = windows ? (onTime / windows) * 100 : null;
    const indicator =
      windows < 1
        ? "INSUFFICIENT"
        : compliance !== null && compliance < 75
          ? "LOW_COMPLIANCE"
          : correctives >= 2
            ? "ATTENTION"
            : "EFFECTIVE";
    const explanation =
      indicator === "INSUFFICIENT"
        ? "Sin ventanas preventivas maduras en el periodo."
        : indicator === "LOW_COMPLIANCE"
          ? `${onTime}/${windows} preventivos a tiempo; no se atribuye causalidad.`
          : indicator === "ATTENTION"
            ? `PM al ${compliance?.toFixed(0)}% y ${correctives} correctivos: correlación que requiere revisión.`
            : `PM al ${compliance?.toFixed(0)}% y ${correctives} correctivos en 90 días.`;
    return {
      ...row,
      pmWindows: windows,
      pmOnTime: onTime,
      correctiveCount: correctives,
      compliance,
      indicator,
      explanation,
    };
  });
}

export async function getReliabilityCenter(
  scope: TenantScope,
  asOf = new Date().toISOString(),
): Promise<ReliabilityCenterData> {
  const { queryAll } = scopedQueries(scope);
  const start90 = daysBefore(asOf, 90);
  const [
    assetRows,
    signals,
    downtime,
    rcas,
    preventiveEffectiveness,
    catalogs,
    population,
    populationPareto,
  ] = await Promise.all([
    loadAssetRows(scope, asOf),
    loadFailureSignals(scope, asOf),
    queryAll<{
      key: string;
      label: string;
      minutes: number;
      events: number;
    }>(
      `SELECT d.production_impact AS key,
          CASE d.production_impact WHEN 'FULL_STOP' THEN 'Parada total'
            WHEN 'REDUCED_SPEED' THEN 'Producción degradada'
            WHEN 'MICROSTOP' THEN 'Microparada' ELSE 'Sin impacto productivo' END AS label,
          SUM(d.duration_minutes) AS minutes, COUNT(*) AS events
         FROM scope_downtime_events d
         WHERE d.organization_id = ? AND d.site_id = ? AND d.started_at >= ?
         GROUP BY d.production_impact ORDER BY minutes DESC`,
      [scope.organizationId, scope.siteId, start90],
    ),
    queryAll<ReliabilityRca>(
      `SELECT rca.id, rca.number, rca.problem, rca.impact, rca.status,
          rca.target_at AS targetAt, asset.code AS assetCode, asset.name AS assetName,
          mode.name AS failureModeName, owner.full_name AS ownerName,
          SUM(CASE WHEN action.status IN ('OPEN','IN_PROGRESS') THEN 1 ELSE 0 END) AS openActions
         FROM scope_root_cause_analyses rca
         INNER JOIN scope_assets asset ON asset.id = rca.asset_id
         INNER JOIN users owner ON owner.id = rca.owner_id
         LEFT JOIN failure_modes mode ON mode.id = rca.failure_mode_id
         LEFT JOIN rca_actions action ON action.root_cause_analysis_id = rca.id
         WHERE rca.organization_id = ? AND rca.site_id = ?
         GROUP BY rca.id
         ORDER BY CASE rca.status WHEN 'CLOSED' THEN 2 WHEN 'CANCELLED' THEN 3 ELSE 1 END,
           rca.target_at, rca.created_at DESC LIMIT 20`,
      [scope.organizationId, scope.siteId],
    ),
    loadPreventiveEffectiveness(scope, asOf),
    Promise.all([
      queryAll<{ id: string; code: string; name: string }>(
        "SELECT id, code, name FROM scope_assets WHERE organization_id = ? AND site_id = ? AND status <> 'RETIRED' ORDER BY code LIMIT 500",
        [scope.organizationId, scope.siteId],
      ),
      queryAll<{ id: string; code: string; name: string }>(
        "SELECT id, code, name FROM failure_modes WHERE organization_id = ? AND status = 'ACTIVE' ORDER BY name",
        [scope.organizationId],
      ),
      queryAll<{ id: string; name: string }>(
        `SELECT DISTINCT user.id, user.full_name AS name
           FROM users user INNER JOIN memberships membership ON membership.user_id = user.id
           WHERE membership.organization_id = ? AND membership.status = 'ACTIVE'
           ORDER BY user.full_name`,
        [scope.organizationId],
      ),
    ]),
    loadAssetPopulation(scope, asOf),
    loadPopulationPareto(scope, asOf),
  ]);

  const badActors = makeBadActors(assetRows, asOf).sort(
    (left, right) => right.impactScore - left.impactScore,
  );
  const totalFailures = safeNumber(population?.failures);
  const totalDowntime = safeNumber(population?.downtime);
  const totalRepair = safeNumber(population?.repair);
  const repairSamples = safeNumber(population?.samples);
  const totalPreventive = safeNumber(population?.preventive);
  const emergencyFailures = safeNumber(population?.emergency);
  const siteMetrics = reliabilityMetrics({
    failures: totalFailures,
    downtimeMinutes: totalDowntime,
    repairMinutes: totalRepair,
    repairSamples,
    exposureMinutes: Math.max(1, safeNumber(population?.assets)) * 90 * 24 * 60,
  });
  const totalDowntimeByType = downtime.reduce(
    (sum, item) => sum + safeNumber(item.minutes),
    0,
  );
  const downtimeWithShare = downtime.map((item) => ({
    ...item,
    minutes: safeNumber(item.minutes),
    events: safeNumber(item.events),
    share: totalDowntimeByType
      ? (safeNumber(item.minutes) / totalDowntimeByType) * 100
      : 0,
  }));
  const insufficient: string[] = [];
  if (siteMetrics.mtbfMinutes === null)
    insufficient.push(
      "MTBF requiere al menos dos fallos cerrados en la ventana.",
    );
  if (siteMetrics.mttrMinutes === null)
    insufficient.push("MTTR requiere tiempos reales de reparación cerrados.");
  if (safeNumber(population?.cost) <= 0)
    insufficient.push(
      "No hay costes de mantenimiento registrados en la ventana.",
    );

  return {
    window: {
      days: 90,
      startsAt: start90,
      endsAt: asOf,
      basis:
        "Disponibilidad técnica sobre tiempo calendario 24/7 por activo. Reporting utiliza exposición del calendario productivo.",
    },
    summary: {
      ...siteMetrics,
      repeatFailureRate: ratio(safeNumber(population?.repeated), totalFailures),
      emergencyCorrectiveRatio: ratio(emergencyFailures, totalFailures),
      preventiveCorrectiveRatio: ratio(
        totalPreventive,
        totalPreventive + totalFailures,
      ),
      maintenanceCost: safeNumber(population?.cost),
      mroQuantity: safeNumber(population?.mro),
      insufficient,
    },
    badActors: badActors.slice(0, 20),
    signals: signals.slice(0, 20),
    pareto: populationPareto,
    downtime: downtimeWithShare,
    trends: await loadTrends(scope, asOf),
    preventiveEffectiveness,
    rcas: rcas.map((rca) => ({
      ...rca,
      openActions: safeNumber(rca.openActions),
    })),
    catalogs: {
      assets: catalogs[0],
      failureModes: catalogs[1],
      owners: catalogs[2],
    },
  };
}

export type AssetReliabilityData = {
  metrics: ReliabilityBadActor;
  signals: FailureSignal[];
  rcas: ReliabilityRca[];
  preventiveEffectiveness: PreventiveEffectiveness[];
};

export async function getAssetReliability(
  scope: TenantScope,
  assetId: string,
  asOf = new Date().toISOString(),
): Promise<AssetReliabilityData | null> {
  const { queryAll } = scopedQueries(scope);
  const [rows, signals, rcas, preventive] = await Promise.all([
    loadAssetRows(scope, asOf, assetId),
    loadFailureSignals(scope, asOf, assetId),
    queryAll<ReliabilityRca>(
      `SELECT rca.id, rca.number, rca.problem, rca.impact, rca.status,
        rca.target_at AS targetAt, asset.code AS assetCode, asset.name AS assetName,
        mode.name AS failureModeName, owner.full_name AS ownerName,
        SUM(CASE WHEN action.status IN ('OPEN','IN_PROGRESS') THEN 1 ELSE 0 END) AS openActions
       FROM scope_root_cause_analyses rca
       INNER JOIN scope_assets asset ON asset.id = rca.asset_id
       INNER JOIN users owner ON owner.id = rca.owner_id
       LEFT JOIN failure_modes mode ON mode.id = rca.failure_mode_id
       LEFT JOIN rca_actions action ON action.root_cause_analysis_id = rca.id
       WHERE rca.organization_id = ? AND rca.site_id = ? AND rca.asset_id = ?
       GROUP BY rca.id ORDER BY rca.created_at DESC`,
      [scope.organizationId, scope.siteId, assetId],
    ),
    loadPreventiveEffectiveness(scope, asOf),
  ]);
  if (!rows[0]) return null;
  const metrics = makeBadActors(rows, asOf)[0];
  return {
    metrics,
    signals,
    rcas: rcas.map((rca) => ({
      ...rca,
      openActions: safeNumber(rca.openActions),
    })),
    preventiveEffectiveness: preventive.filter(
      (item) => item.assetCode === rows[0].code,
    ),
  };
}

export type RootCauseAnalysisDetail = {
  id: string;
  number: string;
  problem: string;
  impact: string;
  immediateCause: string | null;
  rootCause: string | null;
  status: string;
  targetAt: string | null;
  version: number;
  createdAt: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  ownerId: string;
  ownerName: string;
  createdByName: string;
  failureModeName: string | null;
  failureModeCode: string | null;
  sourceWorkOrderNumber: string | null;
  sourceWorkOrderTitle: string | null;
  evidence: Array<{
    id: string;
    kind: string;
    description: string;
    sourceReference: string | null;
    createdAt: string;
  }>;
  whys: Array<{
    id: string;
    sequence: number;
    question: string;
    answer: string;
  }>;
  actions: Array<{
    id: string;
    title: string;
    description: string;
    actionType: string;
    status: string;
    ownerName: string;
    targetAt: string | null;
    completedAt: string | null;
    linkedWorkOrderNumber: string | null;
    linkedMaintenancePlanCode: string | null;
  }>;
  events: Array<{
    id: string;
    eventType: string;
    fromStatus: string | null;
    toStatus: string | null;
    note: string | null;
    actorName: string;
    createdAt: string;
  }>;
  catalogs: {
    owners: Array<{ id: string; name: string }>;
    maintenancePlans: Array<{ id: string; code: string; title: string }>;
  };
};

export async function getRootCauseAnalysis(
  scope: TenantScope,
  number: string,
): Promise<RootCauseAnalysisDetail | null> {
  const { queryAll, queryFirst } = scopedQueries(scope);
  const rca = await queryFirst<
    Omit<
      RootCauseAnalysisDetail,
      "evidence" | "whys" | "actions" | "events" | "catalogs"
    >
  >(
    `SELECT rca.id, rca.number, rca.problem, rca.impact,
      rca.immediate_cause AS immediateCause, rca.root_cause AS rootCause,
      rca.status, rca.target_at AS targetAt, rca.version, rca.created_at AS createdAt,
      asset.id AS assetId, asset.code AS assetCode, asset.name AS assetName,
      owner.id AS ownerId, owner.full_name AS ownerName,
      creator.full_name AS createdByName, mode.name AS failureModeName,
      mode.code AS failureModeCode, wo.number AS sourceWorkOrderNumber,
      wo.title AS sourceWorkOrderTitle
     FROM scope_root_cause_analyses rca
     INNER JOIN scope_assets asset ON asset.id = rca.asset_id
     INNER JOIN users owner ON owner.id = rca.owner_id
     INNER JOIN users creator ON creator.id = rca.created_by_id
     LEFT JOIN failure_modes mode ON mode.id = rca.failure_mode_id
     LEFT JOIN scope_work_orders wo ON wo.id = rca.source_work_order_id
     WHERE rca.organization_id = ? AND rca.site_id = ? AND rca.number = ? LIMIT 1`,
    [scope.organizationId, scope.siteId, number],
  );
  if (!rca) return null;
  const [evidence, whys, actions, events, owners, maintenancePlans] =
    await Promise.all([
      queryAll<RootCauseAnalysisDetail["evidence"][number]>(
        "SELECT id, kind, description, source_reference AS sourceReference, created_at AS createdAt FROM rca_evidence WHERE root_cause_analysis_id = ? ORDER BY created_at",
        [rca.id],
      ),
      queryAll<RootCauseAnalysisDetail["whys"][number]>(
        "SELECT id, sequence, question, answer FROM rca_whys WHERE root_cause_analysis_id = ? ORDER BY sequence",
        [rca.id],
      ),
      queryAll<RootCauseAnalysisDetail["actions"][number]>(
        `SELECT action.id, action.title, action.description,
          action.action_type AS actionType, action.status,
          owner.full_name AS ownerName, action.target_at AS targetAt,
          action.completed_at AS completedAt, wo.number AS linkedWorkOrderNumber,
          plan.code AS linkedMaintenancePlanCode
         FROM rca_actions action
         INNER JOIN users owner ON owner.id = action.owner_id
         LEFT JOIN scope_work_orders wo ON wo.id = action.linked_work_order_id
         LEFT JOIN scope_maintenance_plans plan ON plan.id = action.linked_maintenance_plan_id
         WHERE action.root_cause_analysis_id = ?
         ORDER BY CASE action.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END,
           action.target_at`,
        [rca.id],
      ),
      queryAll<RootCauseAnalysisDetail["events"][number]>(
        `SELECT event.id, event.event_type AS eventType,
          event.from_status AS fromStatus, event.to_status AS toStatus,
          event.note, user.full_name AS actorName, event.created_at AS createdAt
         FROM rca_events event INNER JOIN users user ON user.id = event.actor_id
         WHERE event.root_cause_analysis_id = ? ORDER BY event.created_at DESC`,
        [rca.id],
      ),
      queryAll<{ id: string; name: string }>(
        `SELECT DISTINCT user.id, user.full_name AS name FROM users user
         INNER JOIN memberships membership ON membership.user_id = user.id
         WHERE membership.organization_id = ? AND membership.status = 'ACTIVE'
         ORDER BY user.full_name`,
        [scope.organizationId],
      ),
      queryAll<{ id: string; code: string; title: string }>(
        "SELECT id, code, title FROM scope_maintenance_plans WHERE organization_id = ? AND site_id = ? ORDER BY code",
        [scope.organizationId, scope.siteId],
      ),
    ]);
  return {
    ...rca,
    evidence,
    whys,
    actions,
    events,
    catalogs: { owners, maintenancePlans },
  };
}
