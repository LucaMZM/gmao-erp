import { dateKeyInTimeZone } from "@/lib/presentation";
import type { FacetOption, SqlValue, TenantScope } from "./shared";
import {
  locationScopePredicate,
  normalizePage,
  normalizeQuery,
  queryAll,
  queryFirst,
} from "./shared";

const OPEN_STATES =
  "('REQUESTED','TRIAGE','APPROVED','PLANNED','SCHEDULED','ASSIGNED','IN_PROGRESS','PAUSED','WAITING_PART','WAITING_VENDOR')";
const PAGE_SIZE = 25;

export type WorkOrderFilters = {
  q?: string | string[];
  status?: string | string[];
  priority?: string | string[];
  type?: string | string[];
  view?: string | string[];
  page?: string | string[];
};

export type WorkOrderListItem = {
  id: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  assetCode: string;
  assetName: string;
  locationName: string;
  assigneeName: string | null;
  assigneeInitials: string | null;
  requestedAt: string;
  dueAt: string | null;
  plannedStart: string | null;
  estimatedMinutes: number;
};

export type WorkOrderListData = {
  items: WorkOrderListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  counts: {
    all: number;
    attention: number;
    today: number;
    backlog: number;
    totalOpen: number;
  };
  query: string;
  facets: {
    statuses: FacetOption[];
    priorities: FacetOption[];
    types: FacetOption[];
  };
};

type NormalizedWorkOrderFilters = {
  query: string;
  status: string;
  priority: string;
  type: string;
  view: string;
  now: string;
  today: string;
};

type WorkOrderFacet = "status" | "priority" | "type";

function workOrderConditions(
  scope: TenantScope,
  filters: NormalizedWorkOrderFilters,
  exclude?: WorkOrderFacet,
): { conditions: string[]; params: SqlValue[] } {
  const conditions = ["wo.site_id = ?"];
  const params: SqlValue[] = [scope.siteId];
  const locationScope = locationScopePredicate(
    scope,
    "wo.functional_location_id",
  );
  conditions.push(locationScope.sql);
  params.push(...locationScope.params);
  if (filters.view === "attention") {
    conditions.push(
      `wo.status IN ${OPEN_STATES} AND (wo.priority IN ('P1_EMERGENCY','P2_URGENT') OR wo.due_at < ? OR wo.status IN ('WAITING_PART','WAITING_VENDOR'))`,
    );
    params.push(filters.now);
  } else if (filters.view === "today") {
    conditions.push("substr(wo.planned_start, 1, 10) = ?");
    params.push(filters.today);
  } else if (filters.view === "backlog") {
    conditions.push(`wo.status IN ${OPEN_STATES}`);
  }
  if (filters.query) {
    const like = `%${filters.query}%`;
    conditions.push(
      "(wo.number LIKE ? OR wo.title LIKE ? OR asset.code LIKE ? OR asset.name LIKE ?)",
    );
    params.push(like, like, like, like);
  }
  if (exclude !== "status" && filters.status) {
    conditions.push("wo.status = ?");
    params.push(filters.status);
  }
  if (exclude !== "priority" && filters.priority) {
    conditions.push("wo.priority = ?");
    params.push(filters.priority);
  }
  if (exclude !== "type" && filters.type) {
    conditions.push("wo.type = ?");
    params.push(filters.type);
  }
  return { conditions, params };
}

async function getWorkOrderFacets(
  scope: TenantScope,
  filters: NormalizedWorkOrderFilters,
): Promise<WorkOrderListData["facets"]> {
  const queryFacet = (column: WorkOrderFacet) => {
    const scoped = workOrderConditions(scope, filters, column);
    return queryAll<FacetOption>(
      `SELECT wo.${column} AS value, COUNT(*) AS count
       FROM work_orders wo INNER JOIN assets asset ON asset.id = wo.asset_id
       WHERE ${scoped.conditions.join(" AND ")}
       GROUP BY wo.${column}`,
      scoped.params,
    );
  };
  const [statuses, priorities, types] = await Promise.all([
    queryFacet("status"),
    queryFacet("priority"),
    queryFacet("type"),
  ]);
  return { statuses, priorities, types };
}

