import { calculatePmCompliance } from "@/lib/domain/preventive";
import type { SqlValue, TenantScope } from "./shared";
import { normalizeQuery, queryAll, queryFirst } from "./shared";

export type MaintenancePlanListItem = {
  id: string;
  code: string;
  title: string;
  description: string;
  status: string;
  triggerMode: string;
  calendarUnit: string | null;
  calendarInterval: number | null;
  nextDueAt: string | null;
  meterThreshold: number | null;
  estimatedMinutes: number;
  criticality: string;
  priority: string;
  assetCode: string;
  assetName: string;
  locationName: string;
  ownerName: string;
  meterCode: string | null;
  meterUnit: string | null;
  meterValue: number | null;
  generatedCount: number;
  openGeneratedCount: number;
};

export type PreventiveCatalog = {
  assets: Array<{
    id: string;
    code: string;
    name: string;
    criticality: string;
    locationId: string;
    locationName: string;
  }>;
  owners: Array<{ id: string; name: string; jobTitle: string }>;
  meters: Array<{
    id: string;
    assetId: string;
    code: string;
    name: string;
    unit: string;
    lastValue: number | null;
  }>;
  skills: Array<{ id: string; code: string; name: string }>;
  certifications: Array<{ id: string; code: string; name: string }>;
  parts: Array<{
    id: string;
    sku: string;
    name: string;
    unit: string;
    available: number;
  }>;
};

export type MaintenancePlanListData = {
  items: MaintenancePlanListItem[];
  counts: { active: number; due: number; upcoming: number; inactive: number };
  compliance: {
    scheduled: number;
    onTime: number;
    overdue: number;
    compliance: number;
  };
  catalog: PreventiveCatalog;
  query: string;
  status: string;
};

export async function getPreventiveCatalog(
  scope: TenantScope,
): Promise<PreventiveCatalog> {
  const [assets, owners, meters, skills, certifications, parts] =
    await Promise.all([
      queryAll<PreventiveCatalog["assets"][number]>(
        `SELECT asset.id, asset.code, asset.name, asset.criticality,
          asset.functional_location_id AS locationId, location.name AS locationName
         FROM assets asset
         INNER JOIN functional_locations location ON location.id = asset.functional_location_id
         WHERE asset.organization_id = ? AND asset.site_id = ? AND asset.status <> 'RETIRED'
         ORDER BY asset.code`,
        [scope.organizationId, scope.siteId],
      ),
      queryAll<PreventiveCatalog["owners"][number]>(
        `SELECT DISTINCT user.id, user.full_name AS name, user.job_title AS jobTitle
         FROM users user
         INNER JOIN memberships membership ON membership.user_id = user.id
         WHERE membership.organization_id = ? AND membership.status = 'ACTIVE'
           AND user.status = 'ACTIVE'
           AND membership.role_key IN ('MAINTENANCE_MANAGER','PLANNER','RELIABILITY_ENGINEER','SUPERVISOR')
         ORDER BY user.full_name`,
        [scope.organizationId],
      ),
      queryAll<PreventiveCatalog["meters"][number]>(
        `SELECT id, asset_id AS assetId, code, name, unit, last_value AS lastValue
         FROM meters
         WHERE organization_id = ? AND site_id = ? AND status = 'ACTIVE'
         ORDER BY code`,
        [scope.organizationId, scope.siteId],
      ),
      queryAll<PreventiveCatalog["skills"][number]>(
        `SELECT id, code, name FROM skills
         WHERE organization_id = ? ORDER BY category, name`,
        [scope.organizationId],
      ),
      queryAll<PreventiveCatalog["certifications"][number]>(
        `SELECT id, code, name FROM certifications
         WHERE organization_id = ? ORDER BY code`,
        [scope.organizationId],
      ),
      queryAll<PreventiveCatalog["parts"][number]>(
        `SELECT part.id, part.sku, part.name, part.unit,
          COALESCE(SUM(stock.on_hand - stock.reserved), 0) AS available
         FROM parts part
         INNER JOIN part_site_policies policy ON policy.part_id = part.id AND policy.site_id = ?
         LEFT JOIN stock_levels stock ON stock.part_id = part.id AND stock.site_id = ?
         WHERE part.organization_id = ? AND part.status = 'ACTIVE'
         GROUP BY part.id, part.sku, part.name, part.unit
         ORDER BY part.sku LIMIT 300`,
        [scope.siteId, scope.siteId, scope.organizationId],
      ),
    ]);
  return { assets, owners, meters, skills, certifications, parts };
}

