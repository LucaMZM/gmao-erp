import {
  buildPareto,
  calculateHealthScore,
  calculateRepeatFailureRate,
  calculateTrend,
  classifyFailurePattern,
  type HealthBreakdownItem,
  type TrendDirection,
} from "@/lib/domain/reliability";
import type { TenantScope } from "./shared";
import { queryAll, queryFirst } from "./shared";

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

async function loadAssetRows(
  scope: TenantScope,
  now: string,
  assetId?: string,
): Promise<AssetMetricRow[]> {
  const start90 = daysBefore(now, 90);
  const start30 = daysBefore(now, 30);
  const assetFilter = assetId ? "AND asset.id = ?" : "";
  const params: Array<string | number | null> = [
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
  return queryAll<AssetMetricRow>(
    `
    WITH failure AS (
      SELECT wo.asset_id AS assetId,
        COUNT(*) AS failures,
        SUM(CASE WHEN wo.priority = 'P1_EMERGENCY' THEN 1 ELSE 0 END) AS emergencyFailures,
        SUM(CASE WHEN wo.actual_start IS NOT NULL AND wo.actual_end IS NOT NULL
          THEN MAX(0, (julianday(wo.actual_end) - julianday(wo.actual_start)) * 1440)
          ELSE 0 END) AS repairMinutes,
        SUM(CASE WHEN wo.actual_start IS NOT NULL AND wo.actual_end IS NOT NULL THEN 1 ELSE 0 END) AS repairSamples
      FROM work_orders wo
      WHERE wo.type = 'CORRECTIVE' AND wo.status IN ('COMPLETED','CLOSED')
        AND wo.requested_at >= ?
      GROUP BY wo.asset_id
    ), downtime AS (
      SELECT d.asset_id AS assetId,
        SUM(d.duration_minutes) AS downtimeMinutes,
        SUM(CASE WHEN d.started_at >= ? THEN d.duration_minutes ELSE 0 END) AS downtimeMinutes30
      FROM downtime_events d WHERE d.started_at >= ?
        AND d.kind <> 'PLANNED'
        AND (d.work_order_id IS NULL OR EXISTS (
          SELECT 1 FROM work_orders downtime_work
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
      FROM work_orders wo GROUP BY wo.asset_id
    ), incident AS (
      SELECT i.asset_id AS assetId,
        COUNT(*) AS openIncidents,
        SUM(CASE WHEN i.severity = 'CRITICAL' THEN 1 ELSE 0 END) AS criticalIncidents
      FROM incidents i
      WHERE i.status IN ('NEW','IN_TRIAGE','ACCEPTED')
      GROUP BY i.asset_id
    ), material AS (
      SELECT wo.asset_id AS assetId,
        SUM(CASE WHEN usage.usage_type = 'RETURN' THEN -usage.total_cost ELSE usage.total_cost END) AS maintenanceCost,
        SUM(CASE WHEN usage.usage_type = 'RETURN' THEN -usage.quantity ELSE usage.quantity END) AS mroQuantity
      FROM work_order_part_usages usage
      INNER JOIN work_orders wo ON wo.id = usage.work_order_id
      WHERE usage.created_at >= ?
      GROUP BY wo.asset_id
    )
    SELECT asset.id, asset.code, asset.name, asset.criticality, asset.status,
      asset.commissioned_at AS commissionedAt,
      COALESCE(area.code, location.code) AS areaCode,
      COALESCE(area.name, location.name) AS areaName,
      COALESCE(failure.failures, 0) AS failures,
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
          FROM labor_sessions labor INNER JOIN work_orders labor_work ON labor_work.id = labor.work_order_id
          WHERE labor_work.asset_id = asset.id AND labor.started_at >= ?), 0)
        + COALESCE((SELECT SUM(cost.amount_cents) / 100.0
          FROM work_order_cost_items cost INNER JOIN work_orders cost_work ON cost_work.id = cost.work_order_id
          WHERE cost_work.asset_id = asset.id AND cost.recorded_at >= ?), 0) AS maintenanceCost,
      COALESCE(material.mroQuantity, 0) AS mroQuantity
    FROM assets asset
    INNER JOIN functional_locations location ON location.id = asset.functional_location_id
    LEFT JOIN functional_locations area ON area.id = location.parent_id
    LEFT JOIN failure ON failure.assetId = asset.id
    LEFT JOIN downtime ON downtime.assetId = asset.id
    LEFT JOIN work ON work.assetId = asset.id
    LEFT JOIN incident ON incident.assetId = asset.id
    LEFT JOIN material ON material.assetId = asset.id
    WHERE asset.organization_id = ? AND asset.site_id = ? AND asset.status <> 'RETIRED'
      ${assetFilter}
    ORDER BY (COALESCE(downtime.downtimeMinutes, 0) * 2 + COALESCE(failure.failures, 0) * 120) DESC,
      asset.criticality, asset.code
    LIMIT 250
  `,
    params,
  );
}

async function loadFailureSignals(
  scope: TenantScope,
  now: string,
  assetId?: string,
): Promise<FailureSignal[]> {
  const start90 = daysBefore(now, 90);
  const start60 = daysBefore(now, 60);
  const start30 = daysBefore(now, 30);
  const filter = assetId ? "AND wo.asset_id = ?" : "";
  const params: Array<string | null> = [
    start30,
    start60,
    start30,
    start90,
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
        FROM downtime_events d WHERE d.work_order_id = wo.id)), 0) AS downtimeMinutes,
      MIN(wo.requested_at) AS firstAt, MAX(wo.requested_at) AS lastAt,
      GROUP_CONCAT(DISTINCT wo.failure_cause) AS causes,
      GROUP_CONCAT(DISTINCT wo.failure_effect) AS effects
    FROM work_orders wo
    INNER JOIN assets asset ON asset.id = wo.asset_id
    LEFT JOIN failure_modes mode ON mode.id = wo.failure_mode_id
    WHERE wo.type = 'CORRECTIVE' AND wo.status IN ('COMPLETED','CLOSED')
      AND wo.requested_at >= ? AND wo.organization_id = ? AND wo.site_id = ?
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
  signals: FailureSignal[],
  now: string,
): ReliabilityBadActor[] {
  const exposureMinutes = 90 * 24 * 60;
  return rows.map((row) => {
    const assetSignals = signals.filter((signal) => signal.assetId === row.id);
    const repeated = assetSignals.reduce(
      (sum, signal) => sum + Math.max(0, signal.count90 - 1),
      0,
    );
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
    `SELECT
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.site_id = ? AND wo.type = 'CORRECTIVE' AND wo.status IN ('COMPLETED','CLOSED') AND wo.requested_at >= ?) AS currentFailures,
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.site_id = ? AND wo.type = 'CORRECTIVE' AND wo.status IN ('COMPLETED','CLOSED') AND wo.requested_at >= ? AND wo.requested_at < ?) AS previousFailures,
      (SELECT COALESCE(SUM(duration_minutes),0) FROM downtime_events d WHERE d.site_id = ? AND d.started_at >= ?) AS currentDowntime,
      (SELECT COALESCE(SUM(duration_minutes),0) FROM downtime_events d WHERE d.site_id = ? AND d.started_at >= ? AND d.started_at < ?) AS previousDowntime,
      (SELECT COALESCE(SUM((julianday(actual_end)-julianday(actual_start))*1440),0) FROM work_orders wo WHERE wo.site_id = ? AND wo.type = 'CORRECTIVE' AND wo.actual_start IS NOT NULL AND wo.actual_end IS NOT NULL AND wo.requested_at >= ?) AS currentRepair,
      (SELECT COALESCE(SUM((julianday(actual_end)-julianday(actual_start))*1440),0) FROM work_orders wo WHERE wo.site_id = ? AND wo.type = 'CORRECTIVE' AND wo.actual_start IS NOT NULL AND wo.actual_end IS NOT NULL AND wo.requested_at >= ? AND wo.requested_at < ?) AS previousRepair,
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.site_id = ? AND wo.type = 'CORRECTIVE' AND wo.actual_start IS NOT NULL AND wo.actual_end IS NOT NULL AND wo.requested_at >= ?) AS currentRepairSamples,
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.site_id = ? AND wo.type = 'CORRECTIVE' AND wo.actual_start IS NOT NULL AND wo.actual_end IS NOT NULL AND wo.requested_at >= ? AND wo.requested_at < ?) AS previousRepairSamples`,
    [
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
    FROM maintenance_plans plan
    INNER JOIN assets asset ON asset.id = plan.asset_id
    LEFT JOIN work_orders preventive ON preventive.maintenance_plan_id = plan.id
      AND COALESCE(preventive.preventive_due_at, preventive.due_at) >= ?
    LEFT JOIN work_orders corrective ON corrective.asset_id = plan.asset_id
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
  const start90 = daysBefore(asOf, 90);
  const [
    assetRows,
    signals,
    downtime,
    rcas,
    preventiveEffectiveness,
    catalogs,
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
            WHEN 'MICRO_STOP' THEN 'Microparada' ELSE 'Sin impacto productivo' END AS label,
          SUM(d.duration_minutes) AS minutes, COUNT(*) AS events
         FROM downtime_events d
         WHERE d.organization_id = ? AND d.site_id = ? AND d.started_at >= ?
         GROUP BY d.production_impact ORDER BY minutes DESC`,
      [scope.organizationId, scope.siteId, start90],
    ),
    queryAll<ReliabilityRca>(
      `SELECT rca.id, rca.number, rca.problem, rca.impact, rca.status,
          rca.target_at AS targetAt, asset.code AS assetCode, asset.name AS assetName,
          mode.name AS failureModeName, owner.full_name AS ownerName,
          SUM(CASE WHEN action.status IN ('OPEN','IN_PROGRESS') THEN 1 ELSE 0 END) AS openActions
         FROM root_cause_analyses rca
         INNER JOIN assets asset ON asset.id = rca.asset_id
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
        "SELECT id, code, name FROM assets WHERE organization_id = ? AND site_id = ? AND status <> 'RETIRED' ORDER BY code LIMIT 500",
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
  ]);

  const badActors = makeBadActors(assetRows, signals, asOf).sort(
    (left, right) => right.impactScore - left.impactScore,
  );
  const totalFailures = badActors.reduce(
    (sum, item) => sum + item.failureCount,
    0,
  );
  const totalDowntime = badActors.reduce(
    (sum, item) => sum + item.downtimeMinutes,
    0,
  );
  const totalRepair = assetRows.reduce(
    (sum, item) => sum + safeNumber(item.repairMinutes),
    0,
  );
  const repairSamples = assetRows.reduce(
    (sum, item) => sum + safeNumber(item.repairSamples),
    0,
  );
  const totalPreventive = assetRows.reduce(
    (sum, item) => sum + safeNumber(item.preventiveOrders),
    0,
  );
  const emergencyFailures = assetRows.reduce(
    (sum, item) => sum + safeNumber(item.emergencyFailures),
    0,
  );
  const siteMetrics = reliabilityMetrics({
    failures: totalFailures,
    downtimeMinutes: totalDowntime,
    repairMinutes: totalRepair,
    repairSamples,
    exposureMinutes: Math.max(1, assetRows.length) * 90 * 24 * 60,
  });
  const repeatedGroupCounts = signals.map((signal) => signal.count90);
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
  const areaMap = new Map<
    string,
    { id: string; label: string; value: number }
  >();
  const modeMap = new Map<
    string,
    { id: string; label: string; value: number }
  >();
  for (const actor of badActors) {
    const current = areaMap.get(actor.areaCode) ?? {
      id: actor.areaCode,
      label: actor.areaName,
      value: 0,
    };
    current.value += actor.downtimeMinutes;
    areaMap.set(actor.areaCode, current);
  }
  for (const signal of signals) {
    const current = modeMap.get(signal.failureModeCode) ?? {
      id: signal.failureModeCode,
      label: signal.failureModeName,
      value: 0,
    };
    current.value += signal.count90;
    modeMap.set(signal.failureModeCode, current);
  }

  const insufficient: string[] = [];
  if (siteMetrics.mtbfMinutes === null)
    insufficient.push(
      "MTBF requiere al menos dos fallos cerrados en la ventana.",
    );
  if (siteMetrics.mttrMinutes === null)
    insufficient.push("MTTR requiere tiempos reales de reparación cerrados.");
  if (!badActors.some((item) => item.maintenanceCost > 0))
    insufficient.push(
      "Coste limitado a consumos MRO con snapshot histórico; no hay tarifa laboral.",
    );

  return {
    window: {
      days: 90,
      startsAt: start90,
      endsAt: asOf,
      basis:
        "Disponibilidad técnica agregada sobre tiempo calendario por activo; sin calendario productivo modelado.",
    },
    summary: {
      ...siteMetrics,
      repeatFailureRate: calculateRepeatFailureRate(repeatedGroupCounts),
      emergencyCorrectiveRatio: ratio(emergencyFailures, totalFailures),
      preventiveCorrectiveRatio: ratio(
        totalPreventive,
        totalPreventive + totalFailures,
      ),
      maintenanceCost: badActors.reduce(
        (sum, item) => sum + item.maintenanceCost,
        0,
      ),
      mroQuantity: badActors.reduce((sum, item) => sum + item.mroQuantity, 0),
      insufficient,
    },
    badActors: badActors.slice(0, 20),
    signals: signals.slice(0, 20),
    pareto: {
      downtimeByAsset: buildPareto(
        badActors.map((item) => ({
          id: item.id,
          label: `${item.code} · ${item.name}`,
          value: item.downtimeMinutes,
        })),
      ).slice(0, 10),
      downtimeByArea: buildPareto([...areaMap.values()]).slice(0, 10),
      failuresByMode: buildPareto([...modeMap.values()]).slice(0, 10),
      costByAsset: buildPareto(
        badActors.map((item) => ({
          id: item.id,
          label: `${item.code} · ${item.name}`,
          value: item.maintenanceCost,
        })),
      ).slice(0, 10),
      mroByAsset: buildPareto(
        badActors.map((item) => ({
          id: item.id,
          label: `${item.code} · ${item.name}`,
          value: item.mroQuantity,
        })),
      ).slice(0, 10),
    },
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
  const [rows, signals, rcas, preventive] = await Promise.all([
    loadAssetRows(scope, asOf, assetId),
    loadFailureSignals(scope, asOf, assetId),
    queryAll<ReliabilityRca>(
      `SELECT rca.id, rca.number, rca.problem, rca.impact, rca.status,
        rca.target_at AS targetAt, asset.code AS assetCode, asset.name AS assetName,
        mode.name AS failureModeName, owner.full_name AS ownerName,
        SUM(CASE WHEN action.status IN ('OPEN','IN_PROGRESS') THEN 1 ELSE 0 END) AS openActions
       FROM root_cause_analyses rca
       INNER JOIN assets asset ON asset.id = rca.asset_id
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
  const metrics = makeBadActors(rows, signals, asOf)[0];
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
     FROM root_cause_analyses rca
     INNER JOIN assets asset ON asset.id = rca.asset_id
     INNER JOIN users owner ON owner.id = rca.owner_id
     INNER JOIN users creator ON creator.id = rca.created_by_id
     LEFT JOIN failure_modes mode ON mode.id = rca.failure_mode_id
     LEFT JOIN work_orders wo ON wo.id = rca.source_work_order_id
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
         LEFT JOIN work_orders wo ON wo.id = action.linked_work_order_id
         LEFT JOIN maintenance_plans plan ON plan.id = action.linked_maintenance_plan_id
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
        "SELECT id, code, title FROM maintenance_plans WHERE organization_id = ? AND site_id = ? ORDER BY code",
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