export async function listWorkOrders(
  scope: TenantScope,
  filters: WorkOrderFilters,
): Promise<WorkOrderListData> {
  const page = normalizePage(filters.page);
  const now = new Date().toISOString();
  const today = dateKeyInTimeZone(now);
  const normalized: NormalizedWorkOrderFilters = {
    query: normalizeQuery(filters.q),
    status: normalizeQuery(filters.status, 30),
    priority: normalizeQuery(filters.priority, 30),
    type: normalizeQuery(filters.type, 30),
    view: normalizeQuery(filters.view, 30) || "attention",
    now,
    today,
  };
  const filtered = workOrderConditions(scope, normalized);
  const where = filtered.conditions.join(" AND ");
  const locationScope = locationScopePredicate(
    scope,
    "wo.functional_location_id",
  );

  const [countRow, items, counts, facets] = await Promise.all([
    queryFirst<{ count: number }>(
      `
      SELECT COUNT(*) AS count
      FROM work_orders wo
      INNER JOIN assets asset ON asset.id = wo.asset_id
      WHERE ${where}
    `,
      filtered.params,
    ),
    queryAll<WorkOrderListItem>(
      `
      SELECT
        wo.id,
        wo.number,
        wo.title,
        wo.status,
        wo.priority,
        wo.type,
        asset.code AS assetCode,
        asset.name AS assetName,
        location.name AS locationName,
        (SELECT user.full_name FROM work_order_assignments assignment
          INNER JOIN users user ON user.id = assignment.user_id
          WHERE assignment.work_order_id = wo.id AND assignment.unassigned_at IS NULL
          ORDER BY assignment.assigned_at LIMIT 1) AS assigneeName,
        (SELECT user.initials FROM work_order_assignments assignment
          INNER JOIN users user ON user.id = assignment.user_id
          WHERE assignment.work_order_id = wo.id AND assignment.unassigned_at IS NULL
          ORDER BY assignment.assigned_at LIMIT 1) AS assigneeInitials,
        wo.requested_at AS requestedAt,
        wo.due_at AS dueAt,
        wo.planned_start AS plannedStart,
        wo.estimated_minutes AS estimatedMinutes
      FROM work_orders wo
      INNER JOIN assets asset ON asset.id = wo.asset_id
      INNER JOIN functional_locations location ON location.id = wo.functional_location_id
      WHERE ${where}
      ORDER BY
        CASE wo.priority WHEN 'P1_EMERGENCY' THEN 1 WHEN 'P2_URGENT' THEN 2 WHEN 'P3_HIGH' THEN 3 WHEN 'P4_NORMAL' THEN 4 ELSE 5 END,
        CASE WHEN wo.due_at < ? THEN 0 ELSE 1 END,
        wo.due_at ASC,
        wo.number DESC
      LIMIT ? OFFSET ?
    `,
      [...filtered.params, now, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    ),
    queryFirst<{
      allCount: number;
      attention: number;
      today: number;
      backlog: number;
      totalOpen: number;
    }>(
      `
      SELECT
        COUNT(*) AS allCount,
        SUM(CASE WHEN status IN ${OPEN_STATES} AND (priority IN ('P1_EMERGENCY','P2_URGENT') OR due_at < ? OR status IN ('WAITING_PART','WAITING_VENDOR')) THEN 1 ELSE 0 END) AS attention,
        SUM(CASE WHEN substr(planned_start, 1, 10) = ? THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN status IN ${OPEN_STATES} THEN 1 ELSE 0 END) AS backlog,
        SUM(CASE WHEN status IN ${OPEN_STATES} THEN 1 ELSE 0 END) AS totalOpen
      FROM work_orders wo
      WHERE site_id = ? AND ${locationScope.sql}
    `,
      [now, today, scope.siteId, ...locationScope.params],
    ),
    getWorkOrderFacets(scope, normalized),
  ]);
  const total = Number(countRow?.count ?? 0);

  return {
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    counts: {
      all: Number(counts?.allCount ?? 0),
      attention: Number(counts?.attention ?? 0),
      today: Number(counts?.today ?? 0),
      backlog: Number(counts?.backlog ?? 0),
      totalOpen: Number(counts?.totalOpen ?? 0),
    },
    query: normalized.query,
    facets,
  };
}

export type WorkOrderDetail = {
  id: string;
  assetId: string;
  failureModeId: string | null;
  number: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  type: string;
  source: string;
  requestedAt: string;
  dueAt: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  estimatedMinutes: number;
  downtimeMinutes: number;
  diagnosis: string | null;
  solution: string | null;
  failureMode: string | null;
  failureCause: string | null;
  productionImpact: string;
  safetyLevel: string;
  safetySummary: string | null;
  ppeRequired: string | null;
  precautions: string | null;
  isolationRequired: number;
  completedAt: string | null;
  closedAt: string | null;
  incidentNumber: string | null;
  maintenancePlanCode: string | null;
  maintenancePlanTitle: string | null;
  preventiveDueAt: string | null;
  assetCode: string;
  assetName: string;
  assetStatus: string;
  assetHealthScore: number;
  locationCode: string;
  locationName: string;
  requesterName: string;
  assigneeName: string | null;
  assigneeInitials: string | null;
  assigneeJobTitle: string | null;
};

export type WorkOrderEvent = {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  createdAt: string;
  actorName: string;
};

export type LaborEntry = {
  id: string;
  userId: string;
  userName: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number;
  status: string;
  note: string | null;
  hourlyRateCents: number | null;
  laborCostCents: number | null;
};

export type MaterialUsage = {
  id: string;
  sku: string;
  partName: string;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  movementId: string;
  usageType: string;
  createdAt: string;
};

export type DowntimeEntry = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  kind: string;
  productionImpact: string;
  cause: string | null;
};