export async function listMaintenancePlans(
  scope: TenantScope,
  filters: {
    q?: string | string[];
    status?: string | string[];
  } = {},
): Promise<MaintenancePlanListData> {
  const query = normalizeQuery(filters.q);
  const status = normalizeQuery(filters.status, 20) || "all";
  const now = new Date().toISOString();
  const upcoming = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const conditions = ["plan.organization_id = ?", "plan.site_id = ?"];
  const params: SqlValue[] = [scope.organizationId, scope.siteId];
  if (status === "active" || status === "inactive") {
    conditions.push("plan.status = ?");
    params.push(status.toUpperCase());
  } else if (status === "due") {
    conditions.push(
      "plan.status = 'ACTIVE' AND (plan.next_due_at <= ? OR (meter.last_value IS NOT NULL AND plan.meter_threshold IS NOT NULL AND meter.last_value >= plan.meter_threshold))",
    );
    params.push(now);
  } else if (status === "upcoming") {
    conditions.push(
      "plan.status = 'ACTIVE' AND plan.next_due_at > ? AND plan.next_due_at <= ?",
    );
    params.push(now, upcoming);
  }
  if (query) {
    const like = `%${query}%`;
    conditions.push(
      "(plan.code LIKE ? OR plan.title LIKE ? OR asset.code LIKE ? OR asset.name LIKE ?)",
    );
    params.push(like, like, like, like);
  }

  const [items, counts, occurrences, catalog] = await Promise.all([
    queryAll<MaintenancePlanListItem>(
      `SELECT plan.id, plan.code, plan.title, plan.description, plan.status,
        plan.trigger_mode AS triggerMode, plan.calendar_unit AS calendarUnit,
        plan.calendar_interval AS calendarInterval, plan.next_due_at AS nextDueAt,
        plan.meter_threshold AS meterThreshold, plan.estimated_minutes AS estimatedMinutes,
        plan.criticality, plan.priority, asset.code AS assetCode, asset.name AS assetName,
        location.name AS locationName, owner.full_name AS ownerName,
        meter.code AS meterCode, meter.unit AS meterUnit, meter.last_value AS meterValue,
        (SELECT COUNT(*) FROM work_orders wo WHERE wo.maintenance_plan_id = plan.id) AS generatedCount,
        (SELECT COUNT(*) FROM work_orders wo WHERE wo.maintenance_plan_id = plan.id
          AND wo.status NOT IN ('COMPLETED','CLOSED','CANCELLED')) AS openGeneratedCount
       FROM maintenance_plans plan
       INNER JOIN assets asset ON asset.id = plan.asset_id
       INNER JOIN functional_locations location ON location.id = plan.functional_location_id
       INNER JOIN users owner ON owner.id = plan.owner_id
       LEFT JOIN meters meter ON meter.id = plan.meter_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY CASE plan.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,
         CASE WHEN plan.next_due_at <= ? THEN 0 ELSE 1 END,
         plan.next_due_at, plan.code`,
      [...params, now],
    ),
    queryFirst<{
      active: number;
      due: number;
      upcoming: number;
      inactive: number;
    }>(
      `SELECT
        SUM(CASE WHEN plan.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN plan.status = 'ACTIVE' AND (plan.next_due_at <= ? OR
          (meter.last_value IS NOT NULL AND plan.meter_threshold IS NOT NULL AND meter.last_value >= plan.meter_threshold)) THEN 1 ELSE 0 END) AS due,
        SUM(CASE WHEN plan.status = 'ACTIVE' AND plan.next_due_at > ? AND plan.next_due_at <= ? THEN 1 ELSE 0 END) AS upcoming,
        SUM(CASE WHEN plan.status = 'INACTIVE' THEN 1 ELSE 0 END) AS inactive
       FROM maintenance_plans plan
       LEFT JOIN meters meter ON meter.id = plan.meter_id
       WHERE plan.organization_id = ? AND plan.site_id = ?`,
      [now, now, upcoming, scope.organizationId, scope.siteId],
    ),
    queryAll<{ dueAt: string; completedAt: string | null; status: string }>(
      `SELECT COALESCE(preventive_due_at, due_at) AS dueAt,
        completed_at AS completedAt, status
       FROM work_orders
       WHERE organization_id = ? AND site_id = ?
         AND maintenance_plan_id IS NOT NULL
         AND COALESCE(preventive_due_at, due_at) IS NOT NULL`,
      [scope.organizationId, scope.siteId],
    ),
    getPreventiveCatalog(scope),
  ]);
  return {
    items,
    counts: {
      active: Number(counts?.active ?? 0),
      due: Number(counts?.due ?? 0),
      upcoming: Number(counts?.upcoming ?? 0),
      inactive: Number(counts?.inactive ?? 0),
    },
    compliance: calculatePmCompliance(occurrences, now),
    catalog,
    query,
    status,
  };
}

