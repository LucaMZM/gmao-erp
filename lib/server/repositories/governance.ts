import {
  productiveExposureMinutes,
  type CalendarException,
  type CalendarWindow,
} from "@/lib/domain/production-calendar";
import type { DemoUserSession } from "@/lib/server/auth";
import { queryAll, queryFirst } from "./shared";
import { tenantScope } from "./shared";
import { scopedQueries } from "./scoped-queries";

export async function getProductionExposure(
  siteId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const windows = await queryAll<CalendarWindow>(
    `SELECT window.day_of_week AS dayOfWeek, window.start_minute AS startMinute,
      window.end_minute AS endMinute, window.capacity_percent AS capacityPercent,
      window.kind
     FROM production_calendar_windows window
     INNER JOIN production_calendars calendar ON calendar.id = window.calendar_id
     WHERE calendar.site_id = ? AND calendar.functional_location_id IS NULL
       AND calendar.status = 'ACTIVE'`,
    [siteId],
  );
  const exceptions = await queryAll<CalendarException>(
    `SELECT exception.date, exception.start_minute AS startMinute,
      exception.end_minute AS endMinute,
      exception.capacity_percent AS capacityPercent, exception.kind
     FROM production_calendar_exceptions exception
     INNER JOIN production_calendars calendar ON calendar.id = exception.calendar_id
     WHERE calendar.site_id = ? AND exception.date BETWEEN ? AND ?`,
    [siteId, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)],
  );
  return productiveExposureMinutes(from, to, windows, exceptions);
}

export type GovernanceData = {
  integrity: Array<{
    code: string;
    title: string;
    severity: "CRITICAL" | "WARNING";
    count: number;
    guidance: string;
  }>;
  calendars: Array<{
    id: string;
    name: string;
    status: string;
    weeklyMinutes: number;
    exceptions: number;
  }>;
  shifts: Array<{
    code: string;
    name: string;
    team: string;
    startMinute: number;
    endMinute: number;
    capacityMinutes: number;
    assigned: number;
  }>;
  scopes: Array<{
    userName: string;
    roleName: string;
    fullAreaAccess: number;
    fullWarehouseAccess: number;
    areas: string;
    warehouses: string;
  }>;
};

