export const statusLabels: Record<string, string> = {
  NEW: "Nueva",
  IN_TRIAGE: "En triage",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  CONVERTED: "Convertida en OT",
  REQUESTED: "Solicitada",
  TRIAGE: "Triage",
  APPROVED: "Aprobada",
  PLANNED: "Planificada",
  SCHEDULED: "Programada",
  ASSIGNED: "Asignada",
  IN_PROGRESS: "En progreso",
  PAUSED: "Pausada",
  WAITING_PART: "Esperando recambio",
  WAITING_VENDOR: "Esperando proveedor",
  COMPLETED: "Completada",
  CLOSED: "Cerrada",
  CANCELLED: "Cancelada",
  OPERATING: "Operativo",
  DEGRADED: "Degradado",
  DOWN: "Parado",
  MAINTENANCE: "En mantenimiento",
  STANDBY: "En espera",
  RETIRED: "Retirado",
  ACTIVE: "Activo",
  INACTIVE: "Inactivo",
  DRAFT: "Borrador",
  INVESTIGATING: "Investigando",
  ACTIONS_DEFINED: "Acciones definidas",
  VERIFICATION: "En verificación",
  OPEN: "Abierta",
  DONE: "Completada",
  SUBMITTED: "Enviada",
  SENT: "Enviado",
  PARTIALLY_RECEIVED: "Recepción parcial",
  RECEIVED: "Recibido",
  CREATED: "Creada",
  IN_TRANSIT: "En tránsito",
  POSTED: "Contabilizada",
};

export const reliabilityPatternLabels: Record<string, string> = {
  GROWING: "Creciente",
  RECURRENT: "Recurrente",
  STABLE: "Estable",
  ISOLATED: "Aislado",
};

export const rcaActionTypeLabels: Record<string, string> = {
  CREATE_WORK_ORDER: "Crear OT",
  UPDATE_MAINTENANCE_PLAN: "Revisar plan preventivo",
  INSPECTION: "Inspección",
  TRAINING: "Formación",
  TECHNICAL_CHANGE: "Cambio técnico",
};

export const incidentOriginLabels: Record<string, string> = {
  OPERATOR: "Operario",
  MAINTENANCE: "Mantenimiento",
  INSPECTION: "Inspección",
  CONDITION: "Condición",
  SYSTEM: "Sistema",
};

export const incidentImpactLabels: Record<string, string> = {
  FULL_STOP: "Producción detenida",
  REDUCED_SPEED: "Producción degradada",
  QUALITY_RISK: "Riesgo de calidad",
  SAFETY_RISK: "Riesgo de seguridad",
  NO_IMPACT: "Sin impacto productivo",
  UNKNOWN: "Impacto por confirmar",
};

export const priorityLabels: Record<string, string> = {
  P1_EMERGENCY: "P1 · Emergencia",
  P2_URGENT: "P2 · Urgente",
  P3_HIGH: "P3 · Alta",
  P4_NORMAL: "P4 · Normal",
  P5_LOW: "P5 · Baja",
};

export const typeLabels: Record<string, string> = {
  CORRECTIVE: "Correctivo",
  PREVENTIVE: "Preventivo",
  INSPECTION: "Inspección",
  PREDICTIVE: "Predictivo",
  CALIBRATION: "Calibración",
  IMPROVEMENT: "Mejora",
};

export const criticalityLabels: Record<string, string> = {
  CRITICAL: "Crítica",
  HIGH: "Alta",
  MEDIUM: "Media",
  LOW: "Baja",
};

export const movementLabels: Record<string, string> = {
  RECEIPT: "Recepción",
  ISSUE: "Salida",
  RESERVE: "Reserva",
  RELEASE: "Liberación",
  TRANSFER: "Transferencia",
  ADJUSTMENT: "Ajuste",
  RETURN: "Devolución",
  ORDER: "En pedido",
  CONSUMPTION: "Consumo",
};

export const failureModeLabels: Record<string, string> = {
  VIBRATION: "Vibración",
  LEAKAGE: "Fuga",
  OVERHEATING: "Sobretemperatura",
  SIGNAL_LOSS: "Pérdida de señal",
};

