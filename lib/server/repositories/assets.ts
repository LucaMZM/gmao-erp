import type { FacetOption, SqlValue, TenantScope } from "./shared";
import {
  locationScopePredicate,
  normalizePage,
  normalizeQuery,
  queryAll,
  queryFirst,
} from "./shared";
import { getAssetReliability, type AssetReliabilityData } from "./reliability";
import { syncHealthProjection } from "../health-projection";

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
  parentId: string | null;
  parentCode: string | null;
  isContext: number;
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
  facets: {
    areas: Array<FacetOption & { label: string }>;
    statuses: FacetOption[];
    criticalities: FacetOption[];
    health: FacetOption[];
  };
};

type NormalizedAssetFilters = {
  query: string;
  status: string;
  criticality: string;
  area: string;
  health: string;
};

type AssetFacet = "area" | "status" | "criticality" | "health";

function assetConditions(
  scope: TenantScope,
  filters: NormalizedAssetFilters,
  exclude?: AssetFacet,
): { conditions: string[]; params: SqlValue[] } {
  const conditions = ["asset.site_id = ?", "asset.status != 'RETIRED'"];
  const params: SqlValue[] = [scope.siteId];
  const locationScope = locationScopePredicate(
    scope,
    "asset.functional_location_id",
  );
  conditions.push(locationScope.sql);
  params.push(...locationScope.params);
  if (filters.query) {
    conditions.push(
      "(asset.code LIKE ? OR asset.name LIKE ? OR asset.manufacturer LIKE ? OR asset.model LIKE ?)",
    );
    const like = `%${filters.query}%`;
    params.push(like, like, like, like);
  }
  if (exclude !== "status" && filters.status) {
    conditions.push("asset.status = ?");
    params.push(filters.status);
  }
  if (exclude !== "criticality" && filters.criticality) {
    conditions.push("asset.criticality = ?");
    params.push(filters.criticality);
  }
  if (exclude !== "area" && filters.area) {
    conditions.push("(location.code = ? OR parent_location.code = ?)");
    params.push(filters.area, filters.area);
  }
  if (exclude !== "health") {
    if (filters.health === "RISK") conditions.push("asset.health_score < 70");
    if (filters.health === "WATCH")
      conditions.push("asset.health_score >= 70 AND asset.health_score < 85");
    if (filters.health === "HEALTHY")
      conditions.push("asset.health_score >= 85");
  }
  return { conditions, params };
}

const ASSET_FROM = `
  FROM assets asset
  INNER JOIN functional_locations location ON location.id = asset.functional_location_id
  LEFT JOIN functional_locations parent_location ON parent_location.id = location.parent_id
`;

async function getAssetFacets(
  scope: TenantScope,
  filters: NormalizedAssetFilters,
): Promise<AssetListData["facets"]> {
  const area = assetConditions(scope, filters, "area");
  const status = assetConditions(scope, filters, "status");
  const criticality = assetConditions(scope, filters, "criticality");
  const health = assetConditions(scope, filters, "health");
  const [areas, statuses, criticalities, healthOptions] = await Promise.all([
    queryAll<FacetOption & { label: string }>(
      `SELECT COALESCE(parent_location.code, location.code) AS value,
        COALESCE(parent_location.name, location.name) AS label,
        COUNT(DISTINCT asset.id) AS count
       ${ASSET_FROM}
       WHERE ${area.conditions.join(" AND ")}
       GROUP BY value, label ORDER BY label`,
      area.params,
    ),
    queryAll<FacetOption>(
      `SELECT asset.status AS value, COUNT(*) AS count ${ASSET_FROM}
       WHERE ${status.conditions.join(" AND ")}
       GROUP BY asset.status`,
      status.params,
    ),
    queryAll<FacetOption>(
      `SELECT asset.criticality AS value, COUNT(*) AS count ${ASSET_FROM}
       WHERE ${criticality.conditions.join(" AND ")}
       GROUP BY asset.criticality`,
      criticality.params,
    ),
    queryAll<FacetOption>(
      `SELECT CASE
          WHEN asset.health_score < 70 THEN 'RISK'
          WHEN asset.health_score < 85 THEN 'WATCH'
          ELSE 'HEALTHY'
        END AS value, COUNT(*) AS count
       ${ASSET_FROM}
       WHERE ${health.conditions.join(" AND ")}
       GROUP BY value`,
      health.params,
    ),
  ]);
  return { areas, statuses, criticalities, health: healthOptions };
}

