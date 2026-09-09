type SqlValue = string | number | null;
type Operation = { sql: string; params: SqlValue[] };

const ORG = "org-mazmi-flexpack";
const LEVANTE = "site-levante";
const ALZIRA = "site-alzira";
const NOW = "2026-09-08T06:00:00.000Z";

function insert(
  table: string,
  columns: string[],
  values: SqlValue[],
): Operation {
  return {
    sql: `INSERT INTO ${table} (${columns.join(",")}) VALUES (${values.map(() => "?").join(",")}) ON CONFLICT DO NOTHING`,
    params: values,
  };
}

async function execute(db: D1Database, operations: Operation[]) {
  for (let offset = 0; offset < operations.length; offset += 50) {
    const chunk = operations.slice(offset, offset + 50);
    await db.batch(
      chunk.map((operation) =>
        db.prepare(operation.sql).bind(...operation.params),
      ),
    );
  }
}

const permissions = [
  ["incident.report", "incident", "report", "Comunicar una incidencia", 0],
  [
    "incident.triage",
    "incident",
    "triage",
    "Clasificar y convertir incidencias",
    1,
  ],
  ["workorder.create", "workorder", "create", "Crear órdenes de trabajo", 1],
  ["workorder.assign", "workorder", "assign", "Asignar y programar trabajo", 1],
  ["workorder.execute", "workorder", "execute", "Ejecutar trabajo asignado", 0],
  ["workorder.close", "workorder", "close", "Cerrar o cancelar órdenes", 1],
  ["inventory.reserve", "inventory", "reserve", "Reservar material MRO", 1],
  ["inventory.consume", "inventory", "consume", "Consumir material MRO", 1],
  ["procurement.request", "procurement", "request", "Crear requisiciones", 0],
  [
    "procurement.approve",
    "procurement",
    "approve",
    "Aprobar requisiciones y pedidos",
    1,
  ],
  [
    "procurement.receive",
    "procurement",
    "receive",
    "Recibir y transferir stock",
    1,
  ],
  [
    "preventive.manage",
    "preventive",
    "manage",
    "Gestionar mantenimiento preventivo",
    1,
  ],
  ["planning.manage", "planning", "manage", "Gestionar Planner y capacidad", 1],
  ["reliability.rca.manage", "reliability", "manage", "Gestionar RCA", 1],
  ["asset.manage", "asset", "manage", "Modificar activos", 1],
  ["audit.read", "audit", "read", "Investigar auditoría", 1],
  ["reports.read", "reports", "read", "Consultar reporting", 0],
  ["reports.export", "reports", "export", "Exportar datos gobernados", 1],
  [
    "governance.read",
    "governance",
    "read",
    "Ejecutar diagnósticos de integridad",
    1,
  ],
] as const;

const roleGrants: Record<string, string[]> = {
  ADMIN: permissions.map(([code]) => code),
  MAINTENANCE_MANAGER: permissions.map(([code]) => code),
  PLANNER: [
    "incident.report",
    "incident.triage",
    "workorder.create",
    "workorder.assign",
    "inventory.reserve",
    "procurement.request",
    "preventive.manage",
    "planning.manage",
    "reports.read",
    "reports.export",
  ],
  RELIABILITY_ENGINEER: [
    "incident.report",
    "workorder.create",
    "preventive.manage",
    "reliability.rca.manage",
    "reports.read",
    "reports.export",
  ],
  SUPERVISOR: [
    "incident.report",
    "incident.triage",
    "workorder.create",
    "workorder.assign",
    "workorder.execute",
    "inventory.reserve",
    "inventory.consume",
    "procurement.request",
    "planning.manage",
    "reports.read",
  ],
  TECHNICIAN: [
    "incident.report",
    "workorder.execute",
    "inventory.consume",
    "procurement.request",
  ],
  OPERATOR: ["incident.report"],
  WAREHOUSE: [
    "incident.report",
    "inventory.reserve",
    "inventory.consume",
    "procurement.request",
    "procurement.receive",
    "reports.read",
  ],
  PROCUREMENT: [
    "procurement.request",
    "procurement.approve",
    "procurement.receive",
    "reports.read",
    "reports.export",
  ],
  VIEWER: ["incident.report", "reports.read"],
};