export type MaintenancePlanDetailData = {
  plan: MaintenancePlanListItem & {
    assetId: string;
    locationId: string;
    ownerId: string;
    meterId: string | null;
    calendarAnchorAt: string | null;
    calendarNextAt: string | null;
    meterInterval: number | null;
    leadDays: number;
    lastExecutedAt: string | null;
    lastGeneratedAt: string | null;
    version: number;
  };
  tasks: Array<{
    id: string;
    sequence: number;
    title: string;
    description: string | null;
    required: number;
  }>;
  skills: Array<{
    id: string;
    code: string;
    name: string;
    minimumLevel: number;
  }>;
  certifications: Array<{ id: string; code: string; name: string }>;
  materials: Array<{
    id: string;
    partId: string;
    sku: string;
    name: string;
    unit: string;
    quantity: number;
    available: number;
  }>;
  readings: Array<{
    id: string;
    value: number;
    recordedAt: string;
    source: string;
    note: string | null;
    recordedBy: string;
  }>;
  workOrders: Array<{
    id: string;
    number: string;
    status: string;
    priority: string;
    dueAt: string | null;
    plannedStart: string | null;
    completedAt: string | null;
    assigneeName: string | null;
  }>;
  catalog: PreventiveCatalog;
};

export async function getMaintenancePlanDetail(
  scope: TenantScope,
  code: string,
): Promise<MaintenancePlanDetailData | null> {
  const plan = await queryFirst<MaintenancePlanDetailData["plan"]>(
    `SELECT plan.id, plan.code, plan.title, plan.description, plan.status,
      plan.asset_id AS assetId, plan.functional_location_id AS locationId,
      plan.owner_id AS ownerId, plan.meter_id AS meterId,
      plan.trigger_mode AS triggerMode, plan.calendar_unit AS calendarUnit,
      plan.calendar_interval AS calendarInterval,
      plan.calendar_anchor_at AS calendarAnchorAt,
      plan.calendar_next_at AS calendarNextAt,
      plan.next_due_at AS nextDueAt, plan.meter_interval AS meterInterval,
      plan.meter_threshold AS meterThreshold, plan.estimated_minutes AS estimatedMinutes,
      plan.criticality, plan.priority, plan.lead_days AS leadDays,
      plan.last_executed_at AS lastExecutedAt,
      plan.last_generated_at AS lastGeneratedAt, plan.version,
      asset.code AS assetCode, asset.name AS assetName,
      location.name AS locationName, owner.full_name AS ownerName,
      meter.code AS meterCode, meter.unit AS meterUnit, meter.last_value AS meterValue,
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.maintenance_plan_id = plan.id) AS generatedCount,
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.maintenance_plan_id = plan.id
        AND wo.status NOT IN ('COMPLETED','CLOSED','CANCELLED')) AS openGeneratedCount
     FROM maintenance_plans plan
     INNER JOIN assets asset ON asset.id = plan.asset_id
     INNER JOIN functional_locations location ON location.id = plan.functional_location_id
     INNER JOIN users owner ON owner.id = plan.owner_id
     LEFT JOIN meters meter ON meter.id = plan.meter_id
     WHERE plan.organization_id = ? AND plan.site_id = ? AND plan.code = ? LIMIT 1`,
    [scope.organizationId, scope.siteId, code],
  );
  if (!plan) return null;
  const [
    tasks,
    skills,
    certifications,
    materials,
    readings,
    workOrders,
    catalog,
  ] = await Promise.all([
    queryAll<MaintenancePlanDetailData["tasks"][number]>(
      `SELECT id, sequence, title, description, required
         FROM maintenance_plan_tasks WHERE maintenance_plan_id = ? ORDER BY sequence`,
      [plan.id],
    ),
    queryAll<MaintenancePlanDetailData["skills"][number]>(
      `SELECT skill.id, skill.code, skill.name, requirement.minimum_level AS minimumLevel
         FROM maintenance_plan_skills requirement
         INNER JOIN skills skill ON skill.id = requirement.skill_id
         WHERE requirement.maintenance_plan_id = ? ORDER BY skill.name`,
      [plan.id],
    ),
    queryAll<MaintenancePlanDetailData["certifications"][number]>(
      `SELECT certification.id, certification.code, certification.name
         FROM maintenance_plan_certifications requirement
         INNER JOIN certifications certification ON certification.id = requirement.certification_id
         WHERE requirement.maintenance_plan_id = ? ORDER BY certification.code`,
      [plan.id],
    ),
    queryAll<MaintenancePlanDetailData["materials"][number]>(
      `SELECT material.id, part.id AS partId, part.sku, part.name, part.unit,
          material.quantity,
          COALESCE(SUM(stock.on_hand - stock.reserved), 0) AS available
         FROM maintenance_plan_materials material
         INNER JOIN parts part ON part.id = material.part_id
         LEFT JOIN stock_levels stock ON stock.part_id = part.id AND stock.site_id = ?
         WHERE material.maintenance_plan_id = ?
         GROUP BY material.id, part.id, part.sku, part.name, part.unit, material.quantity
         ORDER BY part.sku`,
      [scope.siteId, plan.id],
    ),
    plan.meterId
      ? queryAll<MaintenancePlanDetailData["readings"][number]>(
          `SELECT reading.id, reading.value, reading.recorded_at AS recordedAt,
              reading.source, reading.note, user.full_name AS recordedBy
             FROM meter_readings reading
             INNER JOIN users user ON user.id = reading.recorded_by_id
             WHERE reading.meter_id = ? ORDER BY reading.recorded_at DESC LIMIT 12`,
          [plan.meterId],
        )
      : Promise.resolve([]),
    queryAll<MaintenancePlanDetailData["workOrders"][number]>(
      `SELECT wo.id, wo.number, wo.status, wo.priority,
          COALESCE(wo.preventive_due_at, wo.due_at) AS dueAt,
          wo.planned_start AS plannedStart, wo.completed_at AS completedAt,
          (SELECT user.full_name FROM work_order_assignments assignment
            INNER JOIN users user ON user.id = assignment.user_id
            WHERE assignment.work_order_id = wo.id AND assignment.unassigned_at IS NULL
            ORDER BY assignment.assigned_at LIMIT 1) AS assigneeName
         FROM work_orders wo WHERE wo.maintenance_plan_id = ?
         ORDER BY COALESCE(wo.preventive_due_at, wo.due_at) DESC LIMIT 20`,
      [plan.id],
    ),
    getPreventiveCatalog(scope),
  ]);
  return {
    plan,
    tasks,
    skills,
    certifications,
    materials,
    readings,
    workOrders,
    catalog,
  };
}
