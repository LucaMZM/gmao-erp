import type { SqlValue, TenantScope } from "./shared";
import {
  locationScopePredicate,
  normalizePage,
  normalizeQuery,
  queryAll,
  queryFirst,
} from "./shared";
import { getAssetReliability, type AssetReliabilityData } from "./reliability";

const OPEN_STATES =
  "('REQUESTED','TRIAGE','APPROVED','PLANNED','SCHEDULED','ASSIGNED','IN_PROGRESS','PAUSED','WAITING_PART','WAITING_VENDOR')";
const PAGE_SIZE = 20;

export type AssetListItem = {
  id: string;
  code: string;
  name: string;
  status: string;
  criticality: string;
  healthScore: number;
  kind: string;
  locationCode: string;
  locationName: string;
  className: string;
  manufacturer: string | null;
  model: string | null;
  parentCode: string | null;
  openOrders: number;
  lastMaintenanceAt: string | null;
};

export type AssetFilters = {
  q?: string | string[];
  status?: string | string[];
  criticality?: string | string[];
  area?: string | string[];
  health?: string | string[];
  view?: string | string[];
  page?: string | string[];
};

export type AssetListData = {
  items: AssetListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  query: string;
  areas: Array<{ code: string; name: string }>;
};

export async function listAssets(
  scope: TenantScope,
  filters: AssetFilters,
): Promise<AssetListData> {
  const page = normalizePage(filters.page);
  const query = normalizeQuery(filters.q);
  const status = normalizeQuery(filters.status, 30);
  const criticality = normalizeQuery(filters.criticality, 20);
  const area = normalizeQuery(filters.area, 30);
  const health = normalizeQuery(filters.health, 20);
  const conditions = ["asset.site_id = ?", "asset.status != 'RETIRED'"];
  const params: SqlValue[] = [scope.siteId];
  const locationScope = locationScopePredicate(
    scope,
    "asset.functional_location_id",
  );
  conditions.push(locationScope.sql);
  params.push(...locationScope.params);

  if (query) {
    conditions.push(
      "(asset.code LIKE ? OR asset.name LIKE ? OR asset.manufacturer LIKE ? OR asset.model LIKE ?)",
    );
    const like = `%${query}%`;
    params.push(like, like, like, like);
  }
  if (status) {
    conditions.push("asset.status = ?");
    params.push(status);
  }
  if (criticality) {
    conditions.push("asset.criticality = ?");
    params.push(criticality);
  }
  if (area) {
    conditions.push("(location.code = ? OR parent_location.code = ?)");
    params.push(area, area);
  }
  if (health === "RISK") conditions.push("asset.health_score < 70");
  if (health === "WATCH")
    conditions.push("asset.health_score >= 70 AND asset.health_score < 85");
  if (health === "HEALTHY") conditions.push("asset.health_score >= 85");

  const where = conditions.join(" AND ");
  const count = await queryFirst<{ count: number }>(
    `
    SELECT COUNT(*) AS count
    FROM assets asset
    INNER JOIN functional_locations location ON location.id = asset.functional_location_id
    LEFT JOIN functional_locations parent_location ON parent_location.id = location.parent_id
    WHERE ${where}
  `,
    params,
  );
  const total = Number(count?.count ?? 0);

  const items = await queryAll<AssetListItem>(
    `
    SELECT
      asset.id,
      asset.code,
      asset.name,
      asset.status,
      asset.criticality,
      asset.health_score AS healthScore,
      asset.kind,
      location.code AS locationCode,
      location.name AS locationName,
      class.name AS className,
      asset.manufacturer,
      asset.model,
      parent_asset.code AS parentCode,
      COUNT(DISTINCT CASE WHEN wo.status IN ${OPEN_STATES} THEN wo.id END) AS openOrders,
      MAX(CASE WHEN wo.status IN ('COMPLETED','CLOSED') THEN wo.actual_end END) AS lastMaintenanceAt
    FROM assets asset
    INNER JOIN functional_locations location ON location.id = asset.functional_location_id
    LEFT JOIN functional_locations parent_location ON parent_location.id = location.parent_id
    INNER JOIN asset_classes class ON class.id = asset.asset_class_id
    LEFT JOIN assets parent_asset ON parent_asset.id = asset.parent_asset_id
    LEFT JOIN work_orders wo ON wo.asset_id = asset.id
    WHERE ${where}
    GROUP BY asset.id
    ORDER BY
      CASE asset.criticality WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
      asset.health_score ASC,
      asset.code ASC
    LIMIT ? OFFSET ?
  `,
    [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
  );

  const areaScope = locationScopePredicate(scope, "location.id");
  const areas = await queryAll<{ code: string; name: string }>(
    `
    SELECT location.code, location.name
    FROM functional_locations location
    WHERE location.site_id = ? AND location.parent_id IS NULL AND location.status = 'ACTIVE'
      AND ${areaScope.sql}
    ORDER BY location.sort_order, location.name
  `,
    [scope.siteId, ...areaScope.params],
  );

  return {
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    query,
    areas,
  };
}

export type AssetDetail = {
  id: string;
  code: string;
  name: string;
  description: string;
  status: string;
  criticality: string;
  healthScore: number;
  kind: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  commissionedAt: string | null;
  warrantyUntil: string | null;
  nextPmAt: string | null;
  technicalSummary: string | null;
  locationCode: string;
  locationName: string;
  areaCode: string;
  areaName: string;
  className: string;
  vendorName: string | null;
  parentCode: string | null;
  parentName: string | null;
  siteName: string;
};

export type AssetChild = {
  id: string;
  code: string;
  name: string;
  status: string;
  healthScore: number;
  criticality: string;
  className: string;
};

export type AssetOrder = {
  id: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  requestedAt: string;
  actualEnd: string | null;
  assigneeName: string | null;
};

export type AssetCompatiblePart = {
  id: string;
  sku: string;
  name: string;
  relation: string;
  recommendedQuantity: number;
  available: number;
  critical: number;
};

export type AssetHistoryItem = {
  id: string;
  kind: "WORK_ORDER" | "INCIDENT" | "DOWNTIME" | "MATERIAL";
  occurredAt: string;
  title: string;
  detail: string;
  href: string | null;
  status: string | null;
  tone: "active" | "done" | "warning";
};

export type AssetDetailData = {
  asset: AssetDetail;
  children: AssetChild[];
  orders: AssetOrder[];
  compatibleParts: AssetCompatiblePart[];
  incidents: Array<{
    id: string;
    number: string;
    title: string;
    status: string;
    severity: string;
    reportedAt: string;
  }>;
  history: AssetHistoryItem[];
  healthDrivers: Array<{
    label: string;
    value: string;
    tone: "good" | "warning" | "critical";
  }>;
  maintenanceCost: number;
  downtimeMinutes: number;
  maintenancePlans: Array<{
    id: string;
    code: string;
    title: string;
    status: string;
    triggerMode: string;
    nextDueAt: string | null;
    meterCode: string | null;
    meterValue: number | null;
    meterUnit: string | null;
  }>;
  fieldEvidence: Array<{
    id: string;
    kind: string;
    stage: string;
    description: string;
    createdAt: string;
    authorName: string;
    workOrderNumber: string | null;
  }>;
  fieldMeasurements: Array<{
    id: string;
    label: string;
    unit: string;
    value: number;
    result: string;
    recordedAt: string;
    workOrderNumber: string;
  }>;
  reliability: AssetReliabilityData;
};

export async function getAssetDetail(
  scope: TenantScope,
  code: string,
): Promise<AssetDetailData | null> {
  const locationScope = locationScopePredicate(
    scope,
    "asset.functional_location_id",
  );
  const asset = await queryFirst<AssetDetail>(
    `
    SELECT
      asset.id,
      asset.code,
      asset.name,
      asset.description,
      asset.status,
      asset.criticality,
      asset.health_score AS healthScore,
      asset.kind,
      asset.manufacturer,
      asset.model,
      asset.serial_number AS serialNumber,
      asset.commissioned_at AS commissionedAt,
      asset.warranty_until AS warrantyUntil,
      asset.next_pm_at AS nextPmAt,
      asset.technical_summary AS technicalSummary,
      location.code AS locationCode,
      location.name AS locationName,
      COALESCE(area.code, location.code) AS areaCode,
      COALESCE(area.name, location.name) AS areaName,
      class.name AS className,
      vendor.name AS vendorName,
      parent_asset.code AS parentCode,
      parent_asset.name AS parentName,
      site.name AS siteName
    FROM assets asset
    INNER JOIN functional_locations location ON location.id = asset.functional_location_id
    LEFT JOIN functional_locations area ON area.id = location.parent_id
    INNER JOIN asset_classes class ON class.id = asset.asset_class_id
    INNER JOIN sites site ON site.id = asset.site_id
    LEFT JOIN vendors vendor ON vendor.id = asset.vendor_id
    LEFT JOIN assets parent_asset ON parent_asset.id = asset.parent_asset_id
    WHERE asset.organization_id = ? AND asset.site_id = ? AND asset.code = ?
      AND ${locationScope.sql}
    LIMIT 1
  `,
    [scope.organizationId, scope.siteId, code, ...locationScope.params],
  );
  if (!asset) return null;

  const [
    children,
    orders,
    compatibleParts,
    incidents,
    downtimeHistory,
    materialHistory,
    aggregates,
    maintenancePlans,
    fieldEvidence,
    fieldMeasurements,
    reliability,
  ] = await Promise.all([
    queryAll<AssetChild>(
      `
      SELECT child.id, child.code, child.name, child.status,
        child.health_score AS healthScore, child.criticality, class.name AS className
      FROM assets child
      INNER JOIN asset_classes class ON class.id = child.asset_class_id
      WHERE child.parent_asset_id = ?
      ORDER BY child.code
    `,
      [asset.id],
    ),
    queryAll<AssetOrder>(
      `
      SELECT wo.id, wo.number, wo.title, wo.status, wo.priority, wo.type,
        wo.requested_at AS requestedAt, wo.actual_end AS actualEnd,
        (SELECT user.full_name
          FROM work_order_assignments assignment
          INNER JOIN users user ON user.id = assignment.user_id
          WHERE assignment.work_order_id = wo.id AND assignment.unassigned_at IS NULL
          ORDER BY assignment.assigned_at LIMIT 1) AS assigneeName
      FROM work_orders wo
      WHERE wo.asset_id = ?
      ORDER BY wo.requested_at DESC
      LIMIT 10
    `,
      [asset.id],
    ),
    queryAll<AssetCompatiblePart>(
      `
      SELECT part.id, part.sku, part.name, compatibility.relation,
        compatibility.recommended_quantity AS recommendedQuantity,
        COALESCE(stock.on_hand - stock.reserved, 0) AS available,
        policy.critical
      FROM asset_part_compatibilities compatibility
      INNER JOIN parts part ON part.id = compatibility.part_id
      LEFT JOIN stock_levels stock ON stock.part_id = part.id AND stock.site_id = ?
      LEFT JOIN part_site_policies policy ON policy.part_id = part.id AND policy.site_id = ?
      WHERE compatibility.asset_id = ?
      ORDER BY policy.critical DESC, part.name
      LIMIT 8
    `,
      [scope.siteId, scope.siteId, asset.id],
    ),
    queryAll<AssetDetailData["incidents"][number]>(
      `
      SELECT id, number, title, status, severity, reported_at AS reportedAt
      FROM incidents
      WHERE asset_id = ? AND organization_id = ? AND site_id = ?
      ORDER BY reported_at DESC
      LIMIT 10
    `,
      [asset.id, scope.organizationId, scope.siteId],
    ),
    queryAll<{
      id: string;
      startedAt: string;
      endedAt: string | null;
      durationMinutes: number;
      productionImpact: string;
      cause: string | null;
      workOrderNumber: string | null;
    }>(
      `
      SELECT downtime.id, downtime.started_at AS startedAt,
        downtime.ended_at AS endedAt, downtime.duration_minutes AS durationMinutes,
        downtime.production_impact AS productionImpact, downtime.cause,
        wo.number AS workOrderNumber
      FROM downtime_events downtime
      LEFT JOIN work_orders wo ON wo.id = downtime.work_order_id
      WHERE downtime.asset_id = ? AND downtime.organization_id = ? AND downtime.site_id = ?
      ORDER BY downtime.started_at DESC
      LIMIT 10
    `,
      [asset.id, scope.organizationId, scope.siteId],
    ),
    queryAll<{
      id: string;
      createdAt: string;
      sku: string;
      partName: string;
      quantity: number;
      usageType: string;
      workOrderNumber: string;
    }>(
      `
      SELECT usage.id, usage.created_at AS createdAt, part.sku,
        part.name AS partName, usage.quantity, usage.usage_type AS usageType,
        wo.number AS workOrderNumber
      FROM work_order_part_usages usage
      INNER JOIN work_orders wo ON wo.id = usage.work_order_id
      INNER JOIN parts part ON part.id = usage.part_id
      WHERE wo.asset_id = ? AND wo.organization_id = ? AND wo.site_id = ?
      ORDER BY usage.created_at DESC
      LIMIT 10
    `,
      [asset.id, scope.organizationId, scope.siteId],
    ),
    queryFirst<{
      maintenanceCost: number;
      downtimeMinutes: number;
    }>(
      `
      SELECT
        COALESCE((SELECT SUM(usage.total_cost) FROM work_order_part_usages usage
          INNER JOIN work_orders wo ON wo.id = usage.work_order_id WHERE wo.asset_id = ?), 0)
        + COALESCE((SELECT SUM(labor.labor_cost_cents) / 100.0 FROM labor_sessions labor
          INNER JOIN work_orders wo ON wo.id = labor.work_order_id WHERE wo.asset_id = ?), 0)
        + COALESCE((SELECT SUM(cost.amount_cents) / 100.0 FROM work_order_cost_items cost
          INNER JOIN work_orders wo ON wo.id = cost.work_order_id WHERE wo.asset_id = ?), 0) AS maintenanceCost,
        COALESCE((SELECT SUM(duration_minutes) FROM downtime_events WHERE asset_id = ?), 0) AS downtimeMinutes
    `,
      [asset.id, asset.id, asset.id, asset.id],
    ),
    queryAll<AssetDetailData["maintenancePlans"][number]>(
      `SELECT plan.id, plan.code, plan.title, plan.status,
        plan.trigger_mode AS triggerMode, plan.next_due_at AS nextDueAt,
        meter.code AS meterCode, meter.last_value AS meterValue,
        meter.unit AS meterUnit
       FROM maintenance_plans plan
       LEFT JOIN meters meter ON meter.id = plan.meter_id
       WHERE plan.asset_id = ? AND plan.organization_id = ? AND plan.site_id = ?
       ORDER BY CASE plan.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,
         plan.next_due_at, plan.code`,
      [asset.id, scope.organizationId, scope.siteId],
    ),
    queryAll<AssetDetailData["fieldEvidence"][number]>(
      `SELECT evidence.id, evidence.kind, evidence.stage, evidence.description,
        evidence.created_at AS createdAt, user.full_name AS authorName,
        work_order.number AS workOrderNumber
       FROM evidence_items evidence
       INNER JOIN users user ON user.id = evidence.author_id
       LEFT JOIN work_orders work_order ON work_order.id = evidence.work_order_id
       WHERE evidence.asset_id = ? AND evidence.organization_id = ?
         AND evidence.site_id = ? ORDER BY evidence.created_at DESC LIMIT 12`,
      [asset.id, scope.organizationId, scope.siteId],
    ),
    queryAll<AssetDetailData["fieldMeasurements"][number]>(
      `SELECT measurement.id, measurement.label, measurement.unit,
        measurement.value, measurement.result,
        measurement.recorded_at AS recordedAt,
        work_order.number AS workOrderNumber
       FROM work_order_measurements measurement
       INNER JOIN work_orders work_order ON work_order.id = measurement.work_order_id
       WHERE measurement.asset_id = ? AND measurement.organization_id = ?
         AND measurement.site_id = ?
       ORDER BY measurement.recorded_at DESC LIMIT 12`,
      [asset.id, scope.organizationId, scope.siteId],
    ),
    getAssetReliability(scope, asset.id),
  ]);

  if (!reliability) return null;

  const healthDrivers: AssetDetailData["healthDrivers"] =
    reliability.metrics.healthBreakdown.slice(0, 5).map((driver) => ({
      label: driver.label,
      value:
        driver.adjustment === 0
          ? "Sin impacto"
          : `${driver.adjustment > 0 ? "+" : ""}${driver.adjustment} pts`,
      tone:
        driver.tone === "positive"
          ? "good"
          : driver.adjustment <= -7
            ? "critical"
            : "warning",
    }));

  const history: AssetHistoryItem[] = [
    ...orders.map((order) => ({
      id: `wo-${order.id}`,
      kind: "WORK_ORDER" as const,
      occurredAt: order.actualEnd ?? order.requestedAt,
      title: order.title,
      detail: `${order.number} · ${order.type}`,
      href: `/work-orders/${encodeURIComponent(order.number)}`,
      status: order.status,
      tone: ["COMPLETED", "CLOSED"].includes(order.status)
        ? ("done" as const)
        : ("active" as const),
    })),
    ...incidents.map((incident) => ({
      id: `incident-${incident.id}`,
      kind: "INCIDENT" as const,
      occurredAt: incident.reportedAt,
      title: incident.title,
      detail: `${incident.number} · Incidencia ${incident.severity.toLowerCase()}`,
      href: `/incidents/${encodeURIComponent(incident.number)}`,
      status: incident.status,
      tone:
        incident.severity === "CRITICAL"
          ? ("warning" as const)
          : ("active" as const),
    })),
    ...downtimeHistory.map((downtime) => ({
      id: `downtime-${downtime.id}`,
      kind: "DOWNTIME" as const,
      occurredAt: downtime.endedAt ?? downtime.startedAt,
      title: downtime.endedAt
        ? `Downtime consolidado · ${downtime.durationMinutes} min`
        : "Downtime en curso",
      detail: `${downtime.workOrderNumber ?? "Sin OT"} · ${downtime.productionImpact}${downtime.cause ? ` · ${downtime.cause}` : ""}`,
      href: downtime.workOrderNumber
        ? `/work-orders/${encodeURIComponent(downtime.workOrderNumber)}`
        : null,
      status: null,
      tone: downtime.endedAt ? ("done" as const) : ("warning" as const),
    })),
    ...materialHistory.map((usage) => ({
      id: `material-${usage.id}`,
      kind: "MATERIAL" as const,
      occurredAt: usage.createdAt,
      title: `${usage.sku} × ${usage.quantity} ${usage.usageType === "RETURN" ? "devuelto" : "consumido"}`,
      detail: `${usage.workOrderNumber} · ${usage.partName}`,
      href: `/work-orders/${encodeURIComponent(usage.workOrderNumber)}`,
      status: null,
      tone: "done" as const,
    })),
  ]
    .sort(
      (left, right) =>
        new Date(right.occurredAt).getTime() -
        new Date(left.occurredAt).getTime(),
    )
    .slice(0, 16);

  return {
    asset: { ...asset, healthScore: reliability.metrics.healthScore },
    children,
    orders,
    compatibleParts,
    incidents,
    history,
    healthDrivers,
    maintenanceCost: Number(aggregates?.maintenanceCost ?? 0),
    downtimeMinutes: Number(aggregates?.downtimeMinutes ?? 0),
    maintenancePlans,
    fieldEvidence,
    fieldMeasurements,
    reliability,
  };
}
