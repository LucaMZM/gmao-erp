import { scopedQueries } from "./scoped-queries";
import { normalizeScanCode } from "@/lib/domain/field";
import type { TenantScope } from "./shared";
import { locationScopePredicate } from "./shared";
import { getWorkOrderDetail, type WorkOrderDetailData } from "./work-orders";

const FIELD_OPEN_STATES =
  "('APPROVED','PLANNED','SCHEDULED','ASSIGNED','IN_PROGRESS','PAUSED','WAITING_PART','WAITING_VENDOR')";

export type MyWorkItem = {
  id: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  assetCode: string;
  assetName: string;
  locationName: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  dueAt: string | null;
  estimatedMinutes: number;
  activeLaborId: string | null;
  laborStartedAt: string | null;
  requiredTasks: number;
  completedTasks: number;
  safetyLevel: string;
  isolationRequired: number;
};

export type MyWorkData = {
  profile: {
    shiftCode: string;
    shiftStart: string;
    shiftEnd: string;
    availabilityStatus: string;
  } | null;
  current: MyWorkItem | null;
  today: MyWorkItem[];
  upcoming: MyWorkItem[];
  waiting: MyWorkItem[];
  recent: MyWorkItem[];
  urgent: MyWorkItem[];
  handovers: Array<{
    id: string;
    fromShift: string;
    toShift: string;
    summary: string;
    risks: string | null;
    partsPending: string | null;
    createdAt: string;
    authorName: string;
    workOrders: string | null;
  }>;
};