export async function listAssets(
  scope: TenantScope,
  filters: AssetFilters,
): Promise<AssetListData> {
  await syncHealthProjection(scope);
  const page = normalizePage(filters.page);
  const normalized: NormalizedAssetFilters = {
    query: normalizeQuery(filters.q),
    status: normalizeQuery(filters.status, 30),
    criticality: normalizeQuery(filters.criticality, 20),
    area: normalizeQuery(filters.area, 30),
    health: normalizeQuery(filters.health, 20),
  };
  const view = normalizeQuery(filters.view, 20) || "list";
  const filtered = assetConditions(scope, normalized);
  const where = filtered.conditions.join(" AND ");
  const select = `SELECT
      asset.id, asset.code, asset.name, asset.status, asset.criticality,
      asset.health_score AS healthScore, asset.kind,
      location.code AS locationCode, location.name AS locationName,
      class.name AS className, asset.manufacturer, asset.model,
      asset.parent_asset_id AS parentId, parent_asset.code AS parentCode,
      0 AS isContext,
      (SELECT COUNT(*) FROM work_orders wo
        WHERE wo.asset_id = asset.id AND wo.status IN ${OPEN_STATES}) AS openOrders,
      (SELECT MAX(wo.actual_end) FROM work_orders wo
        WHERE wo.asset_id = asset.id AND wo.status IN ('COMPLETED','CLOSED')) AS lastMaintenanceAt`;
  const joins = `${ASSET_FROM}
    INNER JOIN asset_classes class ON class.id = asset.asset_class_id
    LEFT JOIN assets parent_asset ON parent_asset.id = asset.parent_asset_id`;
  const [count, facets] = await Promise.all([
    queryFirst<{ count: number }>(
      `SELECT COUNT(*) AS count ${ASSET_FROM} WHERE ${where}`,
      filtered.params,
    ),
    getAssetFacets(scope, normalized),
  ]);
  const total = Number(count?.count ?? 0);
  let totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  let items: AssetListItem[];

  if (view === "hierarchy") {
    const base = assetConditions(scope, {
      query: "",
      status: "",
      criticality: "",
      area: "",
      health: "",
    });
    const matching = assetConditions(scope, normalized);
    const rootCount = await queryFirst<{ count: number }>(
      `WITH RECURSIVE
       scoped_assets AS (
         SELECT asset.id, asset.parent_asset_id
         ${ASSET_FROM}
         WHERE ${base.conditions.join(" AND ")}
       ),
       roots(node_id, root_id) AS (
         SELECT id, id FROM scoped_assets WHERE parent_asset_id IS NULL
         UNION ALL
         SELECT child.id, root.root_id FROM scoped_assets child
         INNER JOIN roots root ON child.parent_asset_id = root.node_id
       ),
       matching AS (
         SELECT asset.id ${ASSET_FROM}
         WHERE ${matching.conditions.join(" AND ")}
       )
       SELECT COUNT(DISTINCT roots.root_id) AS count
       FROM matching INNER JOIN roots ON roots.node_id = matching.id`,
      [...base.params, ...matching.params],
    );
    totalPages = Math.max(
      1,
      Math.ceil(Number(rootCount?.count ?? 0) / PAGE_SIZE),
    );
    items = await queryAll<AssetListItem>(
      `WITH RECURSIVE
       scoped_assets AS (
         SELECT asset.id, asset.parent_asset_id
         ${ASSET_FROM}
         WHERE ${base.conditions.join(" AND ")}
       ),
       roots(node_id, root_id) AS (
         SELECT id, id FROM scoped_assets WHERE parent_asset_id IS NULL
         UNION ALL
         SELECT child.id, root.root_id FROM scoped_assets child
         INNER JOIN roots root ON child.parent_asset_id = root.node_id
       ),
       matching AS (
         SELECT asset.id ${ASSET_FROM}
         WHERE ${matching.conditions.join(" AND ")}
       ),
       page_roots AS (
         SELECT roots.root_id
         FROM matching INNER JOIN roots ON roots.node_id = matching.id
         INNER JOIN assets root_asset ON root_asset.id = roots.root_id
         GROUP BY roots.root_id, root_asset.code
         ORDER BY root_asset.code
         LIMIT ? OFFSET ?
       ),
       included(id) AS (
         SELECT matching.id FROM matching
         INNER JOIN roots ON roots.node_id = matching.id
         INNER JOIN page_roots ON page_roots.root_id = roots.root_id
         UNION
         SELECT scoped.parent_asset_id FROM scoped_assets scoped
         INNER JOIN included child ON child.id = scoped.id
         WHERE scoped.parent_asset_id IS NOT NULL
       )
       ${select.replace("0 AS isContext", "CASE WHEN matching.id IS NULL THEN 1 ELSE 0 END AS isContext")}
       ${joins}
       INNER JOIN included ON included.id = asset.id
       LEFT JOIN matching ON matching.id = asset.id
       ORDER BY asset.code`,
      [...base.params, ...matching.params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    );
  } else {
    items = await queryAll<AssetListItem>(
      `${select} ${joins}
       WHERE ${where}
       ORDER BY
         CASE asset.criticality WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
         asset.health_score ASC, asset.code ASC
       LIMIT ? OFFSET ?`,
      [...filtered.params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    );
  }

  return {
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages,
    query: normalized.query,
    areas: facets.areas.map(({ value, label }) => ({
      code: value,
      name: label,
    })),
    facets,
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
  parentId: string;
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
  await syncHealthProjection(scope);
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
  const childLocationScope = locationScopePredicate(
    scope,
    "child.functional_location_id",
  );

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
      WITH RECURSIVE descendants AS (
        SELECT child.id, child.parent_asset_id
        FROM assets child
        WHERE child.parent_asset_id = ? AND child.site_id = ?
        UNION ALL
        SELECT child.id, child.parent_asset_id
        FROM assets child
        INNER JOIN descendants parent ON child.parent_asset_id = parent.id
        WHERE child.site_id = ?
      )
      SELECT child.id, child.parent_asset_id AS parentId,
        child.code, child.name, child.status,
        child.health_score AS healthScore, child.criticality, class.name AS className
      FROM descendants
      INNER JOIN assets child ON child.id = descendants.id
      INNER JOIN asset_classes class ON class.id = child.asset_class_id
      WHERE ${childLocationScope.sql}
      ORDER BY child.code
    `,
      [asset.id, scope.siteId, scope.siteId, ...childLocationScope.params],
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