export async function getGovernanceData(
  session: DemoUserSession,
): Promise<GovernanceData> {
  const checks = [
    {
      code: "STOCK_BALANCE",
      title: "Balances de stock inconsistentes",
      severity: "CRITICAL" as const,
      guidance:
        "Revisar ledger y reservas antes de cualquier ajuste explícito.",
      sql: "SELECT COUNT(*) AS count FROM stock_levels WHERE site_id = ? AND (on_hand < 0 OR reserved < 0 OR reserved > on_hand OR on_order < 0)",
    },
    {
      code: "ACTIVE_LABOR",
      title: "Sesiones laborales imposibles",
      severity: "CRITICAL" as const,
      guidance: "Cerrar la sesión desde la OT conservando su trazabilidad.",
      sql: `SELECT COUNT(*) AS count FROM labor_sessions labor
        INNER JOIN work_orders work_order ON work_order.id = labor.work_order_id
        WHERE work_order.site_id = ? AND labor.ended_at IS NULL
          AND work_order.status IN ('COMPLETED','CLOSED','CANCELLED')`,
    },
    {
      code: "DOWNTIME_TIME",
      title: "Downtime temporalmente inválido",
      severity: "CRITICAL" as const,
      guidance:
        "Corregir mediante la operación de downtime; no editar duración aislada.",
      sql: `SELECT COUNT(*) AS count FROM downtime_events WHERE site_id = ?
        AND (duration_minutes < 0 OR (ended_at IS NOT NULL AND ended_at < started_at))`,
    },
    {
      code: "CLOSED_ORDER",
      title: "Órdenes cerradas incoherentes",
      severity: "CRITICAL" as const,
      guidance:
        "Reabrir mediante flujo autorizado o completar los datos de cierre.",
      sql: `SELECT COUNT(*) AS count FROM work_orders WHERE site_id = ? AND status = 'CLOSED'
        AND (closed_at IS NULL OR actual_end IS NULL OR TRIM(COALESCE(solution,'')) = '')`,
    },
    {
      code: "PM_WINDOW",
      title: "Ventanas preventivas duplicadas",
      severity: "WARNING" as const,
      guidance: "Consolidar la ventana antes de volver a generar OTs.",
      sql: `SELECT COUNT(*) AS count FROM (
        SELECT maintenance_plan_id, maintenance_window_key FROM work_orders
        WHERE site_id = ? AND maintenance_plan_id IS NOT NULL
          AND maintenance_window_key IS NOT NULL
        GROUP BY maintenance_plan_id, maintenance_window_key HAVING COUNT(*) > 1)`,
    },
    {
      code: "RECEIPT_BALANCE",
      title: "Recepciones incoherentes",
      severity: "CRITICAL" as const,
      guidance: "Verificar PO, recepción y ledger antes de continuar.",
      sql: `SELECT COUNT(*) AS count FROM purchase_order_lines line
        INNER JOIN purchase_orders po ON po.id = line.purchase_order_id
        WHERE po.site_id = ? AND (line.received_quantity < 0 OR line.received_quantity > line.ordered_quantity)`,
    },
    {
      code: "SCOPE_POLICY",
      title: "Scopes sin centro válido",
      severity: "CRITICAL" as const,
      guidance: "Reasignar el centro desde gobierno de acceso.",
      sql: `SELECT COUNT(*) AS count FROM membership_site_scopes scope
        LEFT JOIN sites site ON site.id = scope.site_id
        WHERE scope.site_id = ? AND (site.id IS NULL OR site.status <> 'ACTIVE')`,
    },
  ];
  const integrity = await Promise.all(
    checks.map(async (check) => ({
      ...check,
      count: Number(
        (await queryFirst<{ count: number }>(check.sql, [session.siteId]))
          ?.count ?? 0,
      ),
    })),
  );
  const calendars = await queryAll<GovernanceData["calendars"][number]>(
    `SELECT calendar.id, calendar.name, calendar.status,
      COALESCE((SELECT SUM((window.end_minute - window.start_minute) * window.capacity_percent / 100)
        FROM production_calendar_windows window
        WHERE window.calendar_id = calendar.id AND window.kind = 'PRODUCTION'), 0) AS weeklyMinutes,
      (SELECT COUNT(*) FROM production_calendar_exceptions exception
        WHERE exception.calendar_id = calendar.id) AS exceptions
     FROM production_calendars calendar
     WHERE calendar.organization_id = ? AND calendar.site_id = ?
     ORDER BY calendar.name`,
    [session.organizationId, session.siteId],
  );
  const shifts = await queryAll<GovernanceData["shifts"][number]>(
    `SELECT shift.code, shift.name, shift.team,
      shift.start_minute AS startMinute, shift.end_minute AS endMinute,
      shift.capacity_minutes AS capacityMinutes,
      COUNT(assignment.id) AS assigned
     FROM work_shifts shift
     LEFT JOIN shift_assignments assignment ON assignment.shift_id = shift.id
       AND (assignment.effective_to IS NULL OR assignment.effective_to >= DATE('now'))
     WHERE shift.organization_id = ? AND shift.site_id = ? AND shift.status = 'ACTIVE'
     GROUP BY shift.id ORDER BY shift.start_minute`,
    [session.organizationId, session.siteId],
  );
  const scopes = await queryAll<GovernanceData["scopes"][number]>(
    `SELECT user.full_name AS userName, role.name AS roleName,
      site_scope.full_area_access AS fullAreaAccess,
      site_scope.full_warehouse_access AS fullWarehouseAccess,
      COALESCE(GROUP_CONCAT(DISTINCT area_location.name), 'Todas') AS areas,
      COALESCE(GROUP_CONCAT(DISTINCT warehouse.name), 'Todos') AS warehouses
     FROM membership_site_scopes site_scope
     INNER JOIN memberships membership ON membership.id = site_scope.membership_id
     INNER JOIN users user ON user.id = membership.user_id
     INNER JOIN roles role ON role.key = membership.role_key
     LEFT JOIN membership_area_scopes area_scope ON area_scope.membership_site_scope_id = site_scope.id
     LEFT JOIN functional_locations area_location ON area_location.id = area_scope.functional_location_id
     LEFT JOIN membership_warehouse_scopes warehouse_scope ON warehouse_scope.membership_site_scope_id = site_scope.id
     LEFT JOIN warehouses warehouse ON warehouse.id = warehouse_scope.warehouse_id
     WHERE membership.organization_id = ? AND site_scope.site_id = ?
     GROUP BY site_scope.id ORDER BY role.rank, user.full_name`,
    [session.organizationId, session.siteId],
  );
  return { integrity, calendars, shifts, scopes };
}