export const failureCauseLabels: Record<string, string> = {
  WEAR: "Desgaste",
  CONTAMINATION: "Contaminación",
  MISALIGNMENT: "Desalineación",
  LOOSE_CONNECTION: "Conexión floja",
};

export const productionImpactLabels: Record<string, string> = {
  FULL_STOP: "Parada total",
  REDUCED_SPEED: "Velocidad reducida",
  NO_IMPACT: "Sin impacto productivo",
  NONE: "Sin impacto productivo",
  MICROSTOP: "Microparada",
};

export const workOrderEventLabels: Record<string, string> = {
  CREATED: "Orden creada",
  CREATED_FROM_INCIDENT: "Creada desde incidencia",
  STATUS_CHANGED: "Estado actualizado",
  WORK_ORDER_ASSIGNED: "Técnico asignado",
  WORK_ORDER_SCHEDULED: "Trabajo programado",
  WORK_STARTED: "Trabajo iniciado",
  WORK_PAUSED: "Trabajo pausado",
  WORK_RESUMED: "Trabajo reanudado",
  LABOR_SESSION_STOPPED: "Sesión de trabajo finalizada",
  WAITING_FOR_PART: "Esperando recambio",
  WAITING_FOR_VENDOR: "Esperando proveedor",
  PART_PLANNED: "Material previsto",
  PART_RESERVED: "Recambio reservado",
  PART_RELEASED: "Reserva liberada",
  PART_CONSUMED: "Recambio consumido",
  PART_RETURNED: "Recambio devuelto",
  DOWNTIME_STARTED: "Downtime iniciado",
  DOWNTIME_ENDED: "Downtime finalizado",
  WORK_COMPLETED: "Intervención completada",
  WORK_ORDER_CLOSED: "Orden cerrada",
  WORK_ORDER_CANCELLED: "Orden cancelada",
  PRIORITY_CHANGED: "Prioridad actualizada",
  PREVENTIVE_WORK_ORDER_GENERATED: "OT preventiva generada",
  WORK_ORDER_REPLANNED: "Trabajo replanificado",
  PURCHASE_REQUISITION_CREATED: "Requisición de compra creada",
  PART_RECEIVED: "Recambio recibido",
  SAFETY_ACKNOWLEDGED: "Seguridad confirmada",
  CHECKLIST_TASK_RECORDED: "Paso de checklist registrado",
  MEASUREMENT_RECORDED: "Medición registrada",
  EVIDENCE_ADDED: "Evidencia añadida",
  SHIFT_HANDOVER_RECORDED: "Incluida en relevo de turno",
};

export const preventiveTriggerLabels: Record<string, string> = {
  CALENDAR: "Calendario",
  METER: "Contador",
  WHICHEVER_FIRST: "Lo que ocurra primero",
};

export const calendarUnitLabels: Record<string, string> = {
  DAY: "días",
  WEEK: "semanas",
  MONTH: "meses",
};

const DEFAULT_PLANT_TIME_ZONE = "Europe/Madrid";

export function formatDate(
  value: string | null,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(
    "es-ES",
    options
      ? { timeZone: DEFAULT_PLANT_TIME_ZONE, ...options }
      : {
          timeZone: DEFAULT_PLANT_TIME_ZONE,
          day: "2-digit",
          month: "short",
          year: "numeric",
        },
  ).format(new Date(value));
}

export function formatDateTime(
  value: string | null,
  timeZone = DEFAULT_PLANT_TIME_ZONE,
): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

export function dateKeyInTimeZone(
  value: Date | string,
  timeZone = "Europe/Madrid",
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatDuration(minutes: number): string {
  const rounded = Math.max(0, Math.round(Number(minutes)));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(Number(value));
}

export function dueLabel(value: string | null): {
  text: string;
  overdue: boolean;
} {
  if (!value) return { text: "Sin vencimiento", overdue: false };
  const date = new Date(value);
  const today = new Date();
  const days = Math.ceil((date.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { text: `${Math.abs(days)} d vencida`, overdue: true };
  if (days === 0) return { text: "Vence hoy", overdue: false };
  if (days === 1) return { text: "Vence mañana", overdue: false };
  return { text: `En ${days} días`, overdue: false };
}
