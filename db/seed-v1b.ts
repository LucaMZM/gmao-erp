type SqlValue = string | number | null;
type Operation = { sql: string; params: SqlValue[] };

const ORGANIZATION_ID = "org-mazmi-flexpack";
const LEVANTE_ID = "site-levante";
const ALZIRA_ID = "site-alzira";
const ANCHOR = new Date("2026-09-01T06:00:00.000Z");
const NOW = ANCHOR.toISOString();

function at(dayOffset: number, hour = 8, minute = 0): string {
  const date = new Date(ANCHOR);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

function insert(
  table: string,
  columns: string[],
  values: SqlValue[],
): Operation {
  return {
    sql: `INSERT OR IGNORE INTO ${table} (${columns.join(",")}) VALUES (${values.map(() => "?").join(",")})`,
    params: values,
  };
}

async function executeInChunks(
  db: D1Database,
  operations: Operation[],
  size = 60,
): Promise<void> {
  for (let offset = 0; offset < operations.length; offset += size) {
    const chunk = operations.slice(offset, offset + size);
    await db.batch(
      chunk.map((operation) =>
        db.prepare(operation.sql).bind(...operation.params),
      ),
    );
  }
}

type PlanSeed = {
  id: string;
  siteId: string;
  assetCode: string;
  locationCode: string;
  ownerId: string;
  meterId: string | null;
  code: string;
  title: string;
  description: string;
  criticality: string;
  priority: string;
  estimatedMinutes: number;
  triggerMode: "CALENDAR" | "METER" | "WHICHEVER_FIRST";
  calendarUnit: "DAY" | "WEEK" | "MONTH" | null;
  calendarInterval: number | null;
  calendarAnchorAt: string | null;
  calendarNextAt: string | null;
  meterInterval: number | null;
  meterThreshold: number | null;
  status: "ACTIVE" | "INACTIVE";
  lastExecutedAt: string | null;
  lastGeneratedAt: string | null;
  nextDueAt: string | null;
  tasks: string[];
  skill: [string, number];
  certification?: string;
  material?: [string, number];
};

const plans: PlanSeed[] = [
  {
    id: "pm-lm01-monthly",
    siteId: LEVANTE_ID,
    assetCode: "LM-01",
    locationCode: "LM-01",
    ownerId: "user-planner",
    meterId: null,
    code: "PM-LEV-2026-001",
    title: "Inspección mensual de línea de laminación LM-01",
    description:
      "Revisión de seguridad, transmisión, guiado, rodillos y puntos de lubricación de la línea.",
    criticality: "CRITICAL",
    priority: "P3_HIGH",
    estimatedMinutes: 150,
    triggerMode: "CALENDAR",
    calendarUnit: "MONTH",
    calendarInterval: 1,
    calendarAnchorAt: at(-38, 7),
    calendarNextAt: at(24, 7),
    meterInterval: null,
    meterThreshold: null,
    status: "ACTIVE",
    lastExecutedAt: at(-7, 10, 20),
    lastGeneratedAt: at(-11, 7),
    nextDueAt: at(24, 7),
    tasks: [
      "Aplicar consignación LOTO",
      "Inspeccionar holguras y transmisión principal",
      "Lubricar apoyos y verificar rodillos",
      "Registrar anomalías y liberar equipo",
    ],
    skill: ["skill-mechanical", 3],
    certification: "cert-loto",
    material: ["part-001", 1],
  },
  {
    id: "pm-pr01-dryer",
    siteId: LEVANTE_ID,
    assetCode: "PR-01-DRY",
    locationCode: "PR-01",
    ownerId: "user-planner",
    meterId: "meter-pr01-dryer-cycles",
    code: "PM-LEV-2026-002",
    title: "Preventivo del sistema de secado PR-01",
    description:
      "Limpieza de filtros, inspección térmica y verificación de extracción del secado.",
    criticality: "CRITICAL",
    priority: "P2_URGENT",
    estimatedMinutes: 210,
    triggerMode: "WHICHEVER_FIRST",
    calendarUnit: "WEEK",
    calendarInterval: 2,
    calendarAnchorAt: at(-30, 6),
    calendarNextAt: at(-2, 6),
    meterInterval: 20_000,
    meterThreshold: 1_260_000,
    status: "ACTIVE",
    lastExecutedAt: at(-16, 10),
    lastGeneratedAt: at(-7, 6),
    nextDueAt: at(-2, 6),
    tasks: [
      "Comprobar consignación térmica y eléctrica",
      "Sustituir filtros de admisión",
      "Inspeccionar ventiladores y correas",
      "Registrar temperaturas por zona",
    ],
    skill: ["skill-electrical", 3],
    certification: "cert-loto",
    material: ["part-023", 2],
  },
  {
    id: "pm-comp02-hours",
    siteId: LEVANTE_ID,
    assetCode: "COMP-02",
    locationCode: "COMP",
    ownerId: "user-supervisor-mech",
    meterId: "meter-comp02-hours",
    code: "PM-LEV-2026-003",
    title: "Servicio 500 h compresor COMP-02",
    description:
      "Servicio periódico por horas de marcha con revisión de lubricación, filtros y fugas.",
    criticality: "CRITICAL",
    priority: "P3_HIGH",
    estimatedMinutes: 270,
    triggerMode: "METER",
    calendarUnit: null,
    calendarInterval: null,
    calendarAnchorAt: null,
    calendarNextAt: null,
    meterInterval: 500,
    meterThreshold: 12_500,
    status: "ACTIVE",
    lastExecutedAt: at(-28, 12),
    lastGeneratedAt: at(-1, 12),
    nextDueAt: at(0, 12),
    tasks: [
      "Tomar lectura de horas y presión",
      "Sustituir filtro de admisión",
      "Comprobar nivel y estado del aceite",
      "Verificar fugas y punto de rocío",
    ],
    skill: ["skill-utilities", 3],
    certification: "cert-loto",
    material: ["part-024", 1],
  },
  {
    id: "pm-sr03-cycles",
    siteId: LEVANTE_ID,
    assetCode: "SR-03-WND",
    locationCode: "SR-03",
    ownerId: "user-planner",
    meterId: "meter-sr03-cycles",
    code: "PM-LEV-2026-004",
    title: "Inspección por ciclos del rebobinado SR-03",
    description:
      "Inspección del eje expansible, freno, apoyos y sistema de centrado tras el umbral de ciclos.",
    criticality: "HIGH",
    priority: "P3_HIGH",
    estimatedMinutes: 180,
    triggerMode: "METER",
    calendarUnit: null,
    calendarInterval: null,
    calendarAnchorAt: null,
    calendarNextAt: null,
    meterInterval: 100_000,
    meterThreshold: 900_000,
    status: "ACTIVE",
    lastExecutedAt: at(-40, 12),
    lastGeneratedAt: at(-1, 7),
    nextDueAt: at(1, 7),
    tasks: [
      "Inspeccionar superficie y concentricidad del eje",
      "Comprobar apoyos, freno y presión neumática",
      "Verificar centrado y prueba funcional",
    ],
    skill: ["skill-mechanical", 3],
    material: ["part-002", 2],
  },
  {
    id: "pm-ch01-weekly",
    siteId: LEVANTE_ID,
    assetCode: "CH-01",
    locationCode: "CHILL",
    ownerId: "user-supervisor-mech",
    meterId: "meter-ch01-hours",
    code: "PM-LEV-2026-005",
    title: "Ronda semanal de chiller CH-01",
    description:
      "Comprobación operativa de presiones, temperaturas, niveles y alarmas activas.",
    criticality: "CRITICAL",
    priority: "P4_NORMAL",
    estimatedMinutes: 75,
    triggerMode: "CALENDAR",
    calendarUnit: "WEEK",
    calendarInterval: 1,
    calendarAnchorAt: at(-21, 6, 30),
    calendarNextAt: at(0, 10),
    meterInterval: null,
    meterThreshold: null,
    status: "ACTIVE",
    lastExecutedAt: at(-7, 8),
    lastGeneratedAt: at(-3, 10),
    nextDueAt: at(0, 10),
    tasks: [
      "Registrar presiones y temperaturas",
      "Comprobar niveles y fugas",
      "Revisar histórico de alarmas",
    ],
    skill: ["skill-utilities", 2],
  },
  {
    id: "pm-ct01-atex",
    siteId: LEVANTE_ID,
    assetCode: "CT-01-APP",
    locationCode: "CT-01",
    ownerId: "user-supervisor-elec",
    meterId: null,
    code: "PM-LEV-2026-006",
    title: "Inspección ATEX del cabezal aplicador CT-01",
    description:
      "Revisión planificada de puesta a tierra, protecciones y componentes en zona clasificada.",
    criticality: "CRITICAL",
    priority: "P3_HIGH",
    estimatedMinutes: 120,
    triggerMode: "CALENDAR",
    calendarUnit: "MONTH",
    calendarInterval: 3,
    calendarAnchorAt: at(-92, 7),
    calendarNextAt: at(2, 7),
    meterInterval: null,
    meterThreshold: null,
    status: "ACTIVE",
    lastExecutedAt: at(-90, 11),
    lastGeneratedAt: at(-1, 13),
    nextDueAt: at(2, 7),
    tasks: [
      "Verificar puesta a tierra y equipotencialidad",
      "Inspeccionar prensaestopas y envolventes",
      "Documentar defectos con evidencia",
    ],
    skill: ["skill-electrical", 4],
    certification: "cert-atex",
  },
  {
    id: "pm-alz-sr04",
    siteId: ALZIRA_ID,
    assetCode: "SR-04",
    locationCode: "SR-04",
    ownerId: "user-planner",
    meterId: "meter-sr04-hours",
    code: "PM-ALZ-2026-001",
    title: "Preventivo mensual slitter SR-04",
    description:
      "Revisión mecánica y de seguridad de la línea de corte del centro Alzira.",
    criticality: "HIGH",
    priority: "P4_NORMAL",
    estimatedMinutes: 150,
    triggerMode: "WHICHEVER_FIRST",
    calendarUnit: "MONTH",
    calendarInterval: 1,
    calendarAnchorAt: at(-31, 7),
    calendarNextAt: at(1, 7),
    meterInterval: 600,
    meterThreshold: 8_600,
    status: "ACTIVE",
    lastExecutedAt: at(-29, 11),
    lastGeneratedAt: at(-1, 8),
    nextDueAt: at(1, 7),
    tasks: [
      "Aplicar consignación LOTO",
      "Inspeccionar cuchillas, ejes y protecciones",
      "Realizar prueba funcional y documentar",
    ],
    skill: ["skill-mechanical", 3],
    certification: "cert-loto",
  },
  {
    id: "pm-lm02-inactive",
    siteId: LEVANTE_ID,
    assetCode: "LM-02-DRV",
    locationCode: "LM-02",
    ownerId: "user-reliability",
    meterId: null,
    code: "PM-LEV-2026-007",
    title: "Ruta de vibraciones LM-02 — borrador pausado",
    description:
      "Plan histórico desactivado mientras se revisan puntos y criterios de aceptación.",
    criticality: "HIGH",
    priority: "P4_NORMAL",
    estimatedMinutes: 90,
    triggerMode: "CALENDAR",
    calendarUnit: "WEEK",
    calendarInterval: 2,
    calendarAnchorAt: at(-14, 6),
    calendarNextAt: at(0, 6),
    meterInterval: null,
    meterThreshold: null,
    status: "INACTIVE",
    lastExecutedAt: null,
    lastGeneratedAt: null,
    nextDueAt: at(0, 6),
    tasks: ["Capturar vibración en apoyos", "Comparar con línea base"],
    skill: ["skill-instrumentation", 3],
  },
];

type WorkOrderSeed = {
  id: string;
  siteId: string;
  planId: string;
  assetCode: string;
  locationCode: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  completedAt: string | null;
  closedAt: string | null;
  estimatedMinutes: number;
  assigneeId: string | null;
  windowKey: string;
};

const generatedOrders: WorkOrderSeed[] = [
  {
    id: "pm-wo-lm01-20260825",
    siteId: LEVANTE_ID,
    planId: "pm-lm01-monthly",
    assetCode: "LM-01",
    locationCode: "LM-01",
    number: "OT-LEV-2026-0280",
    title: "Inspección mensual de línea de laminación LM-01",
    status: "CLOSED",
    priority: "P3_HIGH",
    dueAt: at(-7, 12),
    plannedStart: at(-7, 7, 30),
    plannedEnd: at(-7, 10),
    completedAt: at(-7, 10, 20),
    closedAt: at(-7, 10, 35),
    estimatedMinutes: 150,
    assigneeId: "user-tech-1",
    windowKey: "CALENDAR:2026-08-25",
  },
  {
    id: "pm-wo-pr01-20260827",
    siteId: LEVANTE_ID,
    planId: "pm-pr01-dryer",
    assetCode: "PR-01-DRY",
    locationCode: "PR-01",
    number: "OT-LEV-2026-0281",
    title: "Preventivo del sistema de secado PR-01",
    status: "CLOSED",
    priority: "P2_URGENT",
    dueAt: at(-5, 12),
    plannedStart: at(-4, 7),
    plannedEnd: at(-4, 10, 30),
    completedAt: at(-3, 11, 20),
    closedAt: at(-3, 12),
    estimatedMinutes: 210,
    assigneeId: "user-tech-2",
    windowKey: "CALENDAR:2026-08-27",
  },
  {
    id: "pm-wo-pr01-overdue",
    siteId: LEVANTE_ID,
    planId: "pm-pr01-dryer",
    assetCode: "PR-01-DRY",
    locationCode: "PR-01",
    number: "OT-LEV-2026-0282",
    title: "Preventivo del sistema de secado PR-01",
    status: "PLANNED",
    priority: "P2_URGENT",
    dueAt: at(-2, 6),
    plannedStart: null,
    plannedEnd: null,
    completedAt: null,
    closedAt: null,
    estimatedMinutes: 210,
    assigneeId: null,
    windowKey: "CALENDAR:2026-08-30",
  },
  {
    id: "pm-wo-comp02-20260901",
    siteId: LEVANTE_ID,
    planId: "pm-comp02-hours",
    assetCode: "COMP-02",
    locationCode: "COMP",
    number: "OT-LEV-2026-0283",
    title: "Servicio 500 h compresor COMP-02",
    status: "SCHEDULED",
    priority: "P3_HIGH",
    dueAt: at(0, 12),
    plannedStart: at(0, 7),
    plannedEnd: at(0, 11, 30),
    completedAt: null,
    closedAt: null,
    estimatedMinutes: 270,
    assigneeId: "user-tech-5",
    windowKey: "METER:12500",
  },
  {
    id: "pm-wo-ch01-20260901",
    siteId: LEVANTE_ID,
    planId: "pm-ch01-weekly",
    assetCode: "CH-01",
    locationCode: "CHILL",
    number: "OT-LEV-2026-0284",
    title: "Ronda semanal de chiller CH-01",
    status: "SCHEDULED",
    priority: "P4_NORMAL",
    dueAt: at(0, 10),
    plannedStart: at(0, 9),
    plannedEnd: at(0, 10, 15),
    completedAt: null,
    closedAt: null,
    estimatedMinutes: 75,
    assigneeId: "user-tech-5",
    windowKey: "CALENDAR:2026-09-01",
  },
  {
    id: "pm-wo-sr03-20260902",
    siteId: LEVANTE_ID,
    planId: "pm-sr03-cycles",
    assetCode: "SR-03-WND",
    locationCode: "SR-03",
    number: "OT-LEV-2026-0285",
    title: "Inspección por ciclos del rebobinado SR-03",
    status: "SCHEDULED",
    priority: "P3_HIGH",
    dueAt: at(1, 7),
    plannedStart: at(1, 8),
    plannedEnd: at(1, 11),
    completedAt: null,
    closedAt: null,
    estimatedMinutes: 180,
    assigneeId: "user-tech-2",
    windowKey: "METER:900000",
  },
  {
    id: "pm-wo-ct01-20260903",
    siteId: LEVANTE_ID,
    planId: "pm-ct01-atex",
    assetCode: "CT-01-APP",
    locationCode: "CT-01",
    number: "OT-LEV-2026-0286",
    title: "Inspección ATEX del cabezal aplicador CT-01",
    status: "SCHEDULED",
    priority: "P3_HIGH",
    dueAt: at(2, 7),
    plannedStart: at(2, 7),
    plannedEnd: at(2, 9),
    completedAt: null,
    closedAt: null,
    estimatedMinutes: 120,
    assigneeId: "user-tech-2",
    windowKey: "CALENDAR:2026-09-03",
  },
  {
    id: "pm-wo-alz-sr04-20260902",
    siteId: ALZIRA_ID,
    planId: "pm-alz-sr04",
    assetCode: "SR-04",
    locationCode: "SR-04",
    number: "OT-ALZ-2026-0280",
    title: "Preventivo mensual slitter SR-04",
    status: "SCHEDULED",
    priority: "P4_NORMAL",
    dueAt: at(1, 7),
    plannedStart: at(1, 7),
    plannedEnd: at(1, 9, 30),
    completedAt: null,
    closedAt: null,
    estimatedMinutes: 150,
    assigneeId: "user-tech-4",
    windowKey: "CALENDAR:2026-09-02",
  },
];

export async function seedV1BDatabase(db: D1Database): Promise<void> {
  const seeded = await db
    .prepare("SELECT value FROM system_state WHERE key = 'demo_seed_v1b_1'")
    .first<{ value: string }>();
  if (seeded?.value === "complete") return;

  const operations: Operation[] = [];
  const skills = [
    ["skill-mechanical", "MECH", "Mecánica industrial", "MECHANICAL"],
    ["skill-electrical", "ELEC", "Electricidad industrial", "ELECTRICAL"],
    ["skill-instrumentation", "INSTR", "Instrumentación y control", "CONTROL"],
    ["skill-utilities", "UTIL", "Utilities de planta", "UTILITIES"],
    ["skill-lubrication", "LUB", "Lubricación industrial", "MECHANICAL"],
  ] as const;
  for (const [id, code, name, category] of skills) {
    operations.push(
      insert(
        "skills",
        [
          "id",
          "organization_id",
          "code",
          "name",
          "category",
          "created_at",
          "updated_at",
        ],
        [id, ORGANIZATION_ID, code, name, category, NOW, NOW],
      ),
    );
  }

  const certifications = [
    ["cert-loto", "LOTO", "Consignación y bloqueo LOTO", "Mazmi HSE"],
    ["cert-atex", "ATEX", "Intervención en zonas ATEX", "Entidad acreditada"],
    ["cert-height", "HEIGHT", "Trabajos en altura", "Mazmi HSE"],
  ] as const;
  for (const row of certifications) {
    operations.push(
      insert(
        "certifications",
        [
          "id",
          "organization_id",
          "code",
          "name",
          "issuing_authority",
          "created_at",
          "updated_at",
        ],
        [row[0], ORGANIZATION_ID, row[1], row[2], row[3], NOW, NOW],
      ),
    );
  }

  const profiles = [
    [LEVANTE_ID, "user-tech-1", "M1", "06:00", "14:00", 480, "AVAILABLE"],
    [LEVANTE_ID, "user-tech-2", "M1", "06:00", "14:00", 480, "AVAILABLE"],
    [LEVANTE_ID, "user-tech-3", "T1", "14:00", "22:00", 480, "AVAILABLE"],
    [LEVANTE_ID, "user-tech-4", "M1", "06:00", "14:00", 480, "AVAILABLE"],
    [LEVANTE_ID, "user-tech-5", "M1", "06:00", "14:00", 480, "AVAILABLE"],
    [LEVANTE_ID, "user-tech-6", "T1", "14:00", "22:00", 420, "LIMITED"],
    [ALZIRA_ID, "user-tech-3", "A1", "06:00", "14:00", 480, "AVAILABLE"],
    [ALZIRA_ID, "user-tech-4", "A1", "06:00", "14:00", 480, "AVAILABLE"],
  ] as const;
  for (const [
    siteId,
    userId,
    shiftCode,
    shiftStart,
    shiftEnd,
    capacity,
    status,
  ] of profiles) {
    operations.push(
      insert(
        "workforce_profiles",
        [
          "id",
          "organization_id",
          "site_id",
          "user_id",
          "shift_code",
          "shift_start",
          "shift_end",
          "daily_capacity_minutes",
          "availability_status",
          "created_at",
          "updated_at",
        ],
        [
          `workforce-${siteId}-${userId}`,
          ORGANIZATION_ID,
          siteId,
          userId,
          shiftCode,
          shiftStart,
          shiftEnd,
          capacity,
          status,
          NOW,
          NOW,
        ],
      ),
    );
  }

  const technicianSkills = [
    ["user-tech-1", "skill-mechanical", 5],
    ["user-tech-1", "skill-lubrication", 4],
    ["user-tech-2", "skill-electrical", 5],
    ["user-tech-2", "skill-instrumentation", 3],
    ["user-tech-3", "skill-mechanical", 3],
    ["user-tech-3", "skill-electrical", 3],
    ["user-tech-4", "skill-mechanical", 4],
    ["user-tech-5", "skill-utilities", 5],
    ["user-tech-5", "skill-mechanical", 3],
    ["user-tech-6", "skill-instrumentation", 5],
    ["user-tech-6", "skill-electrical", 3],
  ] as const;
  for (const [userId, skillId, level] of technicianSkills) {
    operations.push(
      insert(
        "technician_skills",
        ["id", "user_id", "skill_id", "level", "verified_at"],
        [`tech-skill-${userId}-${skillId}`, userId, skillId, level, at(-120)],
      ),
    );
  }

  const technicianCertifications = [
    ["user-tech-1", "cert-loto"],
    ["user-tech-2", "cert-loto"],
    ["user-tech-2", "cert-atex"],
    ["user-tech-3", "cert-loto"],
    ["user-tech-4", "cert-loto"],
    ["user-tech-5", "cert-loto"],
    ["user-tech-6", "cert-atex"],
  ] as const;
  for (const [userId, certificationId] of technicianCertifications) {
    operations.push(
      insert(
        "technician_certifications",
        [
          "id",
          "user_id",
          "certification_id",
          "issued_at",
          "expires_at",
          "status",
        ],
        [
          `tech-cert-${userId}-${certificationId}`,
          userId,
          certificationId,
          at(-180),
          at(365),
          "VALID",
        ],
      ),
    );
  }
  operations.push(
    insert(
      "workforce_availability",
      [
        "id",
        "organization_id",
        "site_id",
        "user_id",
        "kind",
        "starts_at",
        "ends_at",
        "note",
        "created_at",
      ],
      [
        "availability-irene-training",
        ORGANIZATION_ID,
        LEVANTE_ID,
        "user-tech-4",
        "TRAINING",
        at(1, 6),
        at(1, 14),
        "Formación reglamentaria programada",
        NOW,
      ],
    ),
  );

  const meters = [
    [
      "meter-comp02-hours",
      LEVANTE_ID,
      "COMP-02",
      "COMP-02-H",
      "Horas de funcionamiento",
      "h",
      12_540,
      at(0, 5, 45),
    ],
    [
      "meter-sr03-cycles",
      LEVANTE_ID,
      "SR-03-WND",
      "SR-03-CYC",
      "Ciclos de rebobinado",
      "ciclos",
      903_420,
      at(0, 5, 30),
    ],
    [
      "meter-pr01-dryer-cycles",
      LEVANTE_ID,
      "PR-01-DRY",
      "PR-01-DRY-CYC",
      "Ciclos de secado",
      "ciclos",
      1_251_300,
      at(0, 5, 35),
    ],
    [
      "meter-ch01-hours",
      LEVANTE_ID,
      "CH-01",
      "CH-01-H",
      "Horas de funcionamiento",
      "h",
      18_210,
      at(0, 5, 40),
    ],
    [
      "meter-sr04-hours",
      ALZIRA_ID,
      "SR-04",
      "SR-04-H",
      "Horas de funcionamiento",
      "h",
      8_480,
      at(0, 5, 45),
    ],
  ] as const;
  for (const [
    id,
    siteId,
    assetCode,
    code,
    name,
    unit,
    lastValue,
    lastAt,
  ] of meters) {
    operations.push(
      insert(
        "meters",
        [
          "id",
          "organization_id",
          "site_id",
          "asset_id",
          "code",
          "name",
          "unit",
          "reading_type",
          "last_value",
          "last_reading_at",
          "status",
          "version",
          "created_at",
          "updated_at",
        ],
        [
          id,
          ORGANIZATION_ID,
          siteId,
          `asset-${assetCode.toLowerCase()}`,
          code,
          name,
          unit,
          "CUMULATIVE",
          lastValue,
          lastAt,
          "ACTIVE",
          1,
          at(-180),
          lastAt,
        ],
      ),
    );
    for (let index = 3; index >= 0; index -= 1) {
      const value =
        Number(lastValue) - index * Math.max(50, Number(lastValue) * 0.008);
      const recordedAt = index === 0 ? String(lastAt) : at(-index * 7, 5, 45);
      operations.push(
        insert(
          "meter_readings",
          [
            "id",
            "meter_id",
            "recorded_by_id",
            "value",
            "recorded_at",
            "source",
            "note",
            "created_at",
          ],
          [
            `reading-${id}-${index}`,
            id,
            "user-tech-6",
            Math.round(value * 10) / 10,
            recordedAt,
            "MANUAL",
            index === 0 ? "Lectura de ronda de inicio de turno" : null,
            recordedAt,
          ],
        ),
      );
    }
  }

  for (const plan of plans) {
    operations.push(
      insert(
        "maintenance_plans",
        [
          "id",
          "organization_id",
          "site_id",
          "asset_id",
          "functional_location_id",
          "owner_id",
          "meter_id",
          "code",
          "title",
          "description",
          "criticality",
          "priority",
          "estimated_minutes",
          "trigger_mode",
          "calendar_unit",
          "calendar_interval",
          "calendar_anchor_at",
          "calendar_next_at",
          "meter_interval",
          "meter_threshold",
          "lead_days",
          "status",
          "last_executed_at",
          "last_generated_at",
          "next_due_at",
          "version",
          "created_at",
          "updated_at",
        ],
        [
          plan.id,
          ORGANIZATION_ID,
          plan.siteId,
          `asset-${plan.assetCode.toLowerCase()}`,
          `loc-${plan.siteId === LEVANTE_ID ? "lev" : "alz"}-${plan.locationCode.toLowerCase()}`,
          plan.ownerId,
          plan.meterId,
          plan.code,
          plan.title,
          plan.description,
          plan.criticality,
          plan.priority,
          plan.estimatedMinutes,
          plan.triggerMode,
          plan.calendarUnit,
          plan.calendarInterval,
          plan.calendarAnchorAt,
          plan.calendarNextAt,
          plan.meterInterval,
          plan.meterThreshold,
          7,
          plan.status,
          plan.lastExecutedAt,
          plan.lastGeneratedAt,
          plan.nextDueAt,
          1,
          at(-180),
          NOW,
        ],
      ),
    );
    plan.tasks.forEach((task, index) => {
      operations.push(
        insert(
          "maintenance_plan_tasks",
          [
            "id",
            "maintenance_plan_id",
            "sequence",
            "title",
            "description",
            "required",
          ],
          [`${plan.id}-task-${index + 1}`, plan.id, index + 1, task, null, 1],
        ),
      );
    });
    operations.push(
      insert(
        "maintenance_plan_skills",
        ["id", "maintenance_plan_id", "skill_id", "minimum_level"],
        [`${plan.id}-skill`, plan.id, plan.skill[0], plan.skill[1]],
      ),
    );
    if (plan.certification) {
      operations.push(
        insert(
          "maintenance_plan_certifications",
          ["id", "maintenance_plan_id", "certification_id"],
          [`${plan.id}-cert`, plan.id, plan.certification],
        ),
      );
    }
    if (plan.material) {
      operations.push(
        insert(
          "maintenance_plan_materials",
          ["id", "maintenance_plan_id", "part_id", "quantity"],
          [`${plan.id}-material`, plan.id, plan.material[0], plan.material[1]],
        ),
      );
    }
  }

  for (const order of generatedOrders) {
    const plan = plans.find((item) => item.id === order.planId)!;
    const actualStart = order.completedAt ? order.plannedStart : null;
    const actualEnd = order.completedAt;
    operations.push(
      insert(
        "work_orders",
        [
          "id",
          "organization_id",
          "site_id",
          "asset_id",
          "functional_location_id",
          "requested_by_id",
          "maintenance_plan_id",
          "maintenance_window_key",
          "preventive_due_at",
          "number",
          "title",
          "description",
          "status",
          "priority",
          "type",
          "source",
          "requested_at",
          "due_at",
          "planned_start",
          "planned_end",
          "actual_start",
          "actual_end",
          "completed_at",
          "closed_at",
          "cancelled_at",
          "estimated_minutes",
          "downtime_minutes",
          "diagnosis",
          "solution",
          "failure_mode",
          "failure_cause",
          "production_impact",
          "version",
          "created_at",
          "updated_at",
        ],
        [
          order.id,
          ORGANIZATION_ID,
          order.siteId,
          `asset-${order.assetCode.toLowerCase()}`,
          `loc-${order.siteId === LEVANTE_ID ? "lev" : "alz"}-${order.locationCode.toLowerCase()}`,
          plan.ownerId,
          order.planId,
          order.windowKey,
          order.dueAt,
          order.number,
          order.title,
          plan.description,
          order.status,
          order.priority,
          "PREVENTIVE",
          "PLAN",
          at(-10),
          order.dueAt,
          order.plannedStart,
          order.plannedEnd,
          actualStart,
          actualEnd,
          order.completedAt,
          order.closedAt,
          null,
          order.estimatedMinutes,
          0,
          order.completedAt
            ? "Preventivo ejecutado sin anomalías bloqueantes."
            : null,
          order.completedAt ? "Checklist completada y equipo liberado." : null,
          null,
          null,
          "NONE",
          1,
          at(-10),
          order.closedAt ?? order.completedAt ?? order.plannedStart ?? NOW,
        ],
      ),
    );
    plan.tasks.forEach((task, index) => {
      operations.push(
        insert(
          "work_order_tasks",
          [
            "id",
            "work_order_id",
            "source_task_id",
            "sequence",
            "title",
            "description",
            "required",
            "completed_at",
            "completed_by_id",
          ],
          [
            `${order.id}-task-${index + 1}`,
            order.id,
            `${plan.id}-task-${index + 1}`,
            index + 1,
            task,
            null,
            1,
            order.completedAt,
            order.completedAt ? order.assigneeId : null,
          ],
        ),
      );
    });
    operations.push(
      insert(
        "work_order_skill_requirements",
        ["id", "work_order_id", "skill_id", "minimum_level"],
        [`${order.id}-skill`, order.id, plan.skill[0], plan.skill[1]],
      ),
      insert(
        "work_order_events",
        [
          "id",
          "work_order_id",
          "actor_id",
          "event_type",
          "from_status",
          "to_status",
          "note",
          "created_at",
        ],
        [
          `${order.id}-generated-event`,
          order.id,
          plan.ownerId,
          "PREVENTIVE_WORK_ORDER_GENERATED",
          null,
          "PLANNED",
          `Generada desde ${plan.code}.`,
          at(-10),
        ],
      ),
    );
    if (plan.certification) {
      operations.push(
        insert(
          "work_order_certification_requirements",
          ["id", "work_order_id", "certification_id"],
          [`${order.id}-cert`, order.id, plan.certification],
        ),
      );
    }
    if (order.assigneeId) {
      operations.push(
        insert(
          "work_order_assignments",
          [
            "id",
            "work_order_id",
            "user_id",
            "assignment_role",
            "assigned_at",
            "unassigned_at",
          ],
          [
            `${order.id}-assignment`,
            order.id,
            order.assigneeId,
            "TECHNICIAN",
            order.plannedStart ?? at(-1),
            null,
          ],
        ),
      );
    }
    if (plan.material && order.siteId === LEVANTE_ID) {
      operations.push(
        insert(
          "work_order_materials",
          [
            "id",
            "work_order_id",
            "part_id",
            "bin_id",
            "planned_quantity",
            "reserved_quantity",
            "consumed_quantity",
            "returned_quantity",
            "created_by_id",
            "version",
            "created_at",
            "updated_at",
          ],
          [
            `${order.id}-material`,
            order.id,
            plan.material[0],
            "bin-lev-01",
            plan.material[1],
            0,
            0,
            0,
            plan.ownerId,
            1,
            at(-10),
            NOW,
          ],
        ),
      );
    }
  }

  await executeInChunks(db, operations);
  await db
    .prepare(
      "INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES ('demo_seed_v1b_1', 'complete', ?)",
    )
    .bind(NOW)
    .run();
}