export async function seedV2BDatabase(db: D1Database): Promise<void> {
  const seeded = await db
    .prepare("SELECT value FROM system_state WHERE key = 'demo_seed_v2b_2'")
    .first<{ value: string }>();
  if (seeded?.value === "complete") return;

  const operations: Operation[] = [];
  for (const [key, name, description, rank] of [
    ["ADMIN", "Administrador", "Gobierno de plataforma y seguridad", 1],
    ["OPERATOR", "Operario", "Comunicación rápida de incidencias", 70],
    ["PROCUREMENT", "Compras", "Sourcing, pedidos y control de suministro", 65],
  ] as const) {
    operations.push(
      insert(
        "roles",
        ["key", "name", "description", "rank"],
        [key, name, description, rank],
      ),
    );
  }

  const newUsers = [
    [
      "user-admin",
      "admin@mazmi.demo",
      "Elena Serra",
      "ES",
      "Administradora de Plataforma",
      "graphite",
      "ADMIN",
    ],
    [
      "user-operator",
      "operario@mazmi.demo",
      "Pau Ribes",
      "PR",
      "Operario de Impresión",
      "lime",
      "OPERATOR",
    ],
    [
      "user-procurement",
      "compras@mazmi.demo",
      "Marina Esteve",
      "ME",
      "Técnica de Compras",
      "copper",
      "PROCUREMENT",
    ],
  ] as const;
  for (const [id, email, name, initials, title, color, role] of newUsers) {
    operations.push({
      sql: `INSERT INTO users (id,email,full_name,initials,job_title,avatar_color,password_hash,password_salt,status,last_login_at,created_at,updated_at,auth_provider,failed_login_count,locked_until)
        SELECT ?,?,?,?,?,?,password_hash,password_salt,'ACTIVE',NULL,?,?,'LOCAL',0,NULL FROM users WHERE id = 'user-manager' ON CONFLICT DO NOTHING`,
      params: [id, email, name, initials, title, color, NOW, NOW],
    });
    operations.push(
      insert(
        "memberships",
        [
          "id",
          "organization_id",
          "user_id",
          "role_key",
          "default_site_id",
          "status",
          "created_at",
          "updated_at",
        ],
        [`membership-${id}`, ORG, id, role, LEVANTE, "ACTIVE", NOW, NOW],
      ),
    );
  }

  for (const [code, domain, action, description, sensitive] of permissions) {
    operations.push(
      insert(
        "permission_definitions",
        ["code", "domain", "action", "description", "sensitive"],
        [code, domain, action, description, sensitive],
      ),
    );
  }
  for (const [role, grants] of Object.entries(roleGrants)) {
    for (const grant of grants) {
      operations.push(
        insert(
          "role_permissions",
          ["role_key", "permission_code", "created_at"],
          [role, grant, NOW],
        ),
      );
    }
  }

  const memberships = await db
    .prepare(
      "SELECT id, user_id AS userId, role_key AS roleKey FROM memberships WHERE organization_id = ?",
    )
    .bind(ORG)
    .all<{ id: string; userId: string; roleKey: string }>();
  const membershipRows = [...(memberships.results ?? [])];
  for (const [id, , , , , , roleKey] of newUsers) {
    const userId = id;
    if (!membershipRows.some((membership) => membership.userId === userId)) {
      membershipRows.push({
        id: `membership-${userId}`,
        userId,
        roleKey,
      });
    }
  }
  for (const membership of membershipRows) {
    const sites = ["TECHNICIAN", "OPERATOR", "WAREHOUSE"].includes(
      membership.roleKey,
    )
      ? [LEVANTE]
      : [LEVANTE, ALZIRA];
    for (const siteId of sites) {
      const scopeId = `scope-${membership.userId}-${siteId}`;
      const limitedArea =
        membership.userId === "user-tech-4" ||
        membership.roleKey === "OPERATOR";
      const limitedWarehouse = membership.roleKey === "WAREHOUSE";
      operations.push(
        insert(
          "membership_site_scopes",
          [
            "id",
            "membership_id",
            "site_id",
            "full_area_access",
            "full_warehouse_access",
            "created_at",
          ],
          [
            scopeId,
            membership.id,
            siteId,
            limitedArea ? 0 : 1,
            limitedWarehouse ? 0 : 1,
            NOW,
          ],
        ),
      );
      if (limitedArea) {
        operations.push(
          insert(
            "membership_area_scopes",
            [
              "id",
              "membership_site_scope_id",
              "functional_location_id",
              "created_at",
            ],
            [
              `area-scope-${membership.userId}`,
              scopeId,
              membership.roleKey === "OPERATOR"
                ? "loc-lev-print"
                : "loc-lev-lam",
              NOW,
            ],
          ),
        );
      }
      if (limitedWarehouse) {
        operations.push(
          insert(
            "membership_warehouse_scopes",
            ["id", "membership_site_scope_id", "warehouse_id", "created_at"],
            [
              `warehouse-scope-${membership.userId}`,
              scopeId,
              "warehouse-lev-mro",
              NOW,
            ],
          ),
        );
      }
    }
  }

  operations.push(
    insert(
      "authentication_policies",
      [
        "organization_id",
        "session_hours",
        "idle_minutes",
        "absolute_hours",
        "rotation_minutes",
        "max_failed_attempts",
        "lockout_minutes",
        "updated_at",
      ],
      [ORG, 12, 120, 24, 60, 5, 15, NOW],
    ),
  );

  for (const [id, siteId, name] of [
    ["calendar-levante", LEVANTE, "Calendario productivo Levante"],
    ["calendar-alzira", ALZIRA, "Calendario productivo Alzira"],
  ] as const) {
    operations.push(
      insert(
        "production_calendars",
        [
          "id",
          "organization_id",
          "site_id",
          "functional_location_id",
          "name",
          "timezone",
          "status",
          "created_at",
          "updated_at",
        ],
        [id, ORG, siteId, null, name, "Europe/Madrid", "ACTIVE", NOW, NOW],
      ),
    );
    for (let day = 1; day <= 5; day += 1) {
      operations.push(
        insert(
          "production_calendar_windows",
          [
            "id",
            "calendar_id",
            "day_of_week",
            "start_minute",
            "end_minute",
            "kind",
            "capacity_percent",
            "label",
          ],
          [
            `${id}-d${day}`,
            id,
            day,
            360,
            siteId === LEVANTE ? 1320 : 840,
            "PRODUCTION",
            100,
            siteId === LEVANTE ? "Dos turnos productivos" : "Turno productivo",
          ],
        ),
      );
    }
  }
  operations.push(
    insert(
      "production_calendar_exceptions",
      [
        "id",
        "calendar_id",
        "date",
        "kind",
        "start_minute",
        "end_minute",
        "capacity_percent",
        "reason",
      ],
      [
        "calendar-exception-lev-stop",
        "calendar-levante",
        "2026-09-10",
        "PLANNED_STOP",
        720,
        840,
        0,
        "Ventana coordinada de mantenimiento",
      ],
    ),
    insert(
      "production_calendar_exceptions",
      [
        "id",
        "calendar_id",
        "date",
        "kind",
        "start_minute",
        "end_minute",
        "capacity_percent",
        "reason",
      ],
      [
        "calendar-exception-alz-holiday",
        "calendar-alzira",
        "2026-10-09",
        "HOLIDAY",
        null,
        null,
        0,
        "Festivo autonómico",
      ],
    ),
  );

  const shifts = [
    [
      "shift-lev-m1",
      LEVANTE,
      "M1",
      "Mañana",
      "Equipo Mantenimiento A",
      360,
      840,
      "1,2,3,4,5",
      480,
    ],
    [
      "shift-lev-t1",
      LEVANTE,
      "T1",
      "Tarde",
      "Equipo Mantenimiento B",
      840,
      1320,
      "1,2,3,4,5",
      480,
    ],
    [
      "shift-alz-m1",
      ALZIRA,
      "A1",
      "Mañana Alzira",
      "Equipo Técnico Alzira",
      360,
      840,
      "1,2,3,4,5",
      480,
    ],
  ] as const;
  for (const row of shifts)
    operations.push(
      insert(
        "work_shifts",
        [
          "id",
          "organization_id",
          "site_id",
          "code",
          "name",
          "team",
          "start_minute",
          "end_minute",
          "days_mask",
          "capacity_minutes",
          "status",
          "created_at",
          "updated_at",
        ],
        [row[0], ORG, ...row.slice(1), "ACTIVE", NOW, NOW],
      ),
    );
  for (const [userId, shiftId, capacity] of [
    ["user-tech-1", "shift-lev-m1", 480],
    ["user-tech-2", "shift-lev-m1", 480],
    ["user-tech-4", "shift-lev-m1", 420],
    ["user-tech-3", "shift-lev-t1", 480],
    ["user-tech-6", "shift-lev-t1", 420],
    ["user-tech-5", "shift-alz-m1", 480],
  ] as const) {
    operations.push(
      insert(
        "shift_assignments",
        [
          "id",
          "shift_id",
          "user_id",
          "effective_from",
          "effective_to",
          "capacity_minutes_override",
          "created_at",
        ],
        [
          `shift-assignment-${userId}`,
          shiftId,
          userId,
          "2026-01-01",
          null,
          capacity,
          NOW,
        ],
      ),
    );
  }
  operations.push(
    insert(
      "workforce_absences",
      [
        "id",
        "organization_id",
        "site_id",
        "user_id",
        "starts_at",
        "ends_at",
        "kind",
        "note",
        "created_at",
      ],
      [
        "absence-tech-2-training",
        ORG,
        LEVANTE,
        "user-tech-2",
        "2026-09-11T06:00:00.000Z",
        "2026-09-11T12:00:00.000Z",
        "TRAINING",
        "Recertificación ATEX",
        NOW,
      ],
    ),
  );

  for (const [id, userId, roleKey, rate] of [
    ["rate-tech-1", "user-tech-1", "TECHNICIAN", 2850],
    ["rate-tech-2", "user-tech-2", "TECHNICIAN", 3025],
    ["rate-tech-3", "user-tech-3", "TECHNICIAN", 2940],
    ["rate-tech-4", "user-tech-4", "TECHNICIAN", 2810],
    ["rate-supervisor", null, "SUPERVISOR", 3825],
    ["rate-technician-default", null, "TECHNICIAN", 2750],
  ] as const) {
    operations.push(
      insert(
        "labor_rate_cards",
        [
          "id",
          "organization_id",
          "user_id",
          "role_key",
          "shift_id",
          "hourly_rate_cents",
          "currency",
          "effective_from",
          "effective_to",
          "created_at",
        ],
        [
          id,
          ORG,
          userId,
          roleKey,
          null,
          rate,
          "EUR",
          "2026-01-01T00:00:00.000Z",
          null,
          NOW,
        ],
      ),
    );
  }
  operations.push({
    sql: `UPDATE labor_sessions SET hourly_rate_cents_snapshot = COALESCE((SELECT hourly_rate_cents FROM labor_rate_cards rate WHERE rate.user_id = labor_sessions.user_id ORDER BY rate.effective_from DESC LIMIT 1), 2750), currency_snapshot = 'EUR' WHERE hourly_rate_cents_snapshot IS NULL`,
    params: [],
  });
  operations.push({
    sql: `UPDATE labor_sessions SET labor_cost_cents = ROUND(minutes * hourly_rate_cents_snapshot / 60.0) WHERE ended_at IS NOT NULL AND labor_cost_cents IS NULL`,
    params: [],
  });
  operations.push(
    insert(
      "work_order_cost_items",
      [
        "id",
        "organization_id",
        "site_id",
        "work_order_id",
        "kind",
        "description",
        "amount_cents",
        "currency",
        "vendor_id",
        "recorded_by_id",
        "recorded_at",
      ],
      [
        "cost-v2b-external-lm02",
        ORG,
        LEVANTE,
        "wo-v2a-field",
        "EXTERNAL_VENDOR",
        "Equilibrado dinámico especializado",
        18500,
        "EUR",
        "vendor-rodatec",
        "user-manager",
        "2026-09-07T12:45:00.000Z",
      ],
    ),
  );

  operations.push(
    insert(
      "saved_views",
      [
        "id",
        "organization_id",
        "user_id",
        "site_id",
        "resource",
        "name",
        "filters_json",
        "is_default",
        "created_at",
        "updated_at",
      ],
      [
        "view-manager-priority",
        ORG,
        "user-manager",
        LEVANTE,
        "work-orders",
        "P1/P2 abiertas",
        '{"priority":["P1_EMERGENCY","P2_URGENT"],"open":true}',
        1,
        NOW,
        NOW,
      ],
    ),
    insert(
      "saved_views",
      [
        "id",
        "organization_id",
        "user_id",
        "site_id",
        "resource",
        "name",
        "filters_json",
        "is_default",
        "created_at",
        "updated_at",
      ],
      [
        "view-warehouse-critical",
        ORG,
        "user-warehouse",
        LEVANTE,
        "inventory",
        "Stock crítico",
        '{"critical":true,"risk":true}',
        1,
        NOW,
        NOW,
      ],
    ),
    insert(
      "audit_entries",
      [
        "id",
        "organization_id",
        "site_id",
        "actor_id",
        "action",
        "entity_type",
        "entity_id",
        "previous_value",
        "new_value",
        "request_id",
        "context_json",
        "outcome",
        "error_code",
        "created_at",
      ],
      [
        "audit-v2b-scope-policy",
        ORG,
        LEVANTE,
        "user-admin",
        "ACCESS_SCOPE_CONFIGURED",
        "MEMBERSHIP",
        "membership-user-tech-4",
        null,
        '{"areas":["loc-lev-lm"]}',
        "seed-v2b",
        '{"source":"governance","reason":"least-privilege demo"}',
        "SUCCESS",
        null,
        NOW,
      ],
    ),
  );
  operations.push({
    sql: "INSERT INTO system_state (key,value,updated_at) VALUES ('demo_seed_v2b_2','complete',?) ON CONFLICT(key) DO UPDATE SET value = 'complete', updated_at = excluded.updated_at",
    params: [NOW],
  });
  await execute(db, operations);
}