export type WorkOrderDetailData = {
  order: WorkOrderDetail;
  events: WorkOrderEvent[];
  labor: LaborEntry[];
  materials: MaterialUsage[];
  downtime: DowntimeEntry[];
  assignments: Array<{
    id: string;
    userId: string;
    userName: string;
    initials: string;
    jobTitle: string;
    assignedAt: string;
  }>;
  technicians: Array<{
    id: string;
    fullName: string;
    initials: string;
    jobTitle: string;
  }>;
  materialPlans: Array<{
    id: string;
    partId: string;
    sku: string;
    partName: string;
    unit: string;
    planned: number;
    reserved: number;
    consumed: number;
    returned: number;
    onHand: number;
    available: number;
    onOrder: number;
    binCode: string;
    unitCost: number;
  }>;
  materialOptions: Array<{
    id: string;
    sku: string;
    name: string;
    unit: string;
    available: number;
    onOrder: number;
    relation: string | null;
  }>;
  laborMinutes: number;
  materialCost: number;
  costs: {
    labor: number;
    material: number;
    explicit: number;
    total: number;
  };
  tasks: Array<{
    id: string;
    sequence: number;
    title: string;
    description: string | null;
    required: number;
    responseType: string;
    unit: string | null;
    minimumValue: number | null;
    maximumValue: number | null;
    meterId: string | null;
    responseValue: string | null;
    responseStatus: string;
    respondedAt: string | null;
    respondedBy: string | null;
    completedAt: string | null;
    completedBy: string | null;
  }>;
  skillRequirements: Array<{
    id: string;
    code: string;
    name: string;
    minimumLevel: number;
  }>;
  certificationRequirements: Array<{
    id: string;
    code: string;
    name: string;
  }>;
  procurementLinks: Array<{
    id: string;
    requisitionNumber: string;
    requisitionStatus: string;
    purchaseOrderNumber: string | null;
    purchaseOrderStatus: string | null;
    partSummary: string;
  }>;
};