export type AuditFilters = {
  actor?: string;
  action?: string;
  entity?: string;
  outcome?: string;
  from?: string;
  to?: string;
};

type AuditFacet = "entity" | "outcome";

function auditClauses(
  session: DemoUserSession,
  filters: AuditFilters,
  exclude?: AuditFacet,
): { clauses: string[]; params: Array<string | number | null> } {
  const clauses = ["audit.organization_id = ?", "audit.site_id = ?"];
  const params: Array<string | number | null> = [
    session.organizationId,
    session.siteId,
  ];
  if (filters.actor) {
    clauses.push("audit.actor_id = ?");
    params.push(filters.actor);
  }
  if (filters.action) {
    clauses.push("audit.action LIKE ?");
    params.push(`%${filters.action}%`);
  }
  if (exclude !== "entity" && filters.entity) {
    clauses.push("audit.entity_type = ?");
    params.push(filters.entity);
  }
  if (exclude !== "outcome" && filters.outcome) {
    clauses.push("audit.outcome = ?");
    params.push(filters.outcome);
  }
  if (filters.from) {
    clauses.push("audit.created_at >= ?");
    params.push(`${filters.from}T00:00:00.000Z`);
  }
  if (filters.to) {
    clauses.push("audit.created_at <= ?");
    params.push(`${filters.to}T23:59:59.999Z`);
  }
  return { clauses, params };
}

export async function getAuditFacets(
  session: DemoUserSession,
  filters: AuditFilters,
) {
  const auditQuery = scopedQueries(tenantScope(session)).queryAll;
  const entity = auditClauses(session, filters, "entity");
  const outcome = auditClauses(session, filters, "outcome");
  const [entities, outcomes] = await Promise.all([
    auditQuery<{ value: string; count: number }>(
      `SELECT audit.entity_type AS value, COUNT(*) AS count
       FROM scope_audit_entries audit
       WHERE ${entity.clauses.join(" AND ")}
       GROUP BY audit.entity_type`,
      entity.params,
    ),
    auditQuery<{ value: string; count: number }>(
      `SELECT audit.outcome AS value, COUNT(*) AS count
       FROM scope_audit_entries audit
       WHERE ${outcome.clauses.join(" AND ")}
       GROUP BY audit.outcome`,
      outcome.params,
    ),
  ]);
  return { entities, outcomes };
}

export async function getAuditEntries(
  session: DemoUserSession,
  filters: AuditFilters,
) {
  const auditQuery = scopedQueries(tenantScope(session)).queryAll;
  const { clauses, params } = auditClauses(session, filters);
  return auditQuery<{
    id: string;
    actorName: string;
    action: string;
    entityType: string;
    entityId: string;
    previousValue: string | null;
    newValue: string | null;
    contextJson: string | null;
    outcome: string;
    errorCode: string | null;
    requestId: string | null;
    createdAt: string;
  }>(
    `SELECT audit.id, COALESCE(user.full_name, 'Sistema') AS actorName,
      audit.action, audit.entity_type AS entityType, audit.entity_id AS entityId,
      audit.previous_value AS previousValue, audit.new_value AS newValue,
      audit.context_json AS contextJson, audit.outcome, audit.error_code AS errorCode,
      audit.request_id AS requestId, audit.created_at AS createdAt
     FROM scope_audit_entries audit LEFT JOIN users user ON user.id = audit.actor_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY audit.created_at DESC LIMIT 200`,
    params,
  );
}
