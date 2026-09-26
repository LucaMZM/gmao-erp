import type { FacetOption, SqlValue, TenantScope } from "./shared";
import {
  locationScopePredicate,
  normalizePage,
  normalizeQuery,
  queryAll,
  queryFirst,
} from "./shared";

const PAGE_SIZE = 24;

export type IncidentFilters = {
  q?: string | string[];
  status?: string | string[];
  severity?: string | string[];
  view?: string | string[];
  page?: string | string[];
};

export type IncidentListItem = {
  id: string;
  number: string;
  title: string;
  severity: string;
  initialImpact: string;
  status: string;
  origin: string;
  reportedAt: string;
  reporterName: string;
  locationCode: string;
  locationName: string;
  assetCode: string | null;
  assetName: string | null;
  workOrderNumber: string | null;
};

export type IncidentListData = {
  items: IncidentListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  query: string;
  counts: { new: number; triage: number; accepted: number; all: number };
  facets: { statuses: FacetOption[]; severities: FacetOption[] };
};

type NormalizedIncidentFilters = {
  query: string;
  status: string;
  severity: string;
  view: string;
};

function incidentConditions(
  scope: TenantScope,
  filters: NormalizedIncidentFilters,
  exclude?: "status" | "severity",
): { conditions: string[]; params: SqlValue[] } {
  const conditions = ["incident.organization_id = ?", "incident.site_id = ?"];
  const params: SqlValue[] = [scope.organizationId, scope.siteId];
  const locationScope = locationScopePredicate(
    scope,
    "incident.functional_location_id",
  );
  conditions.push(locationScope.sql);
  params.push(...locationScope.params);
  if (filters.view === "triage") {
    conditions.push("incident.status IN ('NEW','IN_TRIAGE','ACCEPTED')");
  } else if (filters.view === "new") {
    conditions.push("incident.status = 'NEW'");
  } else if (filters.view === "converted") {
    conditions.push("incident.status = 'CONVERTED'");
  }
  if (filters.query) {
    const like = `%${filters.query}%`;
    conditions.push(
      "(incident.number LIKE ? OR incident.title LIKE ? OR asset.code LIKE ? OR location.name LIKE ?)",
    );
    params.push(like, like, like, like);
  }
  if (exclude !== "status" && filters.status) {
    conditions.push("incident.status = ?");
    params.push(filters.status);
  }
  if (exclude !== "severity" && filters.severity) {
    conditions.push("incident.severity = ?");
    params.push(filters.severity);
  }
  return { conditions, params };
}

async function getIncidentFacets(
  scope: TenantScope,
  filters: NormalizedIncidentFilters,
): Promise<IncidentListData["facets"]> {
  const status = incidentConditions(scope, filters, "status");
  const severity = incidentConditions(scope, filters, "severity");
  const from = `FROM incidents incident
    INNER JOIN functional_locations location ON location.id = incident.functional_location_id
    LEFT JOIN assets asset ON asset.id = incident.asset_id`;
  const [statuses, severities] = await Promise.all([
    queryAll<FacetOption>(
      `SELECT incident.status AS value, COUNT(*) AS count ${from}
       WHERE ${status.conditions.join(" AND ")} GROUP BY incident.status`,
      status.params,
    ),
    queryAll<FacetOption>(
      `SELECT incident.severity AS value, COUNT(*) AS count ${from}
       WHERE ${severity.conditions.join(" AND ")} GROUP BY incident.severity`,
      severity.params,
    ),
  ]);
  return { statuses, severities };
}