export async function getMyWork(
  scope: TenantScope,
  userId: string,
): Promise<MyWorkData> {
  const { queryAll, queryFirst } = scopedQueries(scope);
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const nextWeek = new Date(new Date(now).getTime() + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const baseSelect = `SELECT work_order.id, work_order.number,
      work_order.title, work_order.status, work_order.priority, work_order.type,
      asset.code AS assetCode, asset.name AS assetName,
      location.name AS locationName, work_order.planned_start AS plannedStart,
      work_order.planned_end AS plannedEnd, work_order.due_at AS dueAt,
      work_order.estimated_minutes AS estimatedMinutes,
      (SELECT labor.id FROM labor_sessions labor
        WHERE labor.work_order_id = work_order.id AND labor.user_id = ?
          AND labor.ended_at IS NULL LIMIT 1) AS activeLaborId,
      (SELECT labor.started_at FROM labor_sessions labor
        WHERE labor.work_order_id = work_order.id AND labor.user_id = ?
          AND labor.ended_at IS NULL LIMIT 1) AS laborStartedAt,
      (SELECT COUNT(*) FROM work_order_tasks task
        WHERE task.work_order_id = work_order.id AND task.required = 1) AS requiredTasks,
      (SELECT COUNT(*) FROM work_order_tasks task
        WHERE task.work_order_id = work_order.id AND task.required = 1
          AND task.response_status IN ('COMPLETED','PASS')) AS completedTasks,
      work_order.safety_level AS safetyLevel,
      work_order.isolation_required AS isolationRequired
    FROM scope_work_orders work_order
    INNER JOIN scope_assets asset ON asset.id = work_order.asset_id
    INNER JOIN functional_locations location
      ON location.id = work_order.functional_location_id
    INNER JOIN work_order_assignments assignment
      ON assignment.work_order_id = work_order.id AND assignment.user_id = ?
      AND assignment.unassigned_at IS NULL
    WHERE work_order.organization_id = ? AND work_order.site_id = ?`;
  const params = [userId, userId, userId, scope.organizationId, scope.siteId];
  const [
    profile,
    current,
    todayItems,
    upcoming,
    waiting,
    recent,
    urgent,
    handovers,
  ] = await Promise.all([
    queryFirst<MyWorkData["profile"]>(
      `SELECT shift_code AS shiftCode, shift_start AS shiftStart,
          shift_end AS shiftEnd, availability_status AS availabilityStatus
         FROM workforce_profiles WHERE organization_id = ? AND site_id = ?
           AND user_id = ? LIMIT 1`,
      [scope.organizationId, scope.siteId, userId],
    ),
    queryFirst<MyWorkItem>(
      `${baseSelect} AND EXISTS (SELECT 1 FROM labor_sessions active
          WHERE active.work_order_id = work_order.id AND active.user_id = ?
            AND active.ended_at IS NULL) LIMIT 1`,
      [...params, userId],
    ),
    queryAll<MyWorkItem>(
      `${baseSelect} AND work_order.status IN ${FIELD_OPEN_STATES}
          AND ((work_order.planned_start IS NOT NULL AND work_order.planned_start <= ?)
            OR (work_order.planned_start IS NULL AND work_order.due_at <= ?))
         ORDER BY CASE work_order.priority WHEN 'P1_EMERGENCY' THEN 1
           WHEN 'P2_URGENT' THEN 2 WHEN 'P3_HIGH' THEN 3 ELSE 4 END,
           work_order.planned_start LIMIT 12`,
      [...params, `${today}T23:59:59.999Z`, `${today}T23:59:59.999Z`],
    ),
    queryAll<MyWorkItem>(
      `${baseSelect} AND work_order.status IN ${FIELD_OPEN_STATES}
          AND substr(work_order.planned_start, 1, 10) > ?
          AND substr(work_order.planned_start, 1, 10) <= ?
         ORDER BY work_order.planned_start LIMIT 12`,
      [...params, today, nextWeek],
    ),
    queryAll<MyWorkItem>(
      `${baseSelect} AND work_order.status IN ('WAITING_PART','WAITING_VENDOR')
         ORDER BY work_order.updated_at DESC LIMIT 12`,
      params,
    ),
    queryAll<MyWorkItem>(
      `${baseSelect} AND work_order.status IN ('COMPLETED','CLOSED')
         ORDER BY COALESCE(work_order.completed_at, work_order.closed_at) DESC LIMIT 8`,
      params,
    ),
    queryAll<MyWorkItem>(
      `${baseSelect} AND work_order.status IN ${FIELD_OPEN_STATES}
          AND work_order.priority IN ('P1_EMERGENCY','P2_URGENT')
         ORDER BY CASE work_order.priority WHEN 'P1_EMERGENCY' THEN 1 ELSE 2 END,
           work_order.due_at LIMIT 8`,
      params,
    ),
    queryAll<MyWorkData["handovers"][number]>(
      `SELECT handover.id, handover.from_shift AS fromShift,
          handover.to_shift AS toShift, handover.summary, handover.risks,
          handover.parts_pending AS partsPending, handover.created_at AS createdAt,
          author.full_name AS authorName,
          GROUP_CONCAT(work_order.number, ', ') AS workOrders
         FROM scope_shift_handovers handover
         INNER JOIN users author ON author.id = handover.author_id
         LEFT JOIN shift_handover_work_orders link ON link.handover_id = handover.id
         LEFT JOIN scope_work_orders work_order ON work_order.id = link.work_order_id
         WHERE handover.organization_id = ? AND handover.site_id = ?
           AND handover.to_shift = COALESCE((SELECT shift_code FROM workforce_profiles
             WHERE user_id = ? AND site_id = ? LIMIT 1), handover.to_shift)
         GROUP BY handover.id ORDER BY handover.created_at DESC LIMIT 5`,
      [scope.organizationId, scope.siteId, userId, scope.siteId],
    ),
  ]);
  return {
    profile,
    current,
    today: todayItems,
    upcoming,
    waiting,
    recent,
    urgent,
    handovers,
  };
}

export type ScannedAsset = {
  id: string;
  scanCode: string;
  code: string;
  name: string;
  status: string;
  criticality: string;
  healthScore: number;
  locationId: string;
  locationCode: string;
  locationName: string;
  openIncidents: number;
  activeWorkOrders: number;
  nextPmAt: string | null;
  criticalSpares: Array<{
    id: string;
    sku: string;
    name: string;
    available: number;
  }>;
  recentWorkOrders: Array<{
    number: string;
    title: string;
    status: string;
    requestedAt: string;
  }>;
};

export async function getAssetByScanCode(
  scope: TenantScope,
  value: string,
): Promise<ScannedAsset | null> {
  const { queryAll, queryFirst } = scopedQueries(scope);
  const scanCode = normalizeScanCode(value);
  const locationScope = locationScopePredicate(
    scope,
    "asset.functional_location_id",
  );
  const asset = await queryFirst<Omit<ScannedAsset, "criticalSpares">>(
    `SELECT asset.id, asset.scan_code AS scanCode, asset.code, asset.name,
      asset.status, asset.criticality, asset.health_score AS healthScore,
      location.id AS locationId,
      location.code AS locationCode, location.name AS locationName,
      (SELECT COUNT(*) FROM scope_incidents incident WHERE incident.asset_id = asset.id
        AND incident.site_id = ? AND incident.status IN ('NEW','TRIAGE','ACCEPTED')) AS openIncidents,
      (SELECT COUNT(*) FROM scope_work_orders work_order WHERE work_order.asset_id = asset.id
        AND work_order.site_id = ? AND work_order.status IN ${FIELD_OPEN_STATES}) AS activeWorkOrders,
      asset.next_pm_at AS nextPmAt
     FROM scope_assets asset
     INNER JOIN functional_locations location
       ON location.id = asset.functional_location_id
     WHERE asset.organization_id = ? AND asset.site_id = ?
       AND (asset.scan_code = ? OR asset.code = ?)
       AND ${locationScope.sql} LIMIT 1`,
    [
      scope.siteId,
      scope.siteId,
      scope.organizationId,
      scope.siteId,
      scanCode,
      scanCode,
      ...locationScope.params,
    ],
  );
  if (!asset) return null;
  const [criticalSpares, recentWorkOrders] = await Promise.all([
    queryAll<ScannedAsset["criticalSpares"][number]>(
      `SELECT part.id, part.sku, part.name,
      COALESCE(SUM(stock.on_hand - stock.reserved), 0) AS available
     FROM asset_part_compatibilities compatibility
     INNER JOIN parts part ON part.id = compatibility.part_id
     INNER JOIN part_site_policies policy ON policy.part_id = part.id
       AND policy.site_id = ? AND policy.critical = 1
     LEFT JOIN scope_stock_levels stock ON stock.part_id = part.id AND stock.site_id = ?
     WHERE compatibility.asset_id = ?
     GROUP BY part.id ORDER BY available ASC, part.sku LIMIT 4`,
      [scope.siteId, scope.siteId, asset.id],
    ),
    queryAll<ScannedAsset["recentWorkOrders"][number]>(
      `SELECT number, title, status, requested_at AS requestedAt
       FROM scope_work_orders WHERE organization_id = ? AND site_id = ?
         AND asset_id = ? ORDER BY requested_at DESC LIMIT 5`,
      [scope.organizationId, scope.siteId, asset.id],
    ),
  ]);
  return { ...asset, criticalSpares, recentWorkOrders };
}

export type FieldWorkOrderData = WorkOrderDetailData & {
  measurements: Array<{
    id: string;
    label: string;
    unit: string;
    value: number;
    result: string;
    note: string | null;
    recordedAt: string;
    recordedBy: string;
  }>;
  evidence: Array<{
    id: string;
    kind: string;
    stage: string;
    description: string;
    fileName: string | null;
    contentType: string | null;
    createdAt: string;
    authorName: string;
    contentHref: string | null;
  }>;
  safetyAcknowledged: boolean;
  availableMeters: Array<{
    id: string;
    code: string;
    name: string;
    unit: string;
    readingType: string;
    lastValue: number | null;
  }>;
};

export async function getFieldWorkOrder(
  scope: TenantScope,
  userId: string,
  roleKey: string,
  number: string,
): Promise<FieldWorkOrderData | null> {
  const { queryAll, queryFirst } = scopedQueries(scope);
  const detail = await getWorkOrderDetail(scope, number);
  if (!detail) return null;
  if (roleKey === "TECHNICIAN") {
    const assigned = detail.assignments.some((item) => item.userId === userId);
    if (!assigned) return null;
  }
  const [measurements, evidence, acknowledgement, availableMeters] =
    await Promise.all([
      queryAll<FieldWorkOrderData["measurements"][number]>(
        `SELECT measurement.id, measurement.label, measurement.unit,
          measurement.value, measurement.result, measurement.note,
          measurement.recorded_at AS recordedAt,
          user.full_name AS recordedBy
         FROM work_order_measurements measurement
         INNER JOIN users user ON user.id = measurement.recorded_by_id
         WHERE measurement.work_order_id = ? AND measurement.site_id = ?
         ORDER BY measurement.recorded_at DESC`,
        [detail.order.id, scope.siteId],
      ),
      queryAll<FieldWorkOrderData["evidence"][number]>(
        `SELECT evidence.id, evidence.kind, evidence.stage,
          evidence.description, evidence.file_name AS fileName,
          evidence.content_type AS contentType,
          evidence.created_at AS createdAt, user.full_name AS authorName,
          CASE WHEN evidence.storage_provider = 'R2'
            THEN '/api/field/evidence/' || evidence.id || '/content'
            ELSE NULL END AS contentHref
         FROM evidence_items evidence
         INNER JOIN users user ON user.id = evidence.author_id
         WHERE evidence.work_order_id = ? AND evidence.organization_id = ?
           AND evidence.site_id = ? ORDER BY evidence.created_at DESC`,
        [detail.order.id, scope.organizationId, scope.siteId],
      ),
      queryFirst<{ id: string }>(
        `SELECT id FROM work_order_safety_acknowledgements
         WHERE work_order_id = ? AND user_id = ? LIMIT 1`,
        [detail.order.id, userId],
      ),
      queryAll<FieldWorkOrderData["availableMeters"][number]>(
        `SELECT id, code, name, unit, reading_type AS readingType,
          last_value AS lastValue FROM scope_meters
         WHERE asset_id = ? AND organization_id = ? AND site_id = ?
           AND status = 'ACTIVE' ORDER BY code`,
        [detail.order.assetId, scope.organizationId, scope.siteId],
      ),
    ]);
  return {
    ...detail,
    measurements,
    evidence,
    safetyAcknowledged: Boolean(acknowledgement),
    availableMeters,
  };
}

export async function getActiveFieldTechnicians(scope: TenantScope) {
  const { queryAll } = scopedQueries(scope);
  return queryAll<{
    userId: string;
    fullName: string;
    initials: string;
    workOrderNumber: string;
    workOrderTitle: string;
    status: string;
    startedAt: string | null;
    requiredTasks: number;
    completedTasks: number;
  }>(
    `SELECT user.id AS userId, user.full_name AS fullName, user.initials,
      work_order.number AS workOrderNumber, work_order.title AS workOrderTitle,
      work_order.status, labor.started_at AS startedAt,
      (SELECT COUNT(*) FROM work_order_tasks task
        WHERE task.work_order_id = work_order.id AND task.required = 1) AS requiredTasks,
      (SELECT COUNT(*) FROM work_order_tasks task
        WHERE task.work_order_id = work_order.id AND task.required = 1
          AND task.response_status IN ('COMPLETED','PASS')) AS completedTasks
     FROM labor_sessions labor
     INNER JOIN users user ON user.id = labor.user_id
     INNER JOIN scope_work_orders work_order ON work_order.id = labor.work_order_id
     WHERE work_order.organization_id = ? AND work_order.site_id = ?
       AND labor.ended_at IS NULL
     ORDER BY labor.started_at`,
    [scope.organizationId, scope.siteId],
  );
}
