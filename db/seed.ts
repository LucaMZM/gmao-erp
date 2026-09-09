import { derivePasswordHash } from "@/lib/server/crypto";
import {
  assertWorkOrderTransition,
  type WorkOrderStatus,
} from "@/lib/domain/work-orders";

type SqlValue = string | number | null;
type Operation = { sql: string; params: SqlValue[] };

const ORGANIZATION_ID = "org-mazmi-flexpack";
const MAIN_SITE_ID = "site-levante";
const SECONDARY_SITE_ID = "site-alzira";
const ANCHOR = new Date("2026-08-25T08:00:00.000Z");
const NOW = ANCHOR.toISOString();
const DEMO_PASSWORD = "Mazmi2026!";
const DEMO_SALT = "6d617a6d692d666163746f72792d7630";

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
  const placeholders = values.map(() => "?").join(",");
  return {
    sql: `INSERT OR IGNORE INTO ${table} (${columns.join(",")}) VALUES (${placeholders})`,
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

function idFor(prefix: string, code: string): string {
  return `${prefix}-${code.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export type SeedAsset = {
  id: string;
  siteId: string;
  locationId: string;
  parentId: string | null;
  classId: string;
  vendorId: string | null;
  code: string;
  name: string;
  description: string;
  kind: "EQUIPMENT" | "ASSEMBLY" | "COMPONENT";
  status: string;
  criticality: string;
  health: number;
  manufacturer: string;
  model: string;
  serial: string;
  commissioned: string;
  warranty: string | null;
  nextPm: string;
  technical: string;
};

export function buildAssets(): SeedAsset[] {
  const assets: SeedAsset[] = [];
  const add = (
    siteId: string,
    locationCode: string,
    code: string,
    name: string,
    classCode: string,
    kind: SeedAsset["kind"],
    parentCode: string | null,
    criticality: string,
    health: number,
    status = "OPERATING",
    manufacturer = "Integra Motion",
    model = "Industrial Series",
  ) => {
    const sitePrefix = siteId === MAIN_SITE_ID ? "lev" : "alz";
    const description =
      kind === "EQUIPMENT"
        ? `${name}, activo mantenible principal integrado en el proceso de transformación.`
        : `${name}, elemento mantenible del conjunto ${parentCode ?? code}.`;
    assets.push({
      id: idFor("asset", code),
      siteId,
      locationId: idFor(`loc-${sitePrefix}`, locationCode),
      parentId: parentCode ? idFor("asset", parentCode) : null,
      classId: idFor("class", classCode),
      vendorId: idFor(
        "vendor",
        ["MOTIONEX", "RODATEC", "ELECTROLEV", "AEROTEC"][assets.length % 4],
      ),
      code,
      name,
      description,
      kind,
      status,
      criticality,
      health,
      manufacturer,
      model,
      serial: `MZ-${sitePrefix.toUpperCase()}-${String(1000 + assets.length).padStart(5, "0")}`,
      commissioned: at(-2200 + assets.length * 7),
      warranty: assets.length % 5 === 0 ? at(450 + assets.length) : null,
      nextPm: at((assets.length % 24) - 5, 7 + (assets.length % 7)),
      technical:
        "Ficha técnica verificada · mantenimiento basado en condición y preventivo periódico.",
    });
  };

  for (const code of ["PR-01", "PR-02", "PR-03"]) {
    add(
      MAIN_SITE_ID,
      code,
      code,
      `Línea de Impresión Flexográfica ${code}`,
      "PRINT_LINE",
      "EQUIPMENT",
      null,
      "CRITICAL",
      code === "PR-01" ? 78 : 88,
      "OPERATING",
      "Flexion Industrial",
      "FX-8",
    );
    add(
      MAIN_SITE_ID,
      code,
      `${code}-UNW`,
      "Sistema de desbobinado",
      "UNWINDER",
      "ASSEMBLY",
      code,
      "HIGH",
      86,
    );
    add(
      MAIN_SITE_ID,
      code,
      `${code}-DRY`,
      "Sistema de secado",
      "DRYER",
      "ASSEMBLY",
      code,
      "CRITICAL",
      code === "PR-01" ? 68 : 89,
      code === "PR-01" ? "MAINTENANCE" : "OPERATING",
    );
    add(
      MAIN_SITE_ID,
      code,
      `${code}-DRV`,
      "Accionamiento principal",
      "DRIVE",
      "ASSEMBLY",
      code,
      "HIGH",
      90,
    );
    add(
      MAIN_SITE_ID,
      code,
      `${code}-REG`,
      "Sistema de registro y visión",
      "CONTROL",
      "ASSEMBLY",
      code,
      "HIGH",
      code === "PR-02" ? 64 : 91,
      code === "PR-02" ? "DEGRADED" : "OPERATING",
    );
  }

  for (const code of ["LM-01", "LM-02"]) {
    add(
      MAIN_SITE_ID,
      code,
      code,
      `Línea de Laminación ${code}`,
      "LAM_LINE",
      "EQUIPMENT",
      null,
      "CRITICAL",
      code === "LM-02" ? 71 : 92,
      code === "LM-02" ? "DEGRADED" : "OPERATING",
      "Lamitek Systems",
      "LX-1200",
    );
    add(
      MAIN_SITE_ID,
      code,
      `${code}-UNW`,
      "Sistema de desbobinado doble",
      "UNWINDER",
      "ASSEMBLY",
      code,
      "HIGH",
      88,
    );
    add(
      MAIN_SITE_ID,
      code,
      `${code}-APP`,
      "Conjunto de rodillo aplicador",
      "ROLLER",
      "ASSEMBLY",
      code,
      "CRITICAL",
      code === "LM-02" ? 52 : 89,
      code === "LM-02" ? "DEGRADED" : "OPERATING",
      "Rodatec Motion",
      "RA-120",
    );
    add(
      MAIN_SITE_ID,
      code,
      `${code}-DRY`,
      "Túnel de secado",
      "DRYER",
      "ASSEMBLY",
      code,
      "HIGH",
      84,
    );
    add(
      MAIN_SITE_ID,
      code,
      `${code}-WND`,
      "Sistema de bobinado",
      "WINDER",
      "ASSEMBLY",
      code,
      "HIGH",
      87,
    );
    add(
      MAIN_SITE_ID,
      code,
      `${code}-DRV`,
      "Motor y reductor principal",
      "DRIVE",
      "COMPONENT",
      code,
      "HIGH",
      91,
    );
  }

  add(
    MAIN_SITE_ID,
    "CT-01",
    "CT-01",
    "Línea de Coating CT-01",
    "COAT_LINE",
    "EQUIPMENT",
    null,
    "CRITICAL",
    85,
    "OPERATING",
    "Coatline Engineering",
    "CT-1500",
  );
  add(
    MAIN_SITE_ID,
    "CT-01",
    "CT-01-UNW",
    "Desbobinador de coating",
    "UNWINDER",
    "ASSEMBLY",
    "CT-01",
    "HIGH",
    91,
  );
  add(
    MAIN_SITE_ID,
    "CT-01",
    "CT-01-APP",
    "Cabezal aplicador",
    "ROLLER",
    "ASSEMBLY",
    "CT-01",
    "CRITICAL",
    74,
    "DEGRADED",
  );
  add(
    MAIN_SITE_ID,
    "CT-01",
    "CT-01-DRY",
    "Horno de secado",
    "DRYER",
    "ASSEMBLY",
    "CT-01",
    "CRITICAL",
    83,
  );
  add(
    MAIN_SITE_ID,
    "CT-01",
    "CT-01-WND",
    "Bobinador de salida",
    "WINDER",
    "ASSEMBLY",
    "CT-01",
    "HIGH",
    90,
  );

  for (const code of ["SR-01", "SR-02", "SR-03"]) {
    add(
      MAIN_SITE_ID,
      code,
      code,
      `Slitter rebobinadora ${code}`,
      "SLITTER",
      "EQUIPMENT",
      null,
      "HIGH",
      code === "SR-03" ? 73 : 90,
      code === "SR-03" ? "DEGRADED" : "OPERATING",
      "Convertix Machinery",
      "SR-900",
    );
    add(
      MAIN_SITE_ID,
      code,
      `${code}-UNW`,
      "Desbobinador",
      "UNWINDER",
      "ASSEMBLY",
      code,
      "MEDIUM",
      91,
    );
    add(
      MAIN_SITE_ID,
      code,
      `${code}-KNF`,
      "Sistema de cuchillas",
      "CUTTING",
      "ASSEMBLY",
      code,
      "HIGH",
      code === "SR-02" ? 69 : 86,
    );
    add(
      MAIN_SITE_ID,
      code,
      `${code}-WND`,
      "Eje de rebobinado",
      "WINDER",
      "ASSEMBLY",
      code,
      "HIGH",
      code === "SR-03" ? 61 : 88,
      code === "SR-03" ? "DEGRADED" : "OPERATING",
    );
  }

  const utilities = [
    [
      "COMP-01",
      "Compresor de aire COMP-01",
      "COMP",
      "COMPRESSOR",
      "CRITICAL",
      93,
      "OPERATING",
    ],
    [
      "COMP-02",
      "Compresor de aire COMP-02",
      "COMP",
      "COMPRESSOR",
      "CRITICAL",
      61,
      "DEGRADED",
    ],
    [
      "CH-01",
      "Chiller de proceso CH-01",
      "CHILL",
      "CHILLER",
      "CRITICAL",
      76,
      "DEGRADED",
    ],
    [
      "CH-02",
      "Chiller de proceso CH-02",
      "CHILL",
      "CHILLER",
      "HIGH",
      91,
      "OPERATING",
    ],
    [
      "VAC-01",
      "Central de vacío VAC-01",
      "VAC",
      "PUMP",
      "HIGH",
      87,
      "OPERATING",
    ],
    [
      "EXT-01",
      "Sistema central de extracción EXT-01",
      "EXT",
      "HVAC",
      "CRITICAL",
      72,
      "DEGRADED",
    ],
    [
      "HVAC-01",
      "Climatización sala eléctrica HVAC-01",
      "HVAC",
      "HVAC",
      "HIGH",
      90,
      "OPERATING",
    ],
    [
      "PUMP-FIRE-01",
      "Grupo de presión PCI",
      "FIRE",
      "PUMP",
      "CRITICAL",
      96,
      "STANDBY",
    ],
    [
      "TRAFO-01",
      "Transformador principal TRAFO-01",
      "ELEC",
      "ELECTRICAL",
      "CRITICAL",
      94,
      "OPERATING",
    ],
    [
      "MDB-01",
      "Cuadro general de baja tensión MDB-01",
      "ELEC",
      "ELECTRICAL",
      "CRITICAL",
      92,
      "OPERATING",
    ],
    [
      "DRY-AIR-01",
      "Secador frigorífico de aire",
      "COMP",
      "DRYER",
      "HIGH",
      84,
      "OPERATING",
    ],
    [
      "GEN-01",
      "Grupo electrógeno de emergencia",
      "ELEC",
      "ELECTRICAL",
      "HIGH",
      95,
      "STANDBY",
    ],
  ] as const;
  for (const [
    code,
    name,
    location,
    classCode,
    criticality,
    health,
    status,
  ] of utilities) {
    add(
      MAIN_SITE_ID,
      location,
      code,
      name,
      classCode,
      "EQUIPMENT",
      null,
      criticality,
      health,
      status,
    );
  }

  add(
    MAIN_SITE_ID,
    "LAB",
    "LAB-TEST-01",
    "Equipo universal de ensayos",
    "LAB",
    "EQUIPMENT",
    null,
    "MEDIUM",
    94,
  );
  add(
    MAIN_SITE_ID,
    "LAB",
    "LAB-VISC-01",
    "Viscosímetro de laboratorio",
    "LAB",
    "EQUIPMENT",
    null,
    "MEDIUM",
    88,
  );
  add(
    MAIN_SITE_ID,
    "FG",
    "FL-01",
    "Carretilla eléctrica FL-01",
    "FORKLIFT",
    "EQUIPMENT",
    null,
    "MEDIUM",
    82,
  );
  add(
    MAIN_SITE_ID,
    "RAW",
    "FL-02",
    "Carretilla eléctrica FL-02",
    "FORKLIFT",
    "EQUIPMENT",
    null,
    "MEDIUM",
    89,
  );
  add(
    MAIN_SITE_ID,
    "GENERAL",
    "BOILER-01",
    "Caldera de aceite térmico",
    "UTILITY",
    "EQUIPMENT",
    null,
    "CRITICAL",
    86,
  );
  add(
    MAIN_SITE_ID,
    "GENERAL",
    "WWTP-01",
    "Sistema de tratamiento de efluentes",
    "UTILITY",
    "EQUIPMENT",
    null,
    "HIGH",
    90,
  );
  add(
    MAIN_SITE_ID,
    "FG",
    "DOCK-01",
    "Muelle nivelador DOCK-01",
    "LOGISTICS",
    "EQUIPMENT",
    null,
    "MEDIUM",
    93,
  );
  add(
    MAIN_SITE_ID,
    "MAINT",
    "CRANE-01",
    "Puente grúa de taller",
    "LOGISTICS",
    "EQUIPMENT",
    null,
    "MEDIUM",
    95,
  );

  add(
    SECONDARY_SITE_ID,
    "SR-04",
    "SR-04",
    "Slitter rebobinadora SR-04",
    "SLITTER",
    "EQUIPMENT",
    null,
    "HIGH",
    91,
  );
  add(
    SECONDARY_SITE_ID,
    "SR-05",
    "SR-05",
    "Slitter rebobinadora SR-05",
    "SLITTER",
    "EQUIPMENT",
    null,
    "HIGH",
    87,
  );
  add(
    SECONDARY_SITE_ID,
    "UTIL",
    "COMP-03",
    "Compresor de aire COMP-03",
    "COMPRESSOR",
    "EQUIPMENT",
    null,
    "CRITICAL",
    89,
  );
  add(
    SECONDARY_SITE_ID,
    "GENERAL",
    "HVAC-02",
    "Climatización nave HVAC-02",
    "HVAC",
    "EQUIPMENT",
    null,
    "MEDIUM",
    92,
  );
  add(
    SECONDARY_SITE_ID,
    "FG",
    "FL-03",
    "Carretilla eléctrica FL-03",
    "FORKLIFT",
    "EQUIPMENT",
    null,
    "MEDIUM",
    78,
  );
  add(
    SECONDARY_SITE_ID,
    "GENERAL",
    "MDB-02",
    "Cuadro general MDB-02",
    "ELECTRICAL",
    "EQUIPMENT",
    null,
    "CRITICAL",
    94,
  );
  add(
    SECONDARY_SITE_ID,
    "LAB",
    "LAB-COLOR-02",
    "Espectrofotómetro de color",
    "LAB",
    "EQUIPMENT",
    null,
    "MEDIUM",
    96,
  );
  add(
    SECONDARY_SITE_ID,
    "FG",
    "DOCK-02",
    "Muelle nivelador DOCK-02",
    "LOGISTICS",
    "EQUIPMENT",
    null,
    "LOW",
    90,
  );

  return assets;
}

export type SeedWorkOrder = {
  id: string;
  asset: SeedAsset;
  number: string;
  title: string;
  description: string;
  status: WorkOrderStatus;
  priority: string;
  type: string;
  source: string;
  requestedAt: string;
  dueAt: string;
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
  technicianId: string;
};

export type SeedWorkOrderStatusEvent = {
  fromStatus: WorkOrderStatus;
  toStatus: WorkOrderStatus;
  createdAt: string;
  note: string;
};

const statusPaths: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  REQUESTED: ["REQUESTED"],
  TRIAGE: ["REQUESTED", "TRIAGE"],
  APPROVED: ["REQUESTED", "TRIAGE", "APPROVED"],
  PLANNED: ["REQUESTED", "TRIAGE", "APPROVED", "PLANNED"],
  SCHEDULED: ["REQUESTED", "TRIAGE", "APPROVED", "PLANNED", "SCHEDULED"],
  ASSIGNED: [
    "REQUESTED",
    "TRIAGE",
    "APPROVED",
    "PLANNED",
    "SCHEDULED",
    "ASSIGNED",
  ],
  IN_PROGRESS: [
    "REQUESTED",
    "TRIAGE",
    "APPROVED",
    "PLANNED",
    "SCHEDULED",
    "ASSIGNED",
    "IN_PROGRESS",
  ],
  PAUSED: [
    "REQUESTED",
    "TRIAGE",
    "APPROVED",
    "PLANNED",
    "SCHEDULED",
    "ASSIGNED",
    "IN_PROGRESS",
    "PAUSED",
  ],
  WAITING_PART: [
    "REQUESTED",
    "TRIAGE",
    "APPROVED",
    "PLANNED",
    "SCHEDULED",
    "ASSIGNED",
    "IN_PROGRESS",
    "WAITING_PART",
  ],
  WAITING_VENDOR: [
    "REQUESTED",
    "TRIAGE",
    "APPROVED",
    "PLANNED",
    "SCHEDULED",
    "ASSIGNED",
    "IN_PROGRESS",
    "WAITING_VENDOR",
  ],
  COMPLETED: [
    "REQUESTED",
    "TRIAGE",
    "APPROVED",
    "PLANNED",
    "SCHEDULED",
    "ASSIGNED",
    "IN_PROGRESS",
    "COMPLETED",
  ],
  CLOSED: [
    "REQUESTED",
    "TRIAGE",
    "APPROVED",
    "PLANNED",
    "SCHEDULED",
    "ASSIGNED",
    "IN_PROGRESS",
    "COMPLETED",
    "CLOSED",
  ],
  CANCELLED: ["REQUESTED", "CANCELLED"],
};

function addMinutes(value: string, minutes: number): string {
  return new Date(new Date(value).getTime() + minutes * 60_000).toISOString();
}

function minutesBetween(start: string, end: string): number {
  return Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  );
}

export function buildWorkOrderStatusHistory(
  order: SeedWorkOrder,
): SeedWorkOrderStatusEvent[] {
  const path = statusPaths[order.status];
  if (path.length === 1) return [];

  const requestedAt = new Date(order.requestedAt).getTime();
  const inProgressIndex = path.indexOf("IN_PROGRESS");
  const startAt = order.actualStart
    ? new Date(order.actualStart).getTime()
    : null;
  const finishedAt = order.actualEnd
    ? new Date(order.actualEnd).getTime()
    : null;
  const plannedAt = order.plannedStart
    ? new Date(order.plannedStart).getTime()
    : null;
  const waitingAt = startAt
    ? startAt + Math.max(30, Math.round(order.estimatedMinutes / 2)) * 60_000
    : null;
  const targetAt =
    order.status === "CLOSED" && finishedAt
      ? finishedAt + 30 * 60_000
      : order.status === "COMPLETED" && finishedAt
        ? finishedAt
        : ["PAUSED", "WAITING_PART", "WAITING_VENDOR"].includes(order.status) &&
            waitingAt
          ? waitingAt
          : order.status === "IN_PROGRESS" && startAt
            ? startAt
            : (plannedAt ?? requestedAt + 30 * 60_000);

  return path.slice(1).map((toStatus, transitionIndex) => {
    const pathIndex = transitionIndex + 1;
    const fromStatus = path[pathIndex - 1];
    assertWorkOrderTransition(fromStatus, toStatus);

    let eventAt: number;
    if (toStatus === "IN_PROGRESS" && startAt) {
      eventAt = startAt;
    } else if (toStatus === "COMPLETED" && finishedAt) {
      eventAt = finishedAt;
    } else if (toStatus === "CLOSED" && finishedAt) {
      eventAt = finishedAt + 30 * 60_000;
    } else if (inProgressIndex > 0 && pathIndex < inProgressIndex && startAt) {
      eventAt =
        requestedAt +
        Math.round(((startAt - requestedAt) * pathIndex) / inProgressIndex);
    } else if (pathIndex > inProgressIndex && inProgressIndex > 0) {
      eventAt = targetAt;
    } else {
      eventAt =
        requestedAt +
        Math.round(((targetAt - requestedAt) * pathIndex) / (path.length - 1));
    }

    return {
      fromStatus,
      toStatus,
      createdAt: new Date(Math.max(requestedAt, eventAt)).toISOString(),
      note:
        toStatus === "CLOSED"
          ? "Trabajo validado y cerrado."
          : toStatus === "COMPLETED"
            ? "Intervención completada y pendiente de validación."
            : "Estado actualizado según flujo operativo.",
    };
  });
}

export function buildWorkOrders(assets: SeedAsset[]): SeedWorkOrder[] {
  const assetByCode = new Map(assets.map((asset) => [asset.code, asset]));
  const activeStatuses: WorkOrderStatus[] = [
    "IN_PROGRESS",
    "WAITING_PART",
    "ASSIGNED",
    "SCHEDULED",
    "REQUESTED",
    "PLANNED",
    "TRIAGE",
    "APPROVED",
    "ASSIGNED",
    "WAITING_VENDOR",
    "IN_PROGRESS",
    "PAUSED",
    "SCHEDULED",
    "PLANNED",
    "REQUESTED",
    "ASSIGNED",
    "TRIAGE",
    "IN_PROGRESS",
    "WAITING_PART",
    "APPROVED",
    "SCHEDULED",
    "ASSIGNED",
    "PLANNED",
    "REQUESTED",
    "IN_PROGRESS",
    "WAITING_VENDOR",
  ];
  const custom = [
    [
      "LM-02-APP",
      "Vibración anómala en rodillo aplicador de LM-02",
      "Se detecta vibración creciente en el lado operador durante cambios de velocidad.",
      "P2_URGENT",
      "CORRECTIVE",
    ],
    [
      "COMP-02",
      "Sustituir filtro de admisión de COMP-02",
      "Diferencial de presión por encima del umbral operativo.",
      "P3_HIGH",
      "PREVENTIVE",
    ],
    [
      "SR-03-WND",
      "Inspeccionar eje de rebobinado de SR-03",
      "Revisar holgura, concentricidad y estado de apoyos antes del siguiente lote.",
      "P3_HIGH",
      "INSPECTION",
    ],
    [
      "PR-01-DRY",
      "Preventivo del sistema de secado de PR-01",
      "Limpieza, inspección de conductos y verificación de temperaturas.",
      "P4_NORMAL",
      "PREVENTIVE",
    ],
    [
      "CT-01-APP",
      "Fuga intermitente en circuito de aplicación de CT-01",
      "Presencia de producto en la bandeja inferior tras arranque.",
      "P2_URGENT",
      "CORRECTIVE",
    ],
    [
      "CH-01",
      "Rendimiento térmico bajo en CH-01",
      "La impulsión tarda más de lo esperado en alcanzar consigna.",
      "P3_HIGH",
      "PREDICTIVE",
    ],
    [
      "PR-02-REG",
      "Pérdida ocasional de registro en PR-02",
      "La lectura del encoder fluctúa en aceleración.",
      "P2_URGENT",
      "CORRECTIVE",
    ],
    [
      "LM-01-DRV",
      "Calibrar control de tensión de LM-01",
      "Verificación programada del lazo de control.",
      "P3_HIGH",
      "CALIBRATION",
    ],
    [
      "SR-02-KNF",
      "Sustituir juego de cuchillas de SR-02",
      "Desgaste observado en inspección de cambio de formato.",
      "P3_HIGH",
      "PREVENTIVE",
    ],
    [
      "EXT-01",
      "Revisar rodamiento de ventilador EXT-01",
      "Ruido mecánico y temperatura elevada en apoyo lado transmisión.",
      "P2_URGENT",
      "CORRECTIVE",
    ],
  ] as const;
  const templates = [
    [
      "Inspeccionar protecciones y enclavamientos de {asset}",
      "Inspección funcional de seguridad y registro de hallazgos.",
      "INSPECTION",
    ],
    [
      "Corregir fuga neumática en {asset}",
      "Caída de presión localizada durante la ronda del turno.",
      "CORRECTIVE",
    ],
    [
      "Lubricación programada de {asset}",
      "Aplicar pauta de lubricación y registrar condición observada.",
      "PREVENTIVE",
    ],
    [
      "Verificar alineación de {asset}",
      "Comprobación de acoplamiento, fijaciones y alineación.",
      "PREDICTIVE",
    ],
    [
      "Revisar sensor de posición de {asset}",
      "Señal inestable registrada en eventos del control.",
      "CORRECTIVE",
    ],
    [
      "Limpieza técnica y reapriete de {asset}",
      "Intervención preventiva dentro de la ventana programada.",
      "PREVENTIVE",
    ],
  ] as const;

  const eligible = assets.filter((asset) => asset.siteId === MAIN_SITE_ID);
  const orders: SeedWorkOrder[] = [];
  for (let index = 0; index < 80; index += 1) {
    const customRow = custom[index];
    const asset = customRow
      ? assetByCode.get(customRow[0])!
      : eligible[(index * 7 + 3) % eligible.length];
    const template = templates[index % templates.length];
    const isActive = index < 26;
    const isCompleted = index >= 26 && index < 61;
    const isClosed = index >= 61 && index < 79;
    const status: WorkOrderStatus = isActive
      ? activeStatuses[index]
      : isCompleted
        ? "COMPLETED"
        : isClosed
          ? "CLOSED"
          : "CANCELLED";
    const requestedOffset = isActive
      ? index % 13 === 0
        ? -3
        : -(index % 13)
      : isCompleted
        ? -(5 + (index - 26))
        : isClosed
          ? -(50 + (index - 61) * 2)
          : -20;
    const title = customRow
      ? customRow[1]
      : template[0].replace("{asset}", asset.code);
    const description = customRow ? customRow[2] : template[1];
    const type = customRow ? customRow[4] : template[2];
    const priority = customRow
      ? customRow[3]
      : index % 11 === 0
        ? "P2_URGENT"
        : index % 4 === 0
          ? "P3_HIGH"
          : "P4_NORMAL";
    const hasActiveIntervention = [
      "IN_PROGRESS",
      "PAUSED",
      "WAITING_PART",
      "WAITING_VENDOR",
    ].includes(status);
    const actualStart =
      isCompleted || isClosed
        ? at(requestedOffset + 2, 7 + (index % 7), 15)
        : hasActiveIntervention
          ? at(-1, 6 + (index % 5), 20)
          : null;
    const downtimeMinutes =
      (isCompleted || isClosed) && index < 54
        ? 220 + (index % 9) * 55
        : type === "CORRECTIVE" && isActive
          ? 25 + (index % 8) * 17
          : 0;
    const actualEnd =
      actualStart && (isCompleted || isClosed)
        ? addMinutes(actualStart, downtimeMinutes || 90 + (index % 6) * 30)
        : null;
    orders.push({
      id: `wo-${String(index + 1).padStart(3, "0")}`,
      asset,
      number: `OT-LEV-2026-${String(184 + index).padStart(4, "0")}`,
      title,
      description,
      status,
      priority,
      type,
      source:
        type === "PREVENTIVE"
          ? "PLAN"
          : index % 5 === 0
            ? "CONDITION"
            : "REQUEST",
      requestedAt: at(requestedOffset, 6 + (index % 9), (index * 7) % 60),
      dueAt: at(
        isActive
          ? index % 5 === 0
            ? -1 - (index % 3)
            : 1 + (index % 8)
          : requestedOffset + 6,
        14,
      ),
      plannedStart:
        status === "REQUESTED" || status === "TRIAGE" || status === "CANCELLED"
          ? null
          : at(
              isActive ? (index % 6) - 2 : requestedOffset + 2,
              7 + (index % 8),
            ),
      plannedEnd:
        status === "REQUESTED" || status === "TRIAGE" || status === "CANCELLED"
          ? null
          : at(
              isActive ? (index % 6) - 2 : requestedOffset + 2,
              9 + (index % 8),
            ),
      actualStart,
      actualEnd,
      estimatedMinutes: 45 + (index % 6) * 30,
      downtimeMinutes,
      diagnosis:
        isCompleted || isClosed
          ? [
              "Desgaste progresivo",
              "Holgura fuera de tolerancia",
              "Contaminación del elemento",
              "Conexión inestable",
            ][index % 4]
          : index < 10
            ? "Diagnóstico inicial pendiente de confirmación en campo."
            : null,
      solution:
        isCompleted || isClosed
          ? [
              "Elemento sustituido y verificado",
              "Ajuste mecánico y prueba funcional completados",
              "Limpieza técnica y parámetros restablecidos",
              "Conexión reparada y señal estabilizada",
            ][index % 4]
          : null,
      failureMode:
        type === "CORRECTIVE"
          ? ["VIBRATION", "LEAKAGE", "OVERHEATING", "SIGNAL_LOSS"][index % 4]
          : null,
      failureCause:
        isCompleted || isClosed
          ? ["WEAR", "CONTAMINATION", "MISALIGNMENT", "LOOSE_CONNECTION"][
              index % 4
            ]
          : null,
      productionImpact:
        downtimeMinutes > 70
          ? "FULL_STOP"
          : downtimeMinutes > 0
            ? "REDUCED_SPEED"
            : "NONE",
      technicianId: `user-tech-${((index + Math.floor(index / 6)) % 6) + 1}`,
    });
  }
  return orders;
}

export type SeedPart = {
  id: string;
  categoryId: string;
  sku: string;
  name: string;
  description: string;
  unit: string;
  manufacturer: string;
  manufacturerRef: string;
  cost: number;
  binId: string;
  critical: number;
  min: number;
  max: number;
  reorder: number;
  leadTime: number;
  onHand: number;
  reserved: number;
  onOrder: number;
};

export function buildParts(): SeedPart[] {
  const families = [
    {
      category: "BEAR",
      prefix: "MEC-ROD",
      count: 28,
      base: 18,
      unit: "ud",
      names: [
        "Rodamiento rígido",
        "Rodamiento oscilante",
        "Rodamiento de rodillos",
      ],
      makers: ["Motionex", "Rodatec"],
    },
    {
      category: "DRIVE",
      prefix: "MEC-TRA",
      count: 22,
      base: 24,
      unit: "ud",
      names: ["Correa dentada", "Correa trapezoidal", "Acoplamiento elástico"],
      makers: ["Transmec", "Motionex"],
    },
    {
      category: "SENSOR",
      prefix: "ELE-SEN",
      count: 26,
      base: 42,
      unit: "ud",
      names: [
        "Sensor inductivo",
        "Fotocélula industrial",
        "Encoder incremental",
      ],
      makers: ["Sensora", "Elettron"],
    },
    {
      category: "ELECT",
      prefix: "ELE-CTL",
      count: 22,
      base: 16,
      unit: "ud",
      names: [
        "Contactor tripolar",
        "Relé de seguridad",
        "Fuente de alimentación",
      ],
      makers: ["Electrolev", "Controlia"],
    },
    {
      category: "PNEU",
      prefix: "PNE-ACT",
      count: 22,
      base: 13,
      unit: "ud",
      names: [
        "Racor instantáneo",
        "Electroválvula neumática",
        "Cilindro compacto",
      ],
      makers: ["Pneumatik", "Aerius"],
    },
    {
      category: "FILTER",
      prefix: "FIL-IND",
      count: 18,
      base: 21,
      unit: "ud",
      names: [
        "Filtro de admisión",
        "Cartucho filtrante",
        "Prefiltro de proceso",
      ],
      makers: ["FiltraMec", "Aerotec"],
    },
    {
      category: "SEAL",
      prefix: "MEC-EST",
      count: 18,
      base: 7,
      unit: "ud",
      names: ["Retén radial", "Junta tórica", "Sello mecánico"],
      makers: ["Sellatec", "Rodatec"],
    },
    {
      category: "LUBE",
      prefix: "QUI-LUB",
      count: 12,
      base: 55,
      unit: "l",
      names: [
        "Aceite reductor",
        "Grasa para rodamientos",
        "Lubricante alimentario",
      ],
      makers: ["LubriNova", "Quimitec"],
    },
    {
      category: "FAST",
      prefix: "MEC-FIJ",
      count: 12,
      base: 3,
      unit: "ud",
      names: [
        "Tornillo alta resistencia",
        "Tuerca autoblocante",
        "Arandela elástica",
      ],
      makers: ["FixingPro", "Metalum"],
    },
  ] as const;
  const parts: SeedPart[] = [];
  for (const family of families) {
    for (let localIndex = 0; localIndex < family.count; localIndex += 1) {
      const index = parts.length;
      const min = family.unit === "l" ? 10 + (index % 4) * 5 : 2 + (index % 5);
      const reorder = min + (index % 3);
      const max = reorder * 4;
      const low = index % 7 === 0;
      const zero = index % 23 === 0;
      const onHand = zero
        ? 0
        : low
          ? Math.max(1, min - 1)
          : min + 3 + (index % 11);
      const reserved = onHand > 2 && index % 6 === 0 ? Math.min(2, onHand) : 0;
      const onOrder =
        onHand <= reorder ? reorder * 2 : index % 17 === 0 ? min : 0;
      const variant = `${localIndex + 1}-${["A", "B", "C"][localIndex % 3]}`;
      const sku = `${family.prefix}-${String(localIndex + 1).padStart(3, "0")}`;
      parts.push({
        id: `part-${String(index + 1).padStart(3, "0")}`,
        categoryId: idFor("category", family.category),
        sku,
        name: `${family.names[localIndex % family.names.length]} ${variant}`,
        description: `Referencia MRO aprobada para mantenimiento industrial. Variante ${variant}.`,
        unit: family.unit,
        manufacturer: family.makers[localIndex % family.makers.length],
        manufacturerRef: `${family.category}-${String(4100 + index).padStart(5, "0")}`,
        cost: Number((family.base * (1 + (localIndex % 9) * 0.19)).toFixed(2)),
        binId: `bin-lev-${String((index % 24) + 1).padStart(2, "0")}`,
        critical: index % 6 === 0 ? 1 : 0,
        min,
        max,
        reorder,
        leadTime: 3 + (index % 18),
        onHand,
        reserved,
        onOrder,
      });
    }
  }
  return parts;
}

export async function seedDemoDatabase(db: D1Database): Promise<void> {
  const seeded = await db
    .prepare("SELECT value FROM system_state WHERE key = 'demo_seed_v1a_2'")
    .first<{ value: string }>();
  if (seeded?.value === "complete") return;

  const passwordHash = await derivePasswordHash(DEMO_PASSWORD, DEMO_SALT);
  const operations: Operation[] = [];

  operations.push(
    insert(
      "organizations",
      ["id", "code", "name", "timezone", "locale", "created_at", "updated_at"],
      [
        ORGANIZATION_ID,
        "MZ-FLEX",
        "Mazmi FlexPack Industries, S.L.",
        "Europe/Madrid",
        "es-ES",
        NOW,
        NOW,
      ],
    ),
    insert(
      "sites",
      [
        "id",
        "organization_id",
        "code",
        "name",
        "short_name",
        "city",
        "timezone",
        "status",
        "created_at",
        "updated_at",
      ],
      [
        MAIN_SITE_ID,
        ORGANIZATION_ID,
        "ES-LEV-01",
        "Planta Levante",
        "Levante",
        "Paterna",
        "Europe/Madrid",
        "ACTIVE",
        NOW,
        NOW,
      ],
    ),
    insert(
      "sites",
      [
        "id",
        "organization_id",
        "code",
        "name",
        "short_name",
        "city",
        "timezone",
        "status",
        "created_at",
        "updated_at",
      ],
      [
        SECONDARY_SITE_ID,
        ORGANIZATION_ID,
        "ES-ALZ-02",
        "Centro de Conversión Alzira",
        "Alzira",
        "Alzira",
        "Europe/Madrid",
        "ACTIVE",
        NOW,
        NOW,
      ],
    ),
  );

  const roleRows = [
    [
      "MAINTENANCE_MANAGER",
      "Responsable de Mantenimiento",
      "Responsabilidad operativa y de equipo",
      10,
    ],
    ["PLANNER", "Planner", "Planificación, backlog y programación", 20],
    [
      "RELIABILITY_ENGINEER",
      "Ingeniero de Fiabilidad",
      "Análisis de condición y fiabilidad",
      30,
    ],
    [
      "SUPERVISOR",
      "Supervisor",
      "Supervisión de trabajos por especialidad",
      40,
    ],
    [
      "TECHNICIAN",
      "Técnico",
      "Ejecución y documentación de intervenciones",
      50,
    ],
    ["WAREHOUSE", "Almacén", "Operación de inventario MRO", 60],
    ["VIEWER", "Viewer", "Consulta operativa sin mutaciones", 90],
  ] as const;
  for (const row of roleRows)
    operations.push(
      insert("roles", ["key", "name", "description", "rank"], [...row]),
    );

  const userRows = [
    [
      "user-manager",
      "responsable@mazmi.demo",
      "Lucía Martín",
      "LM",
      "Responsable de Mantenimiento",
      "forest",
      "MAINTENANCE_MANAGER",
    ],
    [
      "user-planner",
      "planner@mazmi.demo",
      "Adrián Soler",
      "AS",
      "Planner de Mantenimiento",
      "steel",
      "PLANNER",
    ],
    [
      "user-reliability",
      "fiabilidad@mazmi.demo",
      "Nuria Ferrer",
      "NF",
      "Ingeniera de Fiabilidad",
      "amber",
      "RELIABILITY_ENGINEER",
    ],
    [
      "user-supervisor-mech",
      "supervisor.mec@mazmi.demo",
      "Óscar Beltrán",
      "OB",
      "Supervisor Mecánico",
      "slate",
      "SUPERVISOR",
    ],
    [
      "user-supervisor-elec",
      "supervisor.elec@mazmi.demo",
      "Eva Torres",
      "ET",
      "Supervisora Eléctrica",
      "blue",
      "SUPERVISOR",
    ],
    [
      "user-tech-1",
      "tecnico1@mazmi.demo",
      "Javier Costa",
      "JC",
      "Técnico Mecánico",
      "teal",
      "TECHNICIAN",
    ],
    [
      "user-tech-2",
      "tecnico2@mazmi.demo",
      "Marta Vidal",
      "MV",
      "Técnica Eléctrica",
      "violet",
      "TECHNICIAN",
    ],
    [
      "user-tech-3",
      "tecnico3@mazmi.demo",
      "Sergio Calvo",
      "SC",
      "Técnico Electromecánico",
      "orange",
      "TECHNICIAN",
    ],
    [
      "user-tech-4",
      "tecnico4@mazmi.demo",
      "Irene Gimeno",
      "IG",
      "Técnica Mecánica",
      "rose",
      "TECHNICIAN",
    ],
    [
      "user-tech-5",
      "tecnico5@mazmi.demo",
      "David Pons",
      "DP",
      "Técnico de Utilities",
      "cyan",
      "TECHNICIAN",
    ],
    [
      "user-tech-6",
      "tecnico6@mazmi.demo",
      "Alba Miralles",
      "AM",
      "Técnica de Instrumentación",
      "indigo",
      "TECHNICIAN",
    ],
    [
      "user-warehouse",
      "almacen@mazmi.demo",
      "Raúl Navarro",
      "RN",
      "Responsable de Almacén MRO",
      "brown",
      "WAREHOUSE",
    ],
    [
      "user-viewer",
      "viewer@mazmi.demo",
      "Clara Ibáñez",
      "CI",
      "Responsable de Producción",
      "gray",
      "VIEWER",
    ],
  ] as const;
  for (const [id, email, name, initials, title, color, role] of userRows) {
    operations.push(
      insert(
        "users",
        [
          "id",
          "email",
          "full_name",
          "initials",
          "job_title",
          "avatar_color",
          "password_hash",
          "password_salt",
          "status",
          "last_login_at",
          "created_at",
          "updated_at",
        ],
        [
          id,
          email,
          name,
          initials,
          title,
          color,
          passwordHash,
          DEMO_SALT,
          "ACTIVE",
          null,
          NOW,
          NOW,
        ],
      ),
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
        [
          `membership-${id}`,
          ORGANIZATION_ID,
          id,
          role,
          MAIN_SITE_ID,
          "ACTIVE",
          NOW,
          NOW,
        ],
      ),
    );
  }

  const locations = [
    [MAIN_SITE_ID, "lev", null, "RAW", "Almacén de materias primas", "AREA"],
    [MAIN_SITE_ID, "lev", null, "PRINT", "Nave de impresión", "AREA"],
    [
      MAIN_SITE_ID,
      "lev",
      "PRINT",
      "PR-01",
      "Línea de impresión PR-01",
      "PRODUCTION_LINE",
    ],
    [
      MAIN_SITE_ID,
      "lev",
      "PRINT",
      "PR-02",
      "Línea de impresión PR-02",
      "PRODUCTION_LINE",
    ],
    [
      MAIN_SITE_ID,
      "lev",
      "PRINT",
      "PR-03",
      "Línea de impresión PR-03",
      "PRODUCTION_LINE",
    ],
    [MAIN_SITE_ID, "lev", null, "LAM", "Nave de laminación", "AREA"],
    [
      MAIN_SITE_ID,
      "lev",
      "LAM",
      "LM-01",
      "Línea de laminación LM-01",
      "PRODUCTION_LINE",
    ],
    [
      MAIN_SITE_ID,
      "lev",
      "LAM",
      "LM-02",
      "Línea de laminación LM-02",
      "PRODUCTION_LINE",
    ],
    [MAIN_SITE_ID, "lev", null, "COAT", "Área de coating", "AREA"],
    [
      MAIN_SITE_ID,
      "lev",
      "COAT",
      "CT-01",
      "Línea de coating CT-01",
      "PRODUCTION_LINE",
    ],
    [MAIN_SITE_ID, "lev", null, "SLIT", "Corte y rebobinado", "AREA"],
    [MAIN_SITE_ID, "lev", "SLIT", "SR-01", "Slitter SR-01", "PRODUCTION_LINE"],
    [MAIN_SITE_ID, "lev", "SLIT", "SR-02", "Slitter SR-02", "PRODUCTION_LINE"],
    [MAIN_SITE_ID, "lev", "SLIT", "SR-03", "Slitter SR-03", "PRODUCTION_LINE"],
    [MAIN_SITE_ID, "lev", null, "FG", "Almacén de producto terminado", "AREA"],
    [MAIN_SITE_ID, "lev", null, "UTIL", "Utilities", "UTILITY"],
    [MAIN_SITE_ID, "lev", "UTIL", "COMP", "Aire comprimido", "SYSTEM"],
    [MAIN_SITE_ID, "lev", "UTIL", "CHILL", "Agua fría de proceso", "SYSTEM"],
    [MAIN_SITE_ID, "lev", "UTIL", "VAC", "Vacío de proceso", "SYSTEM"],
    [MAIN_SITE_ID, "lev", "UTIL", "EXT", "Extracción industrial", "SYSTEM"],
    [MAIN_SITE_ID, "lev", null, "LAB", "Laboratorio de calidad", "LAB"],
    [MAIN_SITE_ID, "lev", null, "MAINT", "Taller de mantenimiento", "WORKSHOP"],
    [MAIN_SITE_ID, "lev", null, "MRO", "Almacén MRO", "WAREHOUSE"],
    [MAIN_SITE_ID, "lev", null, "GENERAL", "Instalaciones generales", "AREA"],
    [MAIN_SITE_ID, "lev", "GENERAL", "HVAC", "Climatización", "SYSTEM"],
    [
      MAIN_SITE_ID,
      "lev",
      "GENERAL",
      "ELEC",
      "Distribución eléctrica",
      "SYSTEM",
    ],
    [
      MAIN_SITE_ID,
      "lev",
      "GENERAL",
      "FIRE",
      "Protección contra incendios",
      "SYSTEM",
    ],
    [SECONDARY_SITE_ID, "alz", null, "SLIT", "Corte y rebobinado", "AREA"],
    [
      SECONDARY_SITE_ID,
      "alz",
      "SLIT",
      "SR-04",
      "Slitter SR-04",
      "PRODUCTION_LINE",
    ],
    [
      SECONDARY_SITE_ID,
      "alz",
      "SLIT",
      "SR-05",
      "Slitter SR-05",
      "PRODUCTION_LINE",
    ],
    [SECONDARY_SITE_ID, "alz", null, "UTIL", "Utilities", "UTILITY"],
    [SECONDARY_SITE_ID, "alz", null, "FG", "Producto terminado", "AREA"],
    [SECONDARY_SITE_ID, "alz", null, "LAB", "Laboratorio de control", "LAB"],
    [
      SECONDARY_SITE_ID,
      "alz",
      null,
      "GENERAL",
      "Instalaciones generales",
      "AREA",
    ],
  ] as const;
  for (let index = 0; index < locations.length; index += 1) {
    const [siteId, prefix, parentCode, code, name, type] = locations[index];
    operations.push(
      insert(
        "functional_locations",
        [
          "id",
          "organization_id",
          "site_id",
          "parent_id",
          "code",
          "name",
          "type",
          "description",
          "sort_order",
          "status",
          "created_at",
          "updated_at",
        ],
        [
          idFor(`loc-${prefix}`, code),
          ORGANIZATION_ID,
          siteId,
          parentCode ? idFor(`loc-${prefix}`, parentCode) : null,
          code,
          name,
          type,
          `Contexto funcional: ${name}.`,
          index,
          "ACTIVE",
          NOW,
          NOW,
        ],
      ),
    );
  }

  const classRows = [
    ["PRINT_LINE", "Línea de impresión", "Producción"],
    ["LAM_LINE", "Línea de laminación", "Producción"],
    ["COAT_LINE", "Línea de coating", "Producción"],
    ["SLITTER", "Slitter / rebobinadora", "Producción"],
    ["UNWINDER", "Desbobinador", "Handling de banda"],
    ["WINDER", "Bobinador", "Handling de banda"],
    ["ROLLER", "Rodillo / aplicador", "Mecánica"],
    ["DRYER", "Sistema de secado", "Térmico"],
    ["DRIVE", "Accionamiento", "Mecánica"],
    ["CONTROL", "Control / visión", "Automatización"],
    ["CUTTING", "Sistema de corte", "Mecánica"],
    ["COMPRESSOR", "Compresor", "Utilities"],
    ["CHILLER", "Chiller", "Utilities"],
    ["PUMP", "Bomba / grupo", "Utilities"],
    ["HVAC", "HVAC / extracción", "Utilities"],
    ["ELECTRICAL", "Sistema eléctrico", "Electricidad"],
    ["LAB", "Equipo de laboratorio", "Calidad"],
    ["FORKLIFT", "Carretilla", "Logística"],
    ["UTILITY", "Instalación auxiliar", "Utilities"],
    ["LOGISTICS", "Equipo logístico", "Logística"],
  ] as const;
  for (const [code, name, family] of classRows)
    operations.push(
      insert(
        "asset_classes",
        ["id", "organization_id", "code", "name", "family"],
        [idFor("class", code), ORGANIZATION_ID, code, name, family],
      ),
    );

  const vendorRows = [
    ["MOTIONEX", "Motionex Industrial", "Transmisión", 5],
    ["RODATEC", "Rodatec Servicios", "Mecánica", 8],
    ["ELECTROLEV", "ElectroLev Automation", "Electricidad", 6],
    ["AEROTEC", "Aerotec Levante", "Aire comprimido", 4],
    ["FILTRAMEC", "FiltraMec Levante", "Filtración", 7],
    ["SENSORA", "Sensora Industrial", "Instrumentación", 10],
    ["QUIMITEC", "Quimitec MRO", "Químicos", 3],
    ["TRANSFAB", "TransFab Service", "Servicio técnico", 12],
    ["PNEUMATIK", "Pneumatik Solutions", "Neumática", 5],
    ["TERMOPRO", "TermoPro Ingeniería", "Térmico", 14],
    ["FIXINGPRO", "FixingPro Suministros", "Ferretería", 2],
    ["CONTROLIA", "Controlia Systems", "Automatización", 9],
  ] as const;
  for (const [code, name, category, lead] of vendorRows)
    operations.push(
      insert(
        "vendors",
        [
          "id",
          "organization_id",
          "code",
          "name",
          "category",
          "email",
          "phone",
          "lead_time_days",
          "status",
          "created_at",
          "updated_at",
        ],
        [
          idFor("vendor", code),
          ORGANIZATION_ID,
          code,
          name,
          category,
          `servicio@${code.toLowerCase()}.demo`,
          `+34 96 555 ${String(1000 + Number(lead)).slice(-4)}`,
          lead,
          "ACTIVE",
          NOW,
          NOW,
        ],
      ),
    );

  const assets = buildAssets();
  for (const asset of assets) {
    operations.push(
      insert(
        "assets",
        [
          "id",
          "organization_id",
          "site_id",
          "functional_location_id",
          "parent_asset_id",
          "asset_class_id",
          "vendor_id",
          "code",
          "name",
          "description",
          "kind",
          "status",
          "criticality",
          "health_score",
          "manufacturer",
          "model",
          "serial_number",
          "commissioned_at",
          "warranty_until",
          "next_pm_at",
          "technical_summary",
          "created_at",
          "updated_at",
        ],
        [
          asset.id,
          ORGANIZATION_ID,
          asset.siteId,
          asset.locationId,
          asset.parentId,
          asset.classId,
          asset.vendorId,
          asset.code,
          asset.name,
          asset.description,
          asset.kind,
          asset.status,
          asset.criticality,
          asset.health,
          asset.manufacturer,
          asset.model,
          asset.serial,
          asset.commissioned,
          asset.warranty,
          asset.nextPm,
          asset.technical,
          NOW,
          NOW,
        ],
      ),
    );
  }

  const workOrders = buildWorkOrders(assets);
  for (let index = 0; index < workOrders.length; index += 1) {
    const order = workOrders[index];
    const statusHistory = buildWorkOrderStatusHistory(order);
    const statusUpdatedAt =
      statusHistory.at(-1)?.createdAt ?? order.requestedAt;
    const assignedAt =
      statusHistory.find((event) => event.toStatus === "ASSIGNED")?.createdAt ??
      order.plannedStart ??
      order.requestedAt;
    const laborEndedAt =
      order.actualStart && order.status !== "IN_PROGRESS"
        ? (order.actualEnd ?? statusHistory.at(-1)?.createdAt ?? null)
        : null;
    const laborMinutes =
      order.actualStart && laborEndedAt
        ? minutesBetween(order.actualStart, laborEndedAt)
        : 0;
    const completedAt = ["COMPLETED", "CLOSED"].includes(order.status)
      ? order.actualEnd
      : null;
    const closedAt =
      order.status === "CLOSED"
        ? (statusHistory.at(-1)?.createdAt ?? order.actualEnd)
        : null;
    const cancelledAt =
      order.status === "CANCELLED"
        ? (statusHistory.at(-1)?.createdAt ?? order.requestedAt)
        : null;
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
          order.asset.siteId,
          order.asset.id,
          order.asset.locationId,
          index % 4 === 0 ? "user-viewer" : "user-supervisor-mech",
          order.number,
          order.title,
          order.description,
          order.status,
          order.priority,
          order.type,
          order.source,
          order.requestedAt,
          order.dueAt,
          order.plannedStart,
          order.plannedEnd,
          order.actualStart,
          order.actualEnd,
          completedAt,
          closedAt,
          cancelledAt,
          order.estimatedMinutes,
          order.downtimeMinutes,
          order.diagnosis,
          order.solution,
          order.failureMode,
          order.failureCause,
          order.productionImpact,
          1,
          order.requestedAt,
          statusUpdatedAt,
        ],
      ),
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
          `assignment-${order.id}`,
          order.id,
          order.technicianId,
          "LEAD",
          assignedAt,
          null,
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
          `event-${order.id}-created`,
          order.id,
          "user-manager",
          "CREATED",
          null,
          "REQUESTED",
          "Orden registrada y clasificada.",
          order.requestedAt,
        ],
      ),
      {
        sql: "UPDATE work_orders SET requested_at = ?, due_at = ?, planned_start = ?, planned_end = ?, actual_start = ?, actual_end = ?, completed_at = ?, closed_at = ?, cancelled_at = ?, downtime_minutes = ?, updated_at = ? WHERE id = ?",
        params: [
          order.requestedAt,
          order.dueAt,
          order.plannedStart,
          order.plannedEnd,
          order.actualStart,
          order.actualEnd,
          completedAt,
          closedAt,
          cancelledAt,
          order.downtimeMinutes,
          statusUpdatedAt,
          order.id,
        ],
      },
      {
        sql: "UPDATE work_order_events SET created_at = ? WHERE id = ?",
        params: [order.requestedAt, `event-${order.id}-created`],
      },
      {
        sql: "UPDATE work_order_assignments SET user_id = ?, assigned_at = ?, unassigned_at = NULL WHERE id = ?",
        params: [order.technicianId, assignedAt, `assignment-${order.id}`],
      },
    );
    operations.push({
      sql: "DELETE FROM work_order_events WHERE work_order_id = ? AND id LIKE ?",
      params: [order.id, `event-${order.id}-status%`],
    });
    for (
      let transitionIndex = 0;
      transitionIndex < statusHistory.length;
      transitionIndex += 1
    ) {
      const event = statusHistory[transitionIndex];
      operations.push(
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
            `event-${order.id}-status-${String(transitionIndex + 1).padStart(2, "0")}`,
            order.id,
            index % 2 ? "user-planner" : "user-supervisor-mech",
            "STATUS_CHANGED",
            event.fromStatus,
            event.toStatus,
            event.note,
            event.createdAt,
          ],
        ),
      );
    }
    if (order.actualStart) {
      operations.push(
        insert(
          "labor_sessions",
          [
            "id",
            "work_order_id",
            "user_id",
            "started_at",
            "ended_at",
            "minutes",
            "status",
            "ended_by_id",
            "note",
          ],
          [
            `labor-${order.id}`,
            order.id,
            order.technicianId,
            order.actualStart,
            laborEndedAt,
            laborMinutes,
            laborEndedAt ? "STOPPED" : "ACTIVE",
            laborEndedAt ? order.technicianId : null,
            "Trabajo documentado desde la intervención.",
          ],
        ),
      );
      operations.push({
        sql: "UPDATE labor_sessions SET user_id = ?, started_at = ?, ended_at = ?, minutes = ?, status = ?, ended_by_id = ? WHERE id = ?",
        params: [
          order.technicianId,
          order.actualStart,
          laborEndedAt,
          laborMinutes,
          laborEndedAt ? "STOPPED" : "ACTIVE",
          laborEndedAt ? order.technicianId : null,
          `labor-${order.id}`,
        ],
      });
    }
  }

  const incidentRows = [
    [
      "lev-101",
      MAIN_SITE_ID,
      "PR-03-DRY",
      "Olor anómalo en cámara de secado de PR-03",
      "Se percibe olor a sobretemperatura al estabilizar velocidad.",
      "HIGH",
      "QUALITY_RISK",
      "NEW",
      "OPERATOR",
      null,
      null,
      null,
      -1,
    ],
    [
      "lev-102",
      MAIN_SITE_ID,
      "LM-02",
      "Oscilación de tensión de banda en LM-02",
      "La tensión varía durante la fase de aceleración.",
      "MEDIUM",
      "REDUCED_SPEED",
      "IN_TRIAGE",
      "CONDITION",
      "ELECTRICAL",
      "P3_HIGH",
      null,
      -2,
    ],
    [
      "lev-103",
      MAIN_SITE_ID,
      "COMP-02",
      "Diferencial alto en filtro de COMP-02",
      "Alarma repetitiva de presión diferencial en admisión.",
      "HIGH",
      "NO_IMPACT",
      "ACCEPTED",
      "INSPECTION",
      "PREVENTIVE",
      "P3_HIGH",
      null,
      -3,
    ],
    [
      "lev-104",
      MAIN_SITE_ID,
      "LM-02-APP",
      "Vibración creciente en rodillo aplicador LM-02",
      "La vibración aumenta al superar la velocidad nominal del lote.",
      "CRITICAL",
      "FULL_STOP",
      "CONVERTED",
      "OPERATOR",
      "CORRECTIVE",
      "P2_URGENT",
      "wo-001",
      -4,
    ],
    [
      "lev-105",
      MAIN_SITE_ID,
      "SR-02",
      "Ruido durante cambio de bobina en SR-02",
      "Hallazgo no reproducido tras inspección conjunta con producción.",
      "LOW",
      "NO_IMPACT",
      "REJECTED",
      "OPERATOR",
      "INSPECTION",
      "P5_LOW",
      null,
      -7,
    ],
    [
      "lev-106",
      MAIN_SITE_ID,
      "FL-01",
      "Aviso de batería baja en FL-01",
      "La batería se recuperó tras completar el ciclo de carga.",
      "LOW",
      "NO_IMPACT",
      "CLOSED",
      "SYSTEM",
      null,
      null,
      null,
      -8,
    ],
    [
      "lev-107",
      MAIN_SITE_ID,
      "PR-01-DRY",
      "Temperatura irregular en secado de PR-01",
      "Desviación de temperatura con riesgo sobre la calidad del material.",
      "CRITICAL",
      "QUALITY_RISK",
      "NEW",
      "CONDITION",
      null,
      null,
      null,
      0,
    ],
    [
      "lev-108",
      MAIN_SITE_ID,
      "SR-03-WND",
      "Holgura apreciable en eje de SR-03",
      "El operario detecta juego axial durante la preparación.",
      "HIGH",
      "REDUCED_SPEED",
      "ACCEPTED",
      "OPERATOR",
      "CORRECTIVE",
      "P2_URGENT",
      null,
      -1,
    ],
    [
      "lev-109",
      MAIN_SITE_ID,
      "PR-02-REG",
      "Pérdida intermitente de señal de registro PR-02",
      "El encoder presenta saltos de lectura durante aceleración.",
      "HIGH",
      "REDUCED_SPEED",
      "CONVERTED",
      "CONDITION",
      "CORRECTIVE",
      "P2_URGENT",
      "wo-007",
      -6,
    ],
    [
      "lev-110",
      MAIN_SITE_ID,
      "CH-01",
      "Tiempo elevado para alcanzar consigna en CH-01",
      "La impulsión térmica tarda más de lo habitual.",
      "MEDIUM",
      "NO_IMPACT",
      "IN_TRIAGE",
      "MAINTENANCE",
      "PREDICTIVE",
      "P3_HIGH",
      null,
      -2,
    ],
    [
      "alz-101",
      SECONDARY_SITE_ID,
      "SR-04",
      "Sensor de borde inestable en SR-04",
      "Correcciones frecuentes de guía durante el último lote.",
      "HIGH",
      "REDUCED_SPEED",
      "NEW",
      "OPERATOR",
      null,
      null,
      null,
      -1,
    ],
    [
      "alz-102",
      SECONDARY_SITE_ID,
      "FL-03",
      "Golpe leve en protector de FL-03",
      "Inspección realizada sin daño funcional; aviso cerrado.",
      "LOW",
      "NO_IMPACT",
      "CLOSED",
      "INSPECTION",
      null,
      null,
      null,
      -9,
    ],
  ] as const;
  const incidentPaths: Record<string, readonly string[]> = {
    NEW: ["NEW"],
    IN_TRIAGE: ["NEW", "IN_TRIAGE"],
    ACCEPTED: ["NEW", "IN_TRIAGE", "ACCEPTED"],
    REJECTED: ["NEW", "IN_TRIAGE", "REJECTED"],
    CONVERTED: ["NEW", "IN_TRIAGE", "ACCEPTED", "CONVERTED"],
    CLOSED: ["NEW", "CLOSED"],
  };
  for (const [
    key,
    siteId,
    assetCode,
    title,
    description,
    severity,
    impact,
    status,
    origin,
    classification,
    priority,
    workOrderId,
    dayOffset,
  ] of incidentRows) {
    const asset = assets.find((item) => item.code === assetCode)!;
    const id = `incident-${key}`;
    const number = `INC-${siteId === MAIN_SITE_ID ? "LEV" : "ALZ"}-2026-${key.slice(-3).padStart(4, "0")}`;
    const reportedAt = at(dayOffset, 7, Number(key.slice(-1)) * 4);
    const path = incidentPaths[status];
    const triagedAt = path.length > 1 ? addMinutes(reportedAt, 12) : null;
    const resolvedAt = ["REJECTED", "CONVERTED", "CLOSED"].includes(status)
      ? addMinutes(reportedAt, path.length * 14)
      : null;
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
          "triaged_at",
          "resolved_at",
          "version",
          "created_at",
          "updated_at",
        ],
        [
          id,
          ORGANIZATION_ID,
          siteId,
          asset.locationId,
          asset.id,
          key.endsWith("7") ? "user-viewer" : "user-supervisor-mech",
          number,
          title,
          description,
          severity,
          impact,
          status,
          origin,
          classification,
          priority,
          reportedAt,
          triagedAt,
          resolvedAt,
          path.length,
          reportedAt,
          resolvedAt ?? triagedAt ?? reportedAt,
        ],
      ),
      {
        sql: "UPDATE incidents SET number = ?, status = ?, classification = ?, triage_priority = ?, triaged_at = ?, resolved_at = ?, version = ?, updated_at = ? WHERE id = ?",
        params: [
          number,
          status,
          classification,
          priority,
          triagedAt,
          resolvedAt,
          path.length,
          resolvedAt ?? triagedAt ?? reportedAt,
          id,
        ],
      },
    );
    for (let eventIndex = 0; eventIndex < path.length; eventIndex += 1) {
      const toStatus = path[eventIndex];
      const fromStatus = eventIndex ? path[eventIndex - 1] : null;
      const eventAt = addMinutes(reportedAt, eventIndex * 14);
      operations.push(
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
            `incident-event-${key}-${eventIndex + 1}`,
            id,
            eventIndex ? "user-supervisor-mech" : "user-viewer",
            eventIndex === 0
              ? "INCIDENT_REPORTED"
              : toStatus === "CONVERTED"
                ? "INCIDENT_CONVERTED_TO_WORK_ORDER"
                : "INCIDENT_STATUS_CHANGED",
            fromStatus,
            toStatus,
            toStatus === "CONVERTED"
              ? "Convertida en orden de trabajo con trazabilidad de origen."
              : "Decisión operativa registrada.",
            eventAt,
          ],
        ),
      );
    }
    if (path.length > 1) {
      operations.push(
        insert(
          "incident_notes",
          ["id", "incident_id", "actor_id", "kind", "body", "created_at"],
          [
            `incident-note-${key}`,
            id,
            "user-supervisor-mech",
            "TRIAGE_DECISION",
            status === "REJECTED"
              ? "Hallazgo no reproducible; producción informada para seguimiento."
              : "Contexto, activo e impacto validados durante el triage.",
            addMinutes(reportedAt, 13),
          ],
        ),
      );
    }
    if (workOrderId) {
      operations.push({
        sql: "UPDATE work_orders SET incident_id = ?, source = 'REQUEST' WHERE id = ?",
        params: [id, workOrderId],
      });
    }
  }
  operations.push(
    {
      sql: "INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES ('sequence:inc:site-levante', '110', ?)",
      params: [NOW],
    },
    {
      sql: "INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES ('sequence:inc:site-alzira', '102', ?)",
      params: [NOW],
    },
  );

  for (let index = 0; index < 28; index += 1) {
    const order = workOrders[26 + index];
    operations.push(
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
          `downtime-${String(index + 1).padStart(3, "0")}`,
          ORGANIZATION_ID,
          order.asset.siteId,
          order.asset.id,
          order.asset.locationId,
          order.id,
          order.technicianId,
          order.actualEnd ? order.technicianId : null,
          order.actualStart ?? at(-index - 10),
          order.actualEnd,
          35 + (index % 9) * 13,
          index % 5 === 0 ? "PLANNED" : "UNPLANNED",
          index % 4 === 0 ? "FULL_STOP" : "REDUCED_SPEED",
          order.failureCause ?? "Intervención programada",
          order.requestedAt,
          order.actualEnd ?? NOW,
        ],
      ),
    );
    operations.push({
      sql: "UPDATE downtime_events SET functional_location_id = ?, created_by_id = ?, ended_by_id = ?, started_at = ?, ended_at = ?, duration_minutes = ?, kind = ?, production_impact = ?, updated_at = ? WHERE id = ?",
      params: [
        order.asset.locationId,
        order.technicianId,
        order.actualEnd ? order.technicianId : null,
        order.actualStart ?? at(-index - 10),
        order.actualEnd,
        order.downtimeMinutes,
        index % 5 === 0 ? "PLANNED" : "UNPLANNED",
        index % 4 === 0 ? "FULL_STOP" : "REDUCED_SPEED",
        order.actualEnd ?? NOW,
        `downtime-${String(index + 1).padStart(3, "0")}`,
      ],
    });
  }

  const activeDowntimeOrders = workOrders
    .slice(0, 26)
    .filter((order) => order.downtimeMinutes > 0);
  for (let index = 0; index < activeDowntimeOrders.length; index += 1) {
    const order = activeDowntimeOrders[index];
    const startedAt = order.actualStart ?? order.requestedAt;
    const calculatedEnd = new Date(
      new Date(startedAt).getTime() + order.downtimeMinutes * 60_000,
    ).toISOString();
    const isOpen = order.status === "IN_PROGRESS" && index === 0;
    const endedAt = isOpen ? null : calculatedEnd;
    const durationMinutes = isOpen ? 0 : order.downtimeMinutes;
    operations.push(
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
          `downtime-active-${String(index + 1).padStart(3, "0")}`,
          ORGANIZATION_ID,
          order.asset.siteId,
          order.asset.id,
          order.asset.locationId,
          order.id,
          order.technicianId,
          isOpen ? null : order.technicianId,
          startedAt,
          endedAt,
          durationMinutes,
          "UNPLANNED",
          order.productionImpact,
          order.failureCause ?? "Incidencia en diagnóstico",
          order.requestedAt,
          endedAt ?? NOW,
        ],
      ),
    );
    operations.push({
      sql: "UPDATE downtime_events SET functional_location_id = ?, created_by_id = ?, ended_by_id = ?, started_at = ?, ended_at = ?, duration_minutes = ?, production_impact = ?, cause = ?, updated_at = ? WHERE id = ?",
      params: [
        order.asset.locationId,
        order.technicianId,
        isOpen ? null : order.technicianId,
        startedAt,
        endedAt,
        durationMinutes,
        order.productionImpact,
        order.failureCause ?? "Incidencia en diagnóstico",
        endedAt ?? NOW,
        `downtime-active-${String(index + 1).padStart(3, "0")}`,
      ],
    });
  }

  const categoryRows = [
    ["BEAR", "Rodamientos"],
    ["DRIVE", "Transmisión mecánica"],
    ["SENSOR", "Sensórica"],
    ["ELECT", "Electricidad y control"],
    ["PNEU", "Neumática"],
    ["FILTER", "Filtración"],
    ["SEAL", "Juntas y estanqueidad"],
    ["LUBE", "Lubricación"],
    ["FAST", "Fijación"],
  ] as const;
  for (const [code, name] of categoryRows)
    operations.push(
      insert(
        "part_categories",
        ["id", "organization_id", "parent_id", "code", "name"],
        [idFor("category", code), ORGANIZATION_ID, null, code, name],
      ),
    );

  operations.push(
    insert(
      "warehouses",
      [
        "id",
        "organization_id",
        "site_id",
        "code",
        "name",
        "created_at",
        "updated_at",
      ],
      [
        "warehouse-lev-mro",
        ORGANIZATION_ID,
        MAIN_SITE_ID,
        "MRO-LEV",
        "Almacén MRO Levante",
        NOW,
        NOW,
      ],
    ),
  );
  for (let index = 0; index < 24; index += 1) {
    const aisle = String.fromCharCode(65 + Math.floor(index / 6));
    const position = String((index % 6) + 1).padStart(2, "0");
    operations.push(
      insert(
        "warehouse_bins",
        ["id", "warehouse_id", "code", "description", "status"],
        [
          `bin-lev-${String(index + 1).padStart(2, "0")}`,
          "warehouse-lev-mro",
          `MRO-${aisle}-01-${position}`,
          `Pasillo ${aisle}, módulo 01, posición ${position}`,
          "ACTIVE",
        ],
      ),
    );
  }

  const parts = buildParts();
  const reservableOrders = workOrders
    .slice(0, 26)
    .filter((order) =>
      [
        "PLANNED",
        "SCHEDULED",
        "ASSIGNED",
        "IN_PROGRESS",
        "PAUSED",
        "WAITING_PART",
        "WAITING_VENDOR",
      ].includes(order.status),
    );
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const vendorCodes = [
      "MOTIONEX",
      "RODATEC",
      "ELECTROLEV",
      "AEROTEC",
      "FILTRAMEC",
      "SENSORA",
      "QUIMITEC",
      "PNEUMATIK",
      "FIXINGPRO",
    ];
    const consumed =
      part.onHand === 0 ? Math.max(1, part.reorder) : index % 5 === 0 ? 1 : 0;
    const initialReceipt = part.onHand + consumed;
    operations.push(
      insert(
        "parts",
        [
          "id",
          "organization_id",
          "category_id",
          "sku",
          "name",
          "description",
          "unit",
          "manufacturer",
          "manufacturer_ref",
          "standard_cost",
          "currency",
          "status",
          "created_at",
          "updated_at",
        ],
        [
          part.id,
          ORGANIZATION_ID,
          part.categoryId,
          part.sku,
          part.name,
          part.description,
          part.unit,
          part.manufacturer,
          part.manufacturerRef,
          part.cost,
          "EUR",
          "ACTIVE",
          at(-500 + index),
          NOW,
        ],
      ),
      insert(
        "part_site_policies",
        [
          "id",
          "part_id",
          "site_id",
          "primary_vendor_id",
          "critical",
          "min_stock",
          "max_stock",
          "reorder_point",
          "lead_time_days",
          "average_cost",
        ],
        [
          `policy-${part.id}`,
          part.id,
          MAIN_SITE_ID,
          idFor("vendor", vendorCodes[index % vendorCodes.length]),
          part.critical,
          part.min,
          part.max,
          part.reorder,
          part.leadTime,
          part.cost,
        ],
      ),
      insert(
        "stock_levels",
        [
          "id",
          "part_id",
          "site_id",
          "bin_id",
          "on_hand",
          "reserved",
          "on_order",
          "version",
          "updated_at",
        ],
        [
          `stock-${part.id}`,
          part.id,
          MAIN_SITE_ID,
          part.binId,
          part.onHand,
          part.reserved,
          part.onOrder,
          1,
          NOW,
        ],
      ),
      insert(
        "inventory_movements",
        [
          "id",
          "organization_id",
          "site_id",
          "part_id",
          "bin_id",
          "work_order_id",
          "actor_id",
          "movement_type",
          "reference",
          "reason",
          "delta_on_hand",
          "delta_reserved",
          "delta_on_order",
          "unit_cost",
          "occurred_at",
          "created_at",
        ],
        [
          `movement-${part.id}-receipt`,
          ORGANIZATION_ID,
          MAIN_SITE_ID,
          part.id,
          part.binId,
          null,
          "user-warehouse",
          "RECEIPT",
          `REC-2025-${String(1000 + index)}`,
          "Recepción de stock inicial trazable",
          initialReceipt,
          0,
          0,
          part.cost,
          at(-150 + (index % 80)),
          at(-150 + (index % 80)),
        ],
      ),
    );
    operations.push({
      sql: "UPDATE inventory_movements SET delta_on_hand = ?, unit_cost = ? WHERE id = ?",
      params: [initialReceipt, part.cost, `movement-${part.id}-receipt`],
    });
    operations.push(
      {
        sql: "UPDATE part_site_policies SET critical = ?, min_stock = ?, max_stock = ?, reorder_point = ?, lead_time_days = ?, average_cost = ? WHERE id = ?",
        params: [
          part.critical,
          part.min,
          part.max,
          part.reorder,
          part.leadTime,
          part.cost,
          `policy-${part.id}`,
        ],
      },
      {
        sql: "UPDATE stock_levels SET on_hand = ?, reserved = ?, on_order = ?, updated_at = ? WHERE id = ?",
        params: [
          part.onHand,
          part.reserved,
          part.onOrder,
          NOW,
          `stock-${part.id}`,
        ],
      },
    );
    if (consumed) {
      const order = workOrders[26 + (index % 35)];
      const consumedAt = order.actualEnd ?? addMinutes(order.requestedAt, 60);
      operations.push(
        insert(
          "inventory_movements",
          [
            "id",
            "organization_id",
            "site_id",
            "part_id",
            "bin_id",
            "work_order_id",
            "actor_id",
            "movement_type",
            "reference",
            "reason",
            "delta_on_hand",
            "delta_reserved",
            "delta_on_order",
            "unit_cost",
            "occurred_at",
            "created_at",
          ],
          [
            `movement-${part.id}-consumption`,
            ORGANIZATION_ID,
            MAIN_SITE_ID,
            part.id,
            part.binId,
            order.id,
            order.technicianId,
            "CONSUMPTION",
            order.number,
            "Consumo documentado en intervención",
            -consumed,
            0,
            0,
            part.cost,
            consumedAt,
            consumedAt,
          ],
        ),
        insert(
          "work_order_part_usages",
          [
            "id",
            "work_order_id",
            "part_id",
            "movement_id",
            "quantity",
            "unit_cost_snapshot",
            "total_cost",
            "created_at",
          ],
          [
            `usage-${part.id}`,
            order.id,
            part.id,
            `movement-${part.id}-consumption`,
            consumed,
            part.cost,
            part.cost * consumed,
            consumedAt,
          ],
        ),
        {
          sql: "UPDATE inventory_movements SET work_order_id = ?, actor_id = ?, reference = ?, delta_on_hand = ?, delta_reserved = 0, delta_on_order = 0, unit_cost = ?, occurred_at = ?, created_at = ? WHERE id = ?",
          params: [
            order.id,
            order.technicianId,
            order.number,
            -consumed,
            part.cost,
            consumedAt,
            consumedAt,
            `movement-${part.id}-consumption`,
          ],
        },
        {
          sql: "UPDATE work_order_part_usages SET work_order_id = ?, movement_id = ?, quantity = ?, unit_cost_snapshot = ?, total_cost = ?, created_at = ? WHERE id = ?",
          params: [
            order.id,
            `movement-${part.id}-consumption`,
            consumed,
            part.cost,
            part.cost * consumed,
            consumedAt,
            `usage-${part.id}`,
          ],
        },
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
            `material-consumed-${part.id}`,
            order.id,
            part.id,
            part.binId,
            consumed,
            0,
            consumed,
            0,
            "user-planner",
            1,
            order.requestedAt,
            consumedAt,
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
            `event-${order.id}-consumed-${part.id}`,
            order.id,
            order.technicianId,
            "PART_CONSUMED",
            null,
            null,
            `${part.sku} × ${consumed} ${part.unit} consumido con coste histórico.`,
            consumedAt,
          ],
        ),
      );
    }
    if (part.reserved > 0) {
      const order = reservableOrders[index % reservableOrders.length];
      const reservationAt = new Date(
        Math.max(
          new Date(order.requestedAt).getTime(),
          Math.min(
            new Date(order.plannedStart ?? order.dueAt).getTime(),
            new Date(order.requestedAt).getTime() + 45 * 60_000,
          ),
        ),
      ).toISOString();
      operations.push(
        insert(
          "inventory_movements",
          [
            "id",
            "organization_id",
            "site_id",
            "part_id",
            "bin_id",
            "work_order_id",
            "actor_id",
            "movement_type",
            "reference",
            "reason",
            "delta_on_hand",
            "delta_reserved",
            "delta_on_order",
            "unit_cost",
            "occurred_at",
            "created_at",
          ],
          [
            `movement-${part.id}-reserve`,
            ORGANIZATION_ID,
            MAIN_SITE_ID,
            part.id,
            part.binId,
            order.id,
            "user-warehouse",
            "RESERVE",
            order.number,
            "Reserva para orden planificada",
            0,
            part.reserved,
            0,
            part.cost,
            reservationAt,
            reservationAt,
          ],
        ),
        {
          sql: "UPDATE inventory_movements SET work_order_id = ?, reference = ?, delta_on_hand = 0, delta_reserved = ?, delta_on_order = 0, unit_cost = ?, occurred_at = ?, created_at = ? WHERE id = ?",
          params: [
            order.id,
            order.number,
            part.reserved,
            part.cost,
            reservationAt,
            reservationAt,
            `movement-${part.id}-reserve`,
          ],
        },
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
            `material-reserved-${part.id}`,
            order.id,
            part.id,
            part.binId,
            part.reserved,
            part.reserved,
            0,
            0,
            "user-planner",
            1,
            order.requestedAt,
            reservationAt,
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
            `event-${order.id}-reserved-${part.id}`,
            order.id,
            "user-warehouse",
            "PART_RESERVED",
            null,
            null,
            `${part.sku} × ${part.reserved} ${part.unit} reservado.`,
            reservationAt,
          ],
        ),
      );
    }
    if (part.onOrder > 0) {
      operations.push(
        insert(
          "inventory_movements",
          [
            "id",
            "organization_id",
            "site_id",
            "part_id",
            "bin_id",
            "work_order_id",
            "actor_id",
            "movement_type",
            "reference",
            "reason",
            "delta_on_hand",
            "delta_reserved",
            "delta_on_order",
            "unit_cost",
            "occurred_at",
            "created_at",
          ],
          [
            `movement-${part.id}-order`,
            ORGANIZATION_ID,
            MAIN_SITE_ID,
            part.id,
            part.binId,
            null,
            "user-warehouse",
            "ORDER",
            `PO-2026-${String(700 + index)}`,
            "Pedido de reposición aprobado",
            0,
            0,
            part.onOrder,
            part.cost,
            at(-3 + (index % 4)),
            at(-3 + (index % 4)),
          ],
        ),
      );
    }
  }

  for (let index = 0; index < 160; index += 1) {
    const asset =
      assets[
        index % assets.filter((item) => item.siteId === MAIN_SITE_ID).length
      ];
    const part = parts[(index * 11 + Math.floor(index / 3)) % parts.length];
    operations.push(
      insert(
        "asset_part_compatibilities",
        [
          "id",
          "asset_id",
          "part_id",
          "relation",
          "recommended_quantity",
          "note",
        ],
        [
          `compat-${String(index + 1).padStart(3, "0")}`,
          asset.id,
          part.id,
          index % 7 === 0 ? "PREFERRED" : "COMPATIBLE",
          1 + (index % 3),
          index % 7 === 0
            ? "Alternativa preferente validada por mantenimiento."
            : null,
        ],
      ),
    );
  }

  const unavailableParts = parts.filter(
    (part) => part.onHand - part.reserved === 0,
  );
  const criticalUnavailableParts = unavailableParts.filter(
    (part) => part.critical === 1,
  );
  const todayKey = NOW.slice(0, 10);
  const preventiveToday = workOrders.filter(
    (order) =>
      order.type === "PREVENTIVE" &&
      order.plannedStart?.slice(0, 10) === todayKey &&
      !["COMPLETED", "CLOSED", "CANCELLED"].includes(order.status),
  );
  const overdueUrgent = workOrders.find(
    (order) =>
      order.priority === "P2_URGENT" &&
      new Date(order.dueAt).getTime() < ANCHOR.getTime() &&
      !["COMPLETED", "CLOSED", "CANCELLED"].includes(order.status),
  )!;
  const overdueDate = new Date(overdueUrgent.dueAt);
  const overdueDateLabel = [
    String(overdueDate.getUTCDate()).padStart(2, "0"),
    String(overdueDate.getUTCMonth() + 1).padStart(2, "0"),
    overdueDate.getUTCFullYear(),
  ].join("/");
  const planningDate = new Date(NOW);
  const planningDateLabel = [
    String(planningDate.getUTCDate()).padStart(2, "0"),
    String(planningDate.getUTCMonth() + 1).padStart(2, "0"),
    planningDate.getUTCFullYear(),
  ].join("/");
  const notifications = [
    [
      "Riesgo alto en LM-02",
      "El health score del rodillo aplicador ha bajado a 52.",
      "CRITICAL",
      "ASSET",
      idFor("asset", "LM-02-APP"),
    ],
    [
      "OT urgente fuera de plazo",
      `${overdueUrgent.number} venció el ${overdueDateLabel} y requiere seguimiento.`,
      "WARNING",
      "WORK_ORDER",
      overdueUrgent.id,
    ],
    [
      `${unavailableParts.length} referencias sin stock disponible`,
      `${criticalUnavailableParts.length} de ellas son repuestos críticos bajo reposición.`,
      "WARNING",
      "INVENTORY",
      null,
    ],
    [
      `Plan preventivo · ${planningDateLabel}`,
      `${preventiveToday.length} ${preventiveToday.length === 1 ? "trabajo preventivo está programado" : "trabajos preventivos están programados"} para el ${planningDateLabel}.`,
      "INFO",
      "WORK_ORDER",
      preventiveToday[0]?.id ?? null,
    ],
  ] as const;
  for (let index = 0; index < notifications.length; index += 1) {
    const [title, body, severity, entityType, entityId] = notifications[index];
    operations.push(
      insert(
        "notifications",
        [
          "id",
          "organization_id",
          "site_id",
          "user_id",
          "title",
          "body",
          "severity",
          "entity_type",
          "entity_id",
          "read_at",
          "created_at",
        ],
        [
          `notification-${index + 1}`,
          ORGANIZATION_ID,
          MAIN_SITE_ID,
          "user-manager",
          title,
          body,
          severity,
          entityType,
          entityId,
          null,
          at(0, 7, index * 9),
        ],
      ),
    );
    operations.push({
      sql: "UPDATE notifications SET organization_id = ?, site_id = ?, title = ?, body = ?, severity = ?, entity_type = ?, entity_id = ?, created_at = ? WHERE id = ?",
      params: [
        ORGANIZATION_ID,
        MAIN_SITE_ID,
        title,
        body,
        severity,
        entityType,
        entityId,
        at(0, 7, index * 9),
        `notification-${index + 1}`,
      ],
    });
  }
  operations.push(
    insert(
      "notifications",
      [
        "id",
        "organization_id",
        "site_id",
        "user_id",
        "title",
        "body",
        "severity",
        "entity_type",
        "entity_id",
        "read_at",
        "created_at",
      ],
      [
        "notification-incident-lev",
        ORGANIZATION_ID,
        MAIN_SITE_ID,
        "user-manager",
        "Nueva incidencia crítica",
        "INC-LEV-2026-0107 · Temperatura irregular en secado de PR-01",
        "CRITICAL",
        "INCIDENT",
        "incident-lev-107",
        null,
        at(0, 7, 32),
      ],
    ),
    insert(
      "notifications",
      [
        "id",
        "organization_id",
        "site_id",
        "user_id",
        "title",
        "body",
        "severity",
        "entity_type",
        "entity_id",
        "read_at",
        "created_at",
      ],
      [
        "notification-incident-alz",
        ORGANIZATION_ID,
        SECONDARY_SITE_ID,
        "user-manager",
        "Incidencia prioritaria en SR-04",
        "INC-ALZ-2026-0101 · Sensor de borde inestable",
        "WARNING",
        "INCIDENT",
        "incident-alz-101",
        null,
        at(-1, 8, 4),
      ],
    ),
  );

  for (let index = 0; index < 60; index += 1) {
    const order = workOrders[index % workOrders.length];
    const lastTransition = buildWorkOrderStatusHistory(order).at(-1);
    const isPriorityChange = index % 4 === 0 || !lastTransition;
    operations.push(
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
          `audit-${String(index + 1).padStart(3, "0")}`,
          ORGANIZATION_ID,
          MAIN_SITE_ID,
          index % 3 === 0 ? "user-manager" : "user-planner",
          isPriorityChange ? "PRIORITY_CHANGED" : "STATUS_CHANGED",
          "WORK_ORDER",
          order.id,
          isPriorityChange
            ? '{"priority":"P4_NORMAL"}'
            : `{"status":"${lastTransition!.fromStatus}"}`,
          isPriorityChange
            ? `{"priority":"${order.priority}"}`
            : `{"status":"${lastTransition!.toStatus}"}`,
          `seed-${index + 1}`,
          lastTransition?.createdAt ?? order.requestedAt,
        ],
      ),
    );
  }

  await executeInChunks(db, operations);
  await db
    .prepare(
      "INSERT OR REPLACE INTO system_state (key,value,updated_at) VALUES ('demo_seed_v1a_2','complete',?)",
    )
    .bind(NOW)
    .run();
  await db.prepare("PRAGMA optimize").run();
}

export const demoCredentials = {
  email: "responsable@mazmi.demo",
  password: DEMO_PASSWORD,
};
