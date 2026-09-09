import { DomainInvariantError } from "./errors";

export const checklistResponseTypes = [
  "CHECKBOX",
  "CONFIRMATION",
  "TEXT",
  "NUMBER",
  "READING",
  "PASS_FAIL",
] as const;

export type ChecklistResponseType = (typeof checklistResponseTypes)[number];

export function evaluateChecklistResponse(input: {
  type: ChecklistResponseType;
  value: string | number | boolean;
  required: boolean;
  minimumValue?: number | null;
  maximumValue?: number | null;
}): {
  value: string;
  status: "COMPLETED" | "PASS" | "FAIL";
  satisfiesRequirement: boolean;
} {
  if (input.type === "CHECKBOX" || input.type === "CONFIRMATION") {
    const checked = input.value === true || input.value === "true";
    if (input.required && !checked) {
      throw new DomainInvariantError(
        "CHECKLIST_CONFIRMATION_REQUIRED",
        "Confirma este paso obligatorio antes de continuar.",
      );
    }
    return {
      value: checked ? "true" : "false",
      status: "COMPLETED",
      satisfiesRequirement: checked || !input.required,
    };
  }

  if (input.type === "TEXT") {
    const value = String(input.value).trim();
    if (input.required && !value) {
      throw new DomainInvariantError(
        "CHECKLIST_VALUE_REQUIRED",
        "Este paso necesita una respuesta.",
      );
    }
    return { value, status: "COMPLETED", satisfiesRequirement: true };
  }

  if (input.type === "PASS_FAIL") {
    const value = String(input.value).toUpperCase();
    if (value !== "PASS" && value !== "FAIL") {
      throw new DomainInvariantError(
        "INVALID_CHECKLIST_RESULT",
        "Indica si la comprobación es conforme o no conforme.",
      );
    }
    return {
      value,
      status: value,
      satisfiesRequirement: value === "PASS" || !input.required,
    };
  }

  const numeric = Number(input.value);
  if (!Number.isFinite(numeric)) {
    throw new DomainInvariantError(
      "INVALID_MEASUREMENT",
      "Introduce un valor numérico válido.",
    );
  }
  const inRange =
    (input.minimumValue == null || numeric >= input.minimumValue) &&
    (input.maximumValue == null || numeric <= input.maximumValue);
  return {
    value: String(numeric),
    status: inRange ? "PASS" : "FAIL",
    satisfiesRequirement: inRange || !input.required,
  };
}

export function evaluateMeasurement(input: {
  value: number;
  unit: string;
  expectedUnit?: string | null;
  minimumValue?: number | null;
  maximumValue?: number | null;
}): "IN_RANGE" | "OUT_OF_RANGE" | "INFORMATIONAL" {
  if (!Number.isFinite(input.value)) {
    throw new DomainInvariantError(
      "INVALID_MEASUREMENT",
      "La medición debe contener un valor numérico válido.",
    );
  }
  if (!input.unit.trim()) {
    throw new DomainInvariantError(
      "MEASUREMENT_UNIT_REQUIRED",
      "La medición debe indicar su unidad.",
    );
  }
  if (
    input.expectedUnit &&
    input.expectedUnit.trim().toLowerCase() !== input.unit.trim().toLowerCase()
  ) {
    throw new DomainInvariantError(
      "MEASUREMENT_UNIT_MISMATCH",
      `La unidad esperada es ${input.expectedUnit}.`,
    );
  }
  if (
    input.minimumValue != null &&
    input.maximumValue != null &&
    input.maximumValue < input.minimumValue
  ) {
    throw new DomainInvariantError(
      "INVALID_MEASUREMENT_RANGE",
      "El rango configurado de la medición no es válido.",
    );
  }
  if (input.minimumValue == null && input.maximumValue == null) {
    return "INFORMATIONAL";
  }
  return (input.minimumValue == null || input.value >= input.minimumValue) &&
    (input.maximumValue == null || input.value <= input.maximumValue)
    ? "IN_RANGE"
    : "OUT_OF_RANGE";
}

export function normalizeScanCode(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
  if (normalized.length < 4 || normalized.length > 80) {
    throw new DomainInvariantError(
      "INVALID_SCAN_CODE",
      "El identificador del activo no tiene un formato válido.",
    );
  }
  return normalized;
}

export function assertEvidenceInput(input: {
  kind: "PHOTO" | "DOCUMENT" | "NOTE";
  description: string;
  sizeBytes?: number | null;
  contentType?: string | null;
}): void {
  if (!input.description.trim()) {
    throw new DomainInvariantError(
      "EVIDENCE_DESCRIPTION_REQUIRED",
      "Describe brevemente la evidencia.",
    );
  }
  if (input.kind !== "NOTE") {
    if (
      !input.sizeBytes ||
      input.sizeBytes <= 0 ||
      input.sizeBytes > 8_000_000
    ) {
      throw new DomainInvariantError(
        "INVALID_EVIDENCE_SIZE",
        "El archivo debe pesar entre 1 byte y 8 MB.",
      );
    }
    const contentType = input.contentType?.toLowerCase() ?? "";
    const allowed =
      input.kind === "PHOTO"
        ? contentType.startsWith("image/")
        : ["application/pdf", "text/plain"].includes(contentType);
    if (!allowed) {
      throw new DomainInvariantError(
        "INVALID_EVIDENCE_TYPE",
        "El tipo de archivo no está permitido para esta evidencia.",
      );
    }
  }
}

export function assertHandover(input: {
  fromShift: string;
  toShift: string;
  summary: string;
}): void {
  if (!input.fromShift.trim() || !input.toShift.trim()) {
    throw new DomainInvariantError(
      "HANDOVER_SHIFT_REQUIRED",
      "Indica el turno de origen y el turno receptor.",
    );
  }
  if (input.fromShift.trim() === input.toShift.trim()) {
    throw new DomainInvariantError(
      "HANDOVER_SHIFT_UNCHANGED",
      "El relevo debe dirigirse a un turno diferente.",
    );
  }
  if (input.summary.trim().length < 5) {
    throw new DomainInvariantError(
      "HANDOVER_SUMMARY_REQUIRED",
      "Resume el estado operativo para el siguiente turno.",
    );
  }
}
