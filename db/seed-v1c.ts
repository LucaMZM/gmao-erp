type SqlValue = string | number | null;
type Operation = { sql: string; params: SqlValue[] };

const ORGANIZATION_ID = "org-mazmi-flexpack";
const LEVANTE_ID = "site-levante";
const ALZIRA_ID = "site-alzira";
const ANCHOR = new Date("2026-09-05T06:00:00.000Z");
const NOW = ANCHOR.toISOString();

function at(dayOffset: number, hour = 8, minute = 0): string {
  const date = new Date(ANCHOR);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

function addMinutes(value: string, minutes: number): string {
  return new Date(new Date(value).getTime() + minutes * 60_000).toISOString();
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
  size = 50,
): Promise<void> {
  for (let offset = 0; offset < operations.length; offset += size) {
    const chunk = operations.slice(offset, offset + size);
    try {
      await db.batch(
        chunk.map((operation) =>
          db.prepare(operation.sql).bind(...operation.params),
        ),
      );
    } catch (error) {
      throw new Error(
        `V1C seed failed in operation chunk ${offset}-${offset + chunk.length - 1}: ${chunk[0]?.sql}.`,
        {
          cause: error,
        },
      );
    }
  }
}

const modes = [
  [
    "fm-bearing-wear",
    "BEARING_WEAR",
    "Desgaste de rodamiento",
    "MECHANICAL",
    "Vibración, temperatura y pérdida progresiva de precisión.",
  ],
  [
    "fm-misalignment",
    "MISALIGNMENT",
    "Desalineación",
    "MECHANICAL",
    "Vibración, desgaste prematuro y defecto de proceso.",
  ],
  [
    "fm-airflow-restriction",
    "AIRFLOW_RESTRICTION",
    "Restricción de caudal de aire",
    "PROCESS",
    "Pérdida de capacidad térmica y reducción de velocidad.",
  ],
  [
    "fm-pneumatic-leak",
    "PNEUMATIC_LEAK",
    "Fuga neumática",
    "UTILITIES",
    "Caída de presión y mayor demanda energética.",
  ],
  [
    "fm-signal-instability",
    "SIGNAL_INSTABILITY",
    "Inestabilidad de señal",
    "ELECTRICAL",
    "Pérdida de regulación y paradas intermitentes.",
  ],
  [
    "fm-contamination",
    "CONTAMINATION",
    "Contaminación de elemento",
    "PROCESS",
    "Degradación de calidad y vida útil reducida.",
  ],
  [
    "fm-vibration",
    "VIBRATION",
    "Vibración anómala",
    "MECHANICAL",
    "Degradación mecánica, ruido o pérdida de precisión.",
  ],
  [
    "fm-leakage",
    "LEAKAGE",
    "Fuga de fluido",
    "PROCESS",
    "Pérdida de contención o rendimiento del sistema.",
  ],
  [
    "fm-overheating",
    "OVERHEATING",
    "Sobretemperatura",
    "THERMAL",
    "Reducción de capacidad y riesgo de parada.",
  ],
  [
    "fm-signal-loss",
    "SIGNAL_LOSS",
    "Pérdida de señal",
    "ELECTRICAL",
    "Regulación inestable o pérdida de control.",
  ],
] as const;

type FailureSeed = {
  workOrderId: string;
  downtimeId: string;
  assetId: string;
  locationId: string;
  failureModeId: string;
  legacyMode: string;
  cause: string;
  effect: string;
  requestedDay: number;
  duration: number;
  title: string;
  priority: string;
  technicianId: string;
};

const failures: FailureSeed[] = [
  {
    workOrderId: "wo-027",
    downtimeId: "downtime-001",
    assetId: "asset-lm-02-app",
    locationId: "loc-lev-lm-02",
    failureModeId: "fm-bearing-wear",
    legacyMode: "BEARING_WEAR",
    cause: "Lubricación insuficiente en apoyo lado transmisión",
    effect: "Vibración elevada y parada total de LM-02",
    requestedDay: -72,
    duration: 180,
    title: "Vibración elevada en apoyo del rodillo aplicador LM-02",
    priority: "P2_URGENT",
    technicianId: "user-tech-1",
  },
  {
    workOrderId: "wo-030",
    downtimeId: "downtime-004",
    assetId: "asset-lm-02-app",
    locationId: "loc-lev-lm-02",
    failureModeId: "fm-bearing-wear",
    legacyMode: "BEARING_WEAR",
    cause: "Contaminación del lubricante en apoyo del aplicador",
    effect: "Pérdida de estabilidad de recubrimiento y parada total",
    requestedDay: -38,
    duration: 265,
    title: "Recurrencia de vibración en rodillo aplicador LM-02",
    priority: "P2_URGENT",
    technicianId: "user-tech-2",
  },
  {
    workOrderId: "wo-033",
    downtimeId: "downtime-007",
    assetId: "asset-lm-02-app",
    locationId: "loc-lev-lm-02",
    failureModeId: "fm-bearing-wear",
    legacyMode: "BEARING_WEAR",
    cause: "Desalineación residual y pauta de lubricación insuficiente",
    effect: "Parada total con pérdida del lote en curso",
    requestedDay: -9,
    duration: 430,
    title: "Tercera incidencia de vibración en aplicador LM-02",
    priority: "P1_EMERGENCY",
    technicianId: "user-tech-1",
  },
  {
    workOrderId: "wo-028",
    downtimeId: "downtime-002",
    assetId: "asset-pr-01-dry",
    locationId: "loc-lev-pr-01",
    failureModeId: "fm-airflow-restriction",
    legacyMode: "AIRFLOW_RESTRICTION",
    cause: "Carga acelerada de filtros de admisión",
    effect: "Producción degradada por pérdida de capacidad de secado",
    requestedDay: -79,
    duration: 145,
    title: "Caudal insuficiente en secado PR-01",
    priority: "P3_HIGH",
    technicianId: "user-tech-3",
  },
  {
    workOrderId: "wo-031",
    downtimeId: "downtime-005",
    assetId: "asset-pr-01-dry",
    locationId: "loc-lev-pr-01",
    failureModeId: "fm-airflow-restriction",
    legacyMode: "AIRFLOW_RESTRICTION",
    cause: "Acumulación de partículas aguas arriba del filtro",
    effect: "Reducción sostenida de velocidad de impresión",
    requestedDay: -43,
    duration: 215,
    title: "Nueva pérdida de caudal en sistema de secado PR-01",
    priority: "P2_URGENT",
    technicianId: "user-tech-3",
  },
  {
    workOrderId: "wo-034",
    downtimeId: "downtime-008",
    assetId: "asset-pr-01-dry",
    locationId: "loc-lev-pr-01",
    failureModeId: "fm-airflow-restriction",
    legacyMode: "AIRFLOW_RESTRICTION",
    cause: "Intervalo de limpieza no adaptado a la carga de polvo real",
    effect: "Parada total por temperatura fuera de rango",
    requestedDay: -7,
    duration: 305,
    title: "Restricción recurrente de admisión en secado PR-01",
    priority: "P1_EMERGENCY",
    technicianId: "user-tech-5",
  },
  {
    workOrderId: "wo-029",
    downtimeId: "downtime-003",
    assetId: "asset-comp-02",
    locationId: "loc-lev-comp",
    failureModeId: "fm-pneumatic-leak",
    legacyMode: "PNEUMATIC_LEAK",
    cause: "Racor de impulsión con sellado degradado",
    effect: "Presión de red degradada sin parada total",
    requestedDay: -55,
    duration: 90,
    title: "Fuga en impulsión de COMP-02",
    priority: "P3_HIGH",
    technicianId: "user-tech-2",
  },
  {
    workOrderId: "wo-035",
    downtimeId: "downtime-009",
    assetId: "asset-comp-02",
    locationId: "loc-lev-comp",
    failureModeId: "fm-pneumatic-leak",
    legacyMode: "PNEUMATIC_LEAK",
    cause: "Vibración transmitida a unión flexible de impulsión",
    effect: "Presión inestable y producción degradada",
    requestedDay: -16,
    duration: 120,
    title: "Pérdida recurrente de presión en COMP-02",
    priority: "P2_URGENT",
    technicianId: "user-tech-2",
  },
  {
    workOrderId: "wo-032",
    downtimeId: "downtime-006",
    assetId: "asset-sr-03-wnd",
    locationId: "loc-lev-sr-03",
    failureModeId: "fm-misalignment",
    legacyMode: "MISALIGNMENT",
    cause: "Desalineación puntual tras cambio de formato",
    effect: "Microparada y bobinado fuera de tolerancia",
    requestedDay: -21,
    duration: 55,
    title: "Desalineación puntual de eje de rebobinado SR-03",
    priority: "P3_HIGH",
    technicianId: "user-tech-4",
  },
  {
    workOrderId: "wo-036",
    downtimeId: "downtime-010",
    assetId: "asset-lm-01-drv",
    locationId: "loc-lev-lm-01",
    failureModeId: "fm-signal-instability",
    legacyMode: "SIGNAL_INSTABILITY",
    cause: "Conector de encoder con apriete deficiente",
    effect: "Producción degradada durante aceleración",
    requestedDay: -49,
    duration: 70,
    title: "Señal inestable de velocidad en LM-01",
    priority: "P3_HIGH",
    technicianId: "user-tech-5",
  },
];

function failureOperations(failure: FailureSeed): Operation[] {
  const requestedAt = at(failure.requestedDay, 5, 40);
  const actualStart = at(failure.requestedDay, 6, 20);
  const actualEnd = addMinutes(actualStart, failure.duration);
  const completedAt = addMinutes(actualEnd, 12);
  const closedAt = addMinutes(actualEnd, 35);
  const productionImpact =
    failure.duration >= 280
      ? "FULL_STOP"
      : failure.duration <= 60
        ? "MICRO_STOP"
        : "REDUCED_SPEED";
  const downtimeKind =
    productionImpact === "MICRO_STOP" ? "MICRO_STOP" : "UNPLANNED";

  return [
    {
      sql: `UPDATE work_orders SET asset_id = ?, functional_location_id = ?, title = ?, description = ?, status = 'CLOSED', priority = ?, type = 'CORRECTIVE', source = 'REQUEST', requested_at = ?, due_at = ?, planned_start = ?, planned_end = ?, actual_start = ?, actual_end = ?, completed_at = ?, closed_at = ?, cancelled_at = NULL, estimated_minutes = ?, downtime_minutes = ?, diagnosis = ?, solution = ?, failure_mode_id = ?, failure_mode = ?, failure_cause = ?, failure_effect = ?, production_impact = ?, updated_at = ? WHERE id = ?`,
      params: [
        failure.assetId,
        failure.locationId,
        failure.title,
        "Intervención correctiva documentada para análisis de recurrencia y fiabilidad.",
        failure.priority,
        requestedAt,
        addMinutes(requestedAt, 240),
        actualStart,
        actualEnd,
        actualStart,
        actualEnd,
        completedAt,
        closedAt,
        Math.max(90, failure.duration),
        failure.duration,
        failure.cause,
        "Elemento ajustado o sustituido; equipo verificado bajo carga.",
        failure.failureModeId,
        failure.legacyMode,
        failure.cause,
        failure.effect,
        productionImpact,
        closedAt,
        failure.workOrderId,
      ],
    },
    {
      sql: "DELETE FROM work_order_events WHERE work_order_id = ?",
      params: [failure.workOrderId],
    },
    {
      sql: "UPDATE work_order_assignments SET user_id = ?, assigned_at = ?, unassigned_at = NULL WHERE work_order_id = ?",
      params: [
        failure.technicianId,
        addMinutes(requestedAt, 25),
        failure.workOrderId,
      ],
    },
    {
      sql: "UPDATE labor_sessions SET user_id = ?, started_at = ?, ended_at = ?, minutes = ?, status = 'STOPPED', ended_by_id = ? WHERE work_order_id = ?",
      params: [
        failure.technicianId,
        actualStart,
        actualEnd,
        failure.duration,
        failure.technicianId,
        failure.workOrderId,
      ],
    },
    {
      sql: "UPDATE downtime_events SET asset_id = ?, functional_location_id = ?, created_by_id = ?, ended_by_id = ?, started_at = ?, ended_at = ?, duration_minutes = ?, kind = ?, production_impact = ?, cause = ?, updated_at = ? WHERE id = ?",
      params: [
        failure.assetId,
        failure.locationId,
        failure.technicianId,
        failure.technicianId,
        actualStart,
        actualEnd,
        failure.duration,
        downtimeKind,
        productionImpact,
        failure.cause,
        actualEnd,
        failure.downtimeId,
      ],
    },
    ...[
      ["CREATED", null, "REQUESTED", requestedAt, "Avería registrada."],
      [
        "WORK_STARTED",
        "ASSIGNED",
        "IN_PROGRESS",
        actualStart,
        "Diagnóstico e intervención iniciados.",
      ],
      [
        "WORK_COMPLETED",
        "IN_PROGRESS",
        "COMPLETED",
        completedAt,
        "Prueba funcional satisfactoria.",
      ],
      [
        "WORK_ORDER_CLOSED",
        "COMPLETED",
        "CLOSED",
        closedAt,
        "Cierre técnico validado.",
      ],
    ].map(([eventType, fromStatus, toStatus, createdAt, note], index) =>
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
          `v1c-event-${failure.workOrderId}-${index + 1}`,
          failure.workOrderId,
          index === 0 ? "user-supervisor-mech" : failure.technicianId,
          eventType,
          fromStatus,
          toStatus,
          note,
          createdAt,
        ],
      ),
    ),
  ];
}