export async function getWorkOrderDetail(
  scope: TenantScope,
  number: string,
): Promise<WorkOrderDetailData | null> {
  const locationScope = locationScopePredicate(
    scope,
    "wo.functional_location_id",
  );
  const order = await queryFirst<WorkOrderDetail>(
    `
    SELECT
      wo.id,
      wo.asset_id AS assetId,
      wo.failure_mode_id AS failureModeId,
      wo.number,
      wo.title,
      wo.description,
      wo.status,
      wo.priority,
      wo.type,
      wo.source,
      wo.requested_at AS requestedAt,
      wo.due_at AS dueAt,
      wo.planned_start AS plannedStart,
      wo.planned_end AS plannedEnd,
      wo.actual_start AS actualStart,
      wo.actual_end AS actualEnd,
      wo.estimated_minutes AS estimatedMinutes,
      wo.downtime_minutes AS downtimeMinutes,
      wo.diagnosis,
      wo.solution,
      wo.failure_mode AS failureMode,
      wo.failure_cause AS failureCause,
      wo.production_impact AS productionImpact,
      wo.safety_level AS safetyLevel,
      wo.safety_summary AS safetySummary,
      wo.ppe_required AS ppeRequired,
      wo.precautions,
      wo.isolation_required AS isolationRequired,
      wo.completed_at AS completedAt,
      wo.closed_at AS closedAt,
      incident.number AS incidentNumber,
      plan.code AS maintenancePlanCode,
      plan.title AS maintenancePlanTitle,
      wo.preventive_due_at AS preventiveDueAt,
      asset.code AS assetCode,
      asset.name AS assetName,
      asset.status AS assetStatus,
      asset.health_score AS assetHealthScore,
      location.code AS locationCode,
      location.name AS locationName,
      requester.full_name AS requesterName,
      (SELECT user.full_name FROM work_order_assignments assignment
        INNER JOIN users user ON user.id = assignment.user_id
        WHERE assignment.work_order_id = wo.id AND assignment.unassigned_at IS NULL
        ORDER BY assignment.assigned_at LIMIT 1) AS assigneeName,
      (SELECT user.initials FROM work_order_assignments assignment
        INNER JOIN users user ON user.id = assignment.user_id
        WHERE assignment.work_order_id = wo.id AND assignment.unassigned_at IS NULL
        ORDER BY assignment.assigned_at LIMIT 1) AS assigneeInitials,
      (SELECT user.job_title FROM work_order_assignments assignment
        INNER JOIN users user ON user.id = assignment.user_id
        WHERE assignment.work_order_id = wo.id AND assignment.unassigned_at IS NULL
        ORDER BY assignment.assigned_at LIMIT 1) AS assigneeJobTitle
    FROM work_orders wo
    INNER JOIN assets asset ON asset.id = wo.asset_id
    INNER JOIN functional_locations location ON location.id = wo.functional_location_id
    INNER JOIN users requester ON requester.id = wo.requested_by_id
    LEFT JOIN incidents incident ON incident.id = wo.incident_id
    LEFT JOIN maintenance_plans plan ON plan.id = wo.maintenance_plan_id
    WHERE wo.organization_id = ? AND wo.site_id = ? AND wo.number = ?
      AND ${locationScope.sql}
    LIMIT 1
  `,
    [scope.organizationId, scope.siteId, number, ...locationScope.params],
  );
  if (!order) return null;

  const [
    events,
    labor,
    materials,
    downtime,
    assignments,
    technicians,
    materialPlans,
    materialOptions,
    tasks,
    skillRequirements,
    certificationRequirements,
    procurementLinks,
    explicitCosts,
  ] = await Promise.all([
    queryAll<WorkOrderEvent>(
      `
      SELECT event.id, event.event_type AS eventType, event.from_status AS fromStatus,
        event.to_status AS toStatus, event.note, event.created_at AS createdAt,
        actor.full_name AS actorName
      FROM work_order_events event
      INNER JOIN users actor ON actor.id = event.actor_id
      WHERE event.work_order_id = ?
      ORDER BY event.created_at DESC
    `,
      [order.id],
    ),
    queryAll<LaborEntry>(
      `
      SELECT labor.id, labor.user_id AS userId, user.full_name AS userName,
        labor.started_at AS startedAt, labor.ended_at AS endedAt,
        labor.minutes, labor.status, labor.note,
        labor.hourly_rate_cents_snapshot AS hourlyRateCents,
        labor.labor_cost_cents AS laborCostCents
      FROM labor_sessions labor
      INNER JOIN users user ON user.id = labor.user_id
      WHERE labor.work_order_id = ?
      ORDER BY labor.started_at DESC
    `,
      [order.id],
    ),
    queryAll<MaterialUsage>(
      `
      SELECT usage.id, part.sku, part.name AS partName, usage.quantity,
        part.unit, usage.unit_cost_snapshot AS unitCost, usage.total_cost AS totalCost,
        usage.movement_id AS movementId, usage.usage_type AS usageType,
        usage.created_at AS createdAt
      FROM work_order_part_usages usage
      INNER JOIN parts part ON part.id = usage.part_id
      WHERE usage.work_order_id = ?
      ORDER BY usage.created_at DESC
    `,
      [order.id],
    ),
    queryAll<DowntimeEntry>(
      `
      SELECT id, started_at AS startedAt, ended_at AS endedAt,
        duration_minutes AS durationMinutes, kind,
        production_impact AS productionImpact, cause
      FROM downtime_events
      WHERE work_order_id = ?
      ORDER BY started_at DESC
    `,
      [order.id],
    ),
    queryAll<WorkOrderDetailData["assignments"][number]>(
      `SELECT assignment.id, assignment.user_id AS userId,
        user.full_name AS userName, user.initials, user.job_title AS jobTitle,
        assignment.assigned_at AS assignedAt
       FROM work_order_assignments assignment
       INNER JOIN users user ON user.id = assignment.user_id
       WHERE assignment.work_order_id = ? AND assignment.unassigned_at IS NULL
       ORDER BY assignment.assigned_at`,
      [order.id],
    ),
    queryAll<WorkOrderDetailData["technicians"][number]>(
      `SELECT user.id, user.full_name AS fullName, user.initials,
        user.job_title AS jobTitle
       FROM users user
       INNER JOIN memberships membership ON membership.user_id = user.id
       WHERE membership.organization_id = ? AND membership.status = 'ACTIVE'
         AND user.status = 'ACTIVE'
         AND membership.role_key IN ('TECHNICIAN','SUPERVISOR')
       ORDER BY CASE membership.role_key WHEN 'TECHNICIAN' THEN 1 ELSE 2 END,
         user.full_name`,
      [scope.organizationId],
    ),
    queryAll<WorkOrderDetailData["materialPlans"][number]>(
      `SELECT material.id, material.part_id AS partId, part.sku,
        part.name AS partName, part.unit,
        material.planned_quantity AS planned,
        material.reserved_quantity AS reserved,
        material.consumed_quantity AS consumed,
        material.returned_quantity AS returned,
        stock.on_hand AS onHand, stock.on_hand - stock.reserved AS available,
        stock.on_order AS onOrder, bin.code AS binCode,
        policy.average_cost AS unitCost
       FROM work_order_materials material
       INNER JOIN parts part ON part.id = material.part_id
       INNER JOIN stock_levels stock ON stock.part_id = part.id
         AND stock.bin_id = material.bin_id AND stock.site_id = ?
       INNER JOIN warehouse_bins bin ON bin.id = material.bin_id
       INNER JOIN part_site_policies policy ON policy.part_id = part.id
         AND policy.site_id = stock.site_id
       WHERE material.work_order_id = ?
       ORDER BY material.created_at, part.sku`,
      [scope.siteId, order.id],
    ),
    queryAll<WorkOrderDetailData["materialOptions"][number]>(
      `SELECT part.id, part.sku, part.name, part.unit,
        stock.on_hand - stock.reserved AS available, stock.on_order AS onOrder,
        compatibility.relation
       FROM parts part
       INNER JOIN stock_levels stock ON stock.part_id = part.id AND stock.site_id = ?
       LEFT JOIN asset_part_compatibilities compatibility
         ON compatibility.part_id = part.id AND compatibility.asset_id = (
           SELECT asset_id FROM work_orders WHERE id = ?
         )
       WHERE part.organization_id = ? AND part.status = 'ACTIVE'
       ORDER BY CASE WHEN compatibility.relation = 'PREFERRED' THEN 0
                     WHEN compatibility.relation = 'COMPATIBLE' THEN 1 ELSE 2 END,
         available DESC, part.sku
       LIMIT 60`,
      [scope.siteId, order.id, scope.organizationId],
    ),
    queryAll<WorkOrderDetailData["tasks"][number]>(
      `SELECT task.id, task.sequence, task.title, task.description, task.required,
        task.response_type AS responseType, task.unit,
        task.minimum_value AS minimumValue, task.maximum_value AS maximumValue,
        task.meter_id AS meterId, task.response_value AS responseValue,
        task.response_status AS responseStatus,
        task.responded_at AS respondedAt,
        responder.full_name AS respondedBy,
        task.completed_at AS completedAt, user.full_name AS completedBy
       FROM work_order_tasks task
       LEFT JOIN users user ON user.id = task.completed_by_id
       LEFT JOIN users responder ON responder.id = task.responded_by_id
       WHERE task.work_order_id = ? ORDER BY task.sequence`,
      [order.id],
    ),
    queryAll<WorkOrderDetailData["skillRequirements"][number]>(
      `SELECT skill.id, skill.code, skill.name,
        requirement.minimum_level AS minimumLevel
       FROM work_order_skill_requirements requirement
       INNER JOIN skills skill ON skill.id = requirement.skill_id
       WHERE requirement.work_order_id = ? ORDER BY skill.name`,
      [order.id],
    ),
    queryAll<WorkOrderDetailData["certificationRequirements"][number]>(
      `SELECT certification.id, certification.code, certification.name
       FROM work_order_certification_requirements requirement
       INNER JOIN certifications certification
         ON certification.id = requirement.certification_id
       WHERE requirement.work_order_id = ? ORDER BY certification.code`,
      [order.id],
    ),
    queryAll<WorkOrderDetailData["procurementLinks"][number]>(
      `SELECT requisition.id, requisition.number AS requisitionNumber,
        requisition.status AS requisitionStatus,
        po.number AS purchaseOrderNumber, po.status AS purchaseOrderStatus,
        GROUP_CONCAT(part.sku || ' × ' || line.quantity, ', ') AS partSummary
       FROM purchase_requisitions requisition
       INNER JOIN purchase_requisition_lines line
         ON line.purchase_requisition_id = requisition.id
       INNER JOIN parts part ON part.id = line.part_id
       LEFT JOIN purchase_orders po ON po.requisition_id = requisition.id
       WHERE requisition.work_order_id = ? AND requisition.site_id = ?
       GROUP BY requisition.id, po.id ORDER BY requisition.created_at DESC`,
      [order.id, scope.siteId],
    ),
    queryFirst<{ cents: number }>(
      "SELECT COALESCE(SUM(amount_cents),0) AS cents FROM work_order_cost_items WHERE work_order_id = ? AND site_id = ?",
      [order.id, scope.siteId],
    ),
  ]);

  const laborCost = labor.reduce(
    (sum, entry) => sum + Number(entry.laborCostCents ?? 0) / 100,
    0,
  );
  const materialCost = materials.reduce(
    (sum, entry) => sum + Number(entry.totalCost),
    0,
  );
  const explicitCost = Number(explicitCosts?.cents ?? 0) / 100;

  return {
    order,
    events,
    labor,
    materials,
    downtime,
    assignments,
    technicians,
    materialPlans,
    materialOptions,
    tasks,
    skillRequirements,
    certificationRequirements,
    procurementLinks,
    laborMinutes: labor.reduce((sum, entry) => sum + Number(entry.minutes), 0),
    materialCost,
    costs: {
      labor: laborCost,
      material: materialCost,
      explicit: explicitCost,
      total: laborCost + materialCost + explicitCost,
    },
  };
}