export async function listIncidents(
  scope: TenantScope,
  filters: IncidentFilters,
): Promise<IncidentListData> {
  const page = normalizePage(filters.page);
  const normalized: NormalizedIncidentFilters = {
    query: normalizeQuery(filters.q),
    status: normalizeQuery(filters.status, 30),
    severity: normalizeQuery(filters.severity, 20),
    view: normalizeQuery(filters.view, 20) || "triage",
  };
  const filtered = incidentConditions(scope, normalized);
  const where = filtered.conditions.join(" AND ");
  const locationScope = locationScopePredicate(
    scope,
    "incident.functional_location_id",
  );
  const [count, items, counts, facets] = await Promise.all([
    queryFirst<{ count: number }>(
      `SELECT COUNT(*) AS count FROM incidents incident
       INNER JOIN functional_locations location ON location.id = incident.functional_location_id
       LEFT JOIN assets asset ON asset.id = incident.asset_id
       WHERE ${where}`,
      filtered.params,
    ),
    queryAll<IncidentListItem>(
      `SELECT incident.id, incident.number, incident.title, incident.severity,
        incident.initial_impact AS initialImpact, incident.status, incident.origin,
        incident.reported_at AS reportedAt, reporter.full_name AS reporterName,
        location.code AS locationCode, location.name AS locationName,
        asset.code AS assetCode, asset.name AS assetName,
        wo.number AS workOrderNumber
       FROM incidents incident
       INNER JOIN users reporter ON reporter.id = incident.reported_by_id
       INNER JOIN functional_locations location ON location.id = incident.functional_location_id
       LEFT JOIN assets asset ON asset.id = incident.asset_id
       LEFT JOIN work_orders wo ON wo.incident_id = incident.id
       WHERE ${where}
       ORDER BY
         CASE incident.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
         incident.reported_at DESC, incident.number DESC
       LIMIT ? OFFSET ?`,
      [...filtered.params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    ),
    queryFirst<{
      newCount: number;
      triage: number;
      accepted: number;
      allCount: number;
    }>(
      `SELECT
        SUM(CASE WHEN status = 'NEW' THEN 1 ELSE 0 END) AS newCount,
        SUM(CASE WHEN status = 'IN_TRIAGE' THEN 1 ELSE 0 END) AS triage,
        SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted,
        COUNT(*) AS allCount
       FROM incidents incident WHERE organization_id = ? AND site_id = ?
         AND ${locationScope.sql}`,
      [scope.organizationId, scope.siteId, ...locationScope.params],
    ),
    getIncidentFacets(scope, normalized),
  ]);
  const total = Number(count?.count ?? 0);
  return {
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    query: normalized.query,
    counts: {
      new: Number(counts?.newCount ?? 0),
      triage: Number(counts?.triage ?? 0),
      accepted: Number(counts?.accepted ?? 0),
      all: Number(counts?.allCount ?? 0),
    },
    facets,
  };
}

export type IncidentDetail = IncidentListItem & {
  description: string;
  classification: string | null;
  triagePriority: string | null;
  functionalLocationId: string;
  assetId: string | null;
  triagedAt: string | null;
  resolvedAt: string | null;
  workOrderId: string | null;
};

export type IncidentTimelineItem = {
  id: string;
  kind: "EVENT" | "NOTE";
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  actorName: string;
  createdAt: string;
};

export type IncidentFormOption = { id: string; code: string; name: string };

export type IncidentDetailData = {
  incident: IncidentDetail;
  timeline: IncidentTimelineItem[];
  locations: IncidentFormOption[];
  assets: IncidentFormOption[];
};

export async function getIncidentOptions(scope: TenantScope): Promise<{
  locations: IncidentFormOption[];
  assets: IncidentFormOption[];
}> {
  const locationScope = locationScopePredicate(scope, "location.id");
  const assetScope = locationScopePredicate(
    scope,
    "asset.functional_location_id",
  );
  const [locations, assets] = await Promise.all([
    queryAll<IncidentFormOption>(
      `SELECT location.id, location.code, location.name FROM functional_locations location
       WHERE location.organization_id = ? AND location.site_id = ? AND location.status = 'ACTIVE'
         AND ${locationScope.sql}
       ORDER BY sort_order, code`,
      [scope.organizationId, scope.siteId, ...locationScope.params],
    ),
    queryAll<IncidentFormOption>(
      `SELECT asset.id, asset.code, asset.name FROM assets asset
       WHERE asset.organization_id = ? AND asset.site_id = ? AND asset.status != 'RETIRED'
         AND ${assetScope.sql}
       ORDER BY code`,
      [scope.organizationId, scope.siteId, ...assetScope.params],
    ),
  ]);
  return { locations, assets };
}

export async function getIncidentDetail(
  scope: TenantScope,
  number: string,
): Promise<IncidentDetailData | null> {
  const locationScope = locationScopePredicate(
    scope,
    "incident.functional_location_id",
  );
  const incident = await queryFirst<IncidentDetail>(
    `SELECT incident.id, incident.number, incident.title, incident.description,
      incident.severity, incident.initial_impact AS initialImpact,
      incident.status, incident.origin, incident.classification,
      incident.triage_priority AS triagePriority,
      incident.reported_at AS reportedAt, incident.triaged_at AS triagedAt,
      incident.resolved_at AS resolvedAt, incident.functional_location_id AS functionalLocationId,
      incident.asset_id AS assetId, reporter.full_name AS reporterName,
      location.code AS locationCode, location.name AS locationName,
      asset.code AS assetCode, asset.name AS assetName,
      wo.id AS workOrderId, wo.number AS workOrderNumber
     FROM incidents incident
     INNER JOIN users reporter ON reporter.id = incident.reported_by_id
     INNER JOIN functional_locations location ON location.id = incident.functional_location_id
     LEFT JOIN assets asset ON asset.id = incident.asset_id
     LEFT JOIN work_orders wo ON wo.incident_id = incident.id
     WHERE incident.organization_id = ? AND incident.site_id = ? AND incident.number = ?
       AND ${locationScope.sql}
     LIMIT 1`,
    [scope.organizationId, scope.siteId, number, ...locationScope.params],
  );
  if (!incident) return null;
  const [events, notes, options] = await Promise.all([
    queryAll<IncidentTimelineItem>(
      `SELECT event.id, 'EVENT' AS kind, event.event_type AS eventType,
        event.from_status AS fromStatus, event.to_status AS toStatus,
        event.note, actor.full_name AS actorName, event.created_at AS createdAt
       FROM incident_events event
       INNER JOIN users actor ON actor.id = event.actor_id
       WHERE event.incident_id = ?`,
      [incident.id],
    ),
    queryAll<IncidentTimelineItem>(
      `SELECT note.id, 'NOTE' AS kind, note.kind AS eventType,
        NULL AS fromStatus, NULL AS toStatus, note.body AS note,
        actor.full_name AS actorName, note.created_at AS createdAt
       FROM incident_notes note
       INNER JOIN users actor ON actor.id = note.actor_id
       WHERE note.incident_id = ?`,
      [incident.id],
    ),
    getIncidentOptions(scope),
  ]);
  return {
    incident,
    timeline: [...events, ...notes].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ),
    ...options,
  };
}