export async function seedV1CDatabase(db: D1Database): Promise<void> {
  const seeded = await db
    .prepare("SELECT value FROM system_state WHERE key = 'demo_seed_v1c_3'")
    .first<{ value: string }>();
  if (seeded?.value === "complete") return;

  const operations: Operation[] = [];
  for (const [id, code, name, category, defaultEffect] of modes) {
    operations.push(
      insert(
        "failure_modes",
        [
          "id",
          "organization_id",
          "code",
          "name",
          "category",
          "default_effect",
          "status",
          "created_at",
          "updated_at",
        ],
        [
          id,
          ORGANIZATION_ID,
          code,
          name,
          category,
          defaultEffect,
          "ACTIVE",
          NOW,
          NOW,
        ],
      ),
    );
  }
  operations.push(
    {
      sql: "UPDATE work_orders SET failure_mode_id = 'fm-vibration', failure_effect = COALESCE(failure_effect, 'Degradación mecánica o pérdida de precisión') WHERE failure_mode_id IS NULL AND failure_mode = 'VIBRATION'",
      params: [],
    },
    {
      sql: "UPDATE work_orders SET failure_mode_id = 'fm-leakage', failure_effect = COALESCE(failure_effect, 'Pérdida de contención o rendimiento') WHERE failure_mode_id IS NULL AND failure_mode = 'LEAKAGE'",
      params: [],
    },
    {
      sql: "UPDATE work_orders SET failure_mode_id = 'fm-overheating', failure_effect = COALESCE(failure_effect, 'Reducción de capacidad por temperatura') WHERE failure_mode_id IS NULL AND failure_mode = 'OVERHEATING'",
      params: [],
    },
    {
      sql: "UPDATE work_orders SET failure_mode_id = 'fm-signal-loss', failure_effect = COALESCE(failure_effect, 'Pérdida de regulación o control') WHERE failure_mode_id IS NULL AND failure_mode = 'SIGNAL_LOSS'",
      params: [],
    },
  );
  for (const failure of failures)
    operations.push(...failureOperations(failure));

  const alziraFailures = [
    {
      id: "wo-v1c-alz-001",
      number: "OT-ALZ-2026-0271",
      day: -41,
      duration: 95,
      title: "Pérdida de señal de guiado en SR-04",
    },
    {
      id: "wo-v1c-alz-002",
      number: "OT-ALZ-2026-0272",
      day: -12,
      duration: 125,
      title: "Recurrencia de señal de guiado en SR-04",
    },
  ];
  for (const [index, failure] of alziraFailures.entries()) {
    const requestedAt = at(failure.day, 7, 10);
    const startedAt = at(failure.day, 7, 45);
    const endedAt = addMinutes(startedAt, failure.duration);
    const closedAt = addMinutes(endedAt, 25);
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
          "failure_mode_id",
          "number",
          "title",
          "description",
          "status",
          "priority",
          "type",
          "source",
          "requested_at",
          "due_at",
          "actual_start",
          "actual_end",
          "completed_at",
          "closed_at",
          "estimated_minutes",
          "downtime_minutes",
          "diagnosis",
          "solution",
          "failure_mode",
          "failure_cause",
          "failure_effect",
          "production_impact",
          "version",
          "created_at",
          "updated_at",
        ],
        [
          failure.id,
          ORGANIZATION_ID,
          ALZIRA_ID,
          "asset-sr-04",
          "loc-alz-sr-04",
          "user-supervisor-mech",
          "fm-signal-instability",
          failure.number,
          failure.title,
          "Fallo intermitente del sistema de guiado documentado en la célula de corte.",
          "CLOSED",
          index ? "P2_URGENT" : "P3_HIGH",
          "CORRECTIVE",
          "REQUEST",
          requestedAt,
          addMinutes(requestedAt, 300),
          startedAt,
          endedAt,
          addMinutes(endedAt, 10),
          closedAt,
          120,
          failure.duration,
          "Conexión de encoder degradada por vibración.",
          "Conector sustituido y señal verificada.",
          "SIGNAL_INSTABILITY",
          "Pérdida de apriete por vibración",
          "Producción degradada durante el guiado de banda",
          "REDUCED_SPEED",
          1,
          requestedAt,
          closedAt,
        ],
      ),
      insert(
        "downtime_events",
        [
          "id",
          "organization_id",
          "site_id",
          "asset_id",
          "functional_location_id",
          "work_order_id",
          "created_by_id",
          "ended_by_id",
          "started_at",
          "ended_at",
          "duration_minutes",
          "kind",
          "production_impact",
          "cause",
          "created_at",
          "updated_at",
        ],
        [
          `downtime-${failure.id}`,
          ORGANIZATION_ID,
          ALZIRA_ID,
          "asset-sr-04",
          "loc-alz-sr-04",
          failure.id,
          "user-tech-4",
          "user-tech-4",
          startedAt,
          endedAt,
          failure.duration,
          "UNPLANNED",
          "REDUCED_SPEED",
          "Pérdida de apriete por vibración",
          requestedAt,
          endedAt,
        ],
      ),
    );
  }

  operations.push(
    insert(
      "incidents",
      [
        "id",
        "organization_id",
        "site_id",
        "functional_location_id",
        "asset_id",
        "reported_by_id",
        "number",
        "title",
        "description",
        "severity",
        "initial_impact",
        "status",
        "origin",
        "classification",
        "triage_priority",
        "reported_at",
        "created_at",
        "updated_at",
      ],
      [
        "incident-v1c-lm02",
        ORGANIZATION_ID,
        LEVANTE_ID,
        "loc-lev-lm-02",
        "asset-lm-02-app",
        "user-viewer",
        "INC-LEV-2026-0191",
        "Vibración perceptible tras último cambio de formato",
        "Operación informa de una nueva señal de vibración en el apoyo del aplicador.",
        "CRITICAL",
        "REDUCED_SPEED",
        "NEW",
        "OPERATOR",
        "CORRECTIVE",
        "P2_URGENT",
        at(-2, 13, 18),
        at(-2, 13, 18),
        at(-2, 13, 18),
      ],
    ),
    insert(
      "incident_events",
      [
        "id",
        "incident_id",
        "actor_id",
        "event_type",
        "from_status",
        "to_status",
        "note",
        "created_at",
      ],
      [
        "event-incident-v1c-lm02",
        "incident-v1c-lm02",
        "user-viewer",
        "INCIDENT_REPORTED",
        null,
        "NEW",
        "Nueva señal vinculada al patrón recurrente conocido.",
        at(-2, 13, 18),
      ],
    ),
  );

  const rcaRows = [
    {
      id: "rca-lev-001",
      siteId: LEVANTE_ID,
      number: "RCA-LEV-2026-001",
      assetId: "asset-lm-02-app",
      workOrderId: "wo-033",
      modeId: "fm-bearing-wear",
      ownerId: "user-reliability",
      problem: "Tres fallos de rodamiento del aplicador LM-02 en 72 días.",
      impact: "875 min de downtime acumulado y una parada de emergencia.",
      immediateCause: "Degradación acelerada del apoyo del rodillo.",
      rootCause:
        "Pauta de lubricación no adaptada a la contaminación y desalineación residual del conjunto.",
      status: "ACTIONS_DEFINED",
      targetAt: at(21, 16),
      createdAt: at(-8, 9),
    },
    {
      id: "rca-lev-002",
      siteId: LEVANTE_ID,
      number: "RCA-LEV-2026-002",
      assetId: "asset-pr-01-dry",
      workOrderId: "wo-034",
      modeId: "fm-airflow-restriction",
      ownerId: "user-reliability",
      problem: "Restricción de caudal recurrente pese al preventivo de secado.",
      impact: "665 min de afectación y pérdida de capacidad térmica.",
      immediateCause: "Saturación prematura de filtros de admisión.",
      rootCause: null,
      status: "INVESTIGATING",
      targetAt: at(14, 16),
      createdAt: at(-6, 10),
    },
    {
      id: "rca-lev-003",
      siteId: LEVANTE_ID,
      number: "RCA-LEV-2026-003",
      assetId: "asset-comp-02",
      workOrderId: "wo-035",
      modeId: "fm-pneumatic-leak",
      ownerId: "user-supervisor-mech",
      problem: "Repetición de fugas en la impulsión del compresor COMP-02.",
      impact: "210 min de producción degradada y aumento de carga energética.",
      immediateCause: "Fatiga de la unión flexible de impulsión.",
      rootCause:
        "Soporte de tubería insuficiente que transmite vibración al racor.",
      status: "CLOSED",
      targetAt: at(-3, 16),
      createdAt: at(-15, 11),
    },
    {
      id: "rca-alz-001",
      siteId: ALZIRA_ID,
      number: "RCA-ALZ-2026-001",
      assetId: "asset-sr-04",
      workOrderId: "wo-v1c-alz-002",
      modeId: "fm-signal-instability",
      ownerId: "user-reliability",
      problem: "Dos pérdidas de señal del guiado de SR-04 en 41 días.",
      impact: "220 min de producción degradada.",
      immediateCause: "Conexión de encoder sensible a vibración.",
      rootCause: null,
      status: "DRAFT",
      targetAt: at(18, 16),
      createdAt: at(-10, 12),
    },
  ] as const;

  for (const rca of rcaRows) {
    operations.push(
      insert(
        "root_cause_analyses",
        [
          "id",
          "organization_id",
          "site_id",
          "number",
          "asset_id",
          "source_work_order_id",
          "failure_mode_id",
          "created_by_id",
          "owner_id",
          "problem",
          "impact",
          "immediate_cause",
          "root_cause",
          "status",
          "target_at",
          "version",
          "created_at",
          "updated_at",
        ],
        [
          rca.id,
          ORGANIZATION_ID,
          rca.siteId,
          rca.number,
          rca.assetId,
          rca.workOrderId,
          rca.modeId,
          "user-reliability",
          rca.ownerId,
          rca.problem,
          rca.impact,
          rca.immediateCause,
          rca.rootCause,
          rca.status,
          rca.targetAt,
          1,
          rca.createdAt,
          rca.createdAt,
        ],
      ),
      insert(
        "rca_events",
        [
          "id",
          "root_cause_analysis_id",
          "actor_id",
          "event_type",
          "from_status",
          "to_status",
          "note",
          "created_at",
        ],
        [
          `event-${rca.id}-created`,
          rca.id,
          "user-reliability",
          "RCA_CREATED",
          null,
          "DRAFT",
          "Investigación de fiabilidad iniciada desde el historial operativo.",
          rca.createdAt,
        ],
      ),
      insert(
        "rca_evidence",
        [
          "id",
          "root_cause_analysis_id",
          "kind",
          "description",
          "source_reference",
          "created_by_id",
          "created_at",
        ],
        [
          `evidence-${rca.id}-01`,
          rca.id,
          "WORK_ORDER",
          `Historial y downtime consolidado de ${rca.workOrderId}.`,
          rca.workOrderId,
          "user-reliability",
          rca.createdAt,
        ],
      ),
    );
  }

  const seededStatusEvents = [
    ["rca-lev-001", "DRAFT", "INVESTIGATING", at(-7, 10)],
    ["rca-lev-001", "INVESTIGATING", "ACTIONS_DEFINED", at(-5, 9)],
    ["rca-lev-002", "DRAFT", "INVESTIGATING", at(-5, 10)],
    ["rca-lev-003", "DRAFT", "INVESTIGATING", at(-14, 9)],
    ["rca-lev-003", "INVESTIGATING", "ACTIONS_DEFINED", at(-12, 9)],
    ["rca-lev-003", "ACTIONS_DEFINED", "VERIFICATION", at(-4, 13)],
    ["rca-lev-003", "VERIFICATION", "CLOSED", at(-3, 15)],
  ] as const;
  for (const [rcaId, fromStatus, toStatus, createdAt] of seededStatusEvents) {
    operations.push(
      insert(
        "rca_events",
        [
          "id",
          "root_cause_analysis_id",
          "actor_id",
          "event_type",
          "from_status",
          "to_status",
          "note",
          "created_at",
        ],
        [
          `event-${rcaId}-${toStatus.toLowerCase()}`,
          rcaId,
          "user-reliability",
          "RCA_STATUS_CHANGED",
          fromStatus,
          toStatus,
          "Estado de investigación actualizado con evidencia técnica.",
          createdAt,
        ],
      ),
    );
  }

  const lmWhys = [
    [
      1,
      "¿Por qué se detuvo LM-02?",
      "El apoyo del aplicador superó el límite de vibración.",
    ],
    [
      2,
      "¿Por qué aumentó la vibración?",
      "El rodamiento presentaba desgaste y contaminación.",
    ],
    [
      3,
      "¿Por qué se contaminó?",
      "El sellado y la pauta de lubricación no cubrían el entorno real.",
    ],
    [
      4,
      "¿Por qué la pauta no era adecuada?",
      "El plan se definió con condiciones nominales.",
    ],
    [
      5,
      "¿Por qué no se corrigió antes?",
      "La recurrencia no estaba consolidada como una señal única.",
    ],
  ] as const;
  for (const [sequence, question, answer] of lmWhys) {
    operations.push(
      insert(
        "rca_whys",
        ["id", "root_cause_analysis_id", "sequence", "question", "answer"],
        [
          `why-rca-lev-001-${sequence}`,
          "rca-lev-001",
          sequence,
          question,
          answer,
        ],
      ),
    );
  }

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
        "number",
        "title",
        "description",
        "status",
        "priority",
        "type",
        "source",
        "requested_at",
        "due_at",
        "estimated_minutes",
        "downtime_minutes",
        "production_impact",
        "version",
        "created_at",
        "updated_at",
      ],
      [
        "wo-rca-lm02-alignment",
        ORGANIZATION_ID,
        LEVANTE_ID,
        "asset-lm-02-app",
        "loc-lev-lm-02",
        "user-reliability",
        "OT-LEV-2026-0290",
        "Corregir alineación y sellado del aplicador LM-02",
        "Acción correctiva originada en RCA-LEV-2026-001.",
        "APPROVED",
        "P2_URGENT",
        "IMPROVEMENT",
        "SYSTEM",
        at(-5, 9),
        at(9, 16),
        240,
        0,
        "NONE",
        1,
        at(-5, 9),
        at(-5, 9),
      ],
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
        "event-wo-rca-lm02-created",
        "wo-rca-lm02-alignment",
        "user-reliability",
        "RCA_ACTION_WORK_ORDER_CREATED",
        null,
        "APPROVED",
        "Acción creada desde RCA-LEV-2026-001.",
        at(-5, 9),
      ],
    ),
    insert(
      "rca_actions",
      [
        "id",
        "root_cause_analysis_id",
        "title",
        "description",
        "action_type",
        "status",
        "owner_id",
        "target_at",
        "linked_work_order_id",
        "created_at",
        "updated_at",
      ],
      [
        "rca-action-lm02-alignment",
        "rca-lev-001",
        "Corregir alineación y sellado del aplicador",
        "Eliminar la desalineación residual y mejorar la protección del apoyo.",
        "CREATE_WORK_ORDER",
        "IN_PROGRESS",
        "user-supervisor-mech",
        at(9, 16),
        "wo-rca-lm02-alignment",
        at(-5, 9),
        at(-5, 9),
      ],
    ),
    insert(
      "rca_actions",
      [
        "id",
        "root_cause_analysis_id",
        "title",
        "description",
        "action_type",
        "status",
        "owner_id",
        "target_at",
        "linked_maintenance_plan_id",
        "created_at",
        "updated_at",
      ],
      [
        "rca-action-lm02-pm",
        "rca-lev-001",
        "Revisar pauta preventiva del aplicador",
        "Validar frecuencia de lubricación tras la corrección técnica.",
        "UPDATE_MAINTENANCE_PLAN",
        "OPEN",
        "user-reliability",
        at(16, 16),
        "pm-lm02-inactive",
        at(-5, 9, 15),
        at(-5, 9, 15),
      ],
    ),
    insert(
      "rca_actions",
      [
        "id",
        "root_cause_analysis_id",
        "title",
        "description",
        "action_type",
        "status",
        "owner_id",
        "target_at",
        "completed_at",
        "created_at",
        "updated_at",
      ],
      [
        "rca-action-comp02-support",
        "rca-lev-003",
        "Instalar soporte antivibratorio en impulsión",
        "Eliminar carga mecánica transmitida al racor flexible.",
        "TECHNICAL_CHANGE",
        "DONE",
        "user-supervisor-mech",
        at(-5, 16),
        at(-4, 12),
        at(-14, 10),
        at(-4, 12),
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
        "created_at",
      ],
      [
        "audit-rca-lev-001-created",
        ORGANIZATION_ID,
        LEVANTE_ID,
        "user-reliability",
        "RCA_CREATED",
        "ROOT_CAUSE_ANALYSIS",
        "rca-lev-001",
        null,
        '{"status":"ACTIONS_DEFINED"}',
        "seed-v1c",
        at(-8, 9),
      ],
    ),
    {
      sql: "INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES ('sequence:ot:site-levante', '290', ?)",
      params: [NOW],
    },
    {
      sql: "INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES ('sequence:inc:site-levante', '191', ?)",
      params: [NOW],
    },
  );

  await executeInChunks(db, operations);
  await db
    .prepare(
      "INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES ('demo_seed_v1c_3', 'complete', ?)",
    )
    .bind(NOW)
    .run();
  await db.prepare("PRAGMA optimize").run();
}
