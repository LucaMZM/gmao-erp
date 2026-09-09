import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "@/lib/domain/errors";
import {
  assertEvidenceInput,
  assertHandover,
  evaluateChecklistResponse,
  evaluateMeasurement,
  normalizeScanCode,
} from "@/lib/domain/field";
import { assertPermission } from "@/lib/domain/permissions";
import { assertCanCompleteWorkOrder } from "@/lib/domain/work-orders";

describe("field checklist invariants", () => {
  it("persists required confirmations only when explicitly accepted", () => {
    expect(
      evaluateChecklistResponse({
        type: "CONFIRMATION",
        value: true,
        required: true,
      }),
    ).toEqual({
      value: "true",
      status: "COMPLETED",
      satisfiesRequirement: true,
    });
    expect(() =>
      evaluateChecklistResponse({
        type: "CONFIRMATION",
        value: false,
        required: true,
      }),
    ).toThrowError(/Confirma este paso/);
  });

  it("requires content for mandatory text observations", () => {
    expect(() =>
      evaluateChecklistResponse({ type: "TEXT", value: "  ", required: true }),
    ).toThrowError(DomainInvariantError);
    expect(
      evaluateChecklistResponse({
        type: "TEXT",
        value: "Sin holgura visible",
        required: true,
      }),
    ).toMatchObject({ status: "COMPLETED", satisfiesRequirement: true });
  });

  it("keeps a mandatory failed check from satisfying completion", () => {
    expect(
      evaluateChecklistResponse({
        type: "PASS_FAIL",
        value: "FAIL",
        required: true,
      }),
    ).toEqual({ value: "FAIL", status: "FAIL", satisfiesRequirement: false });
  });

  it("evaluates numeric steps against their configured range", () => {
    expect(
      evaluateChecklistResponse({
        type: "READING",
        value: 3.2,
        required: true,
        minimumValue: 0,
        maximumValue: 4.5,
      }),
    ).toMatchObject({ status: "PASS", satisfiesRequirement: true });
    expect(
      evaluateChecklistResponse({
        type: "NUMBER",
        value: 81,
        required: true,
        maximumValue: 70,
      }),
    ).toMatchObject({ status: "FAIL", satisfiesRequirement: false });
  });
});

describe("field measurement and evidence invariants", () => {
  it("classifies measured values without inventing thresholds", () => {
    expect(evaluateMeasurement({ value: 4.2, unit: "mm/s" })).toBe(
      "INFORMATIONAL",
    );
    expect(
      evaluateMeasurement({ value: 4.2, unit: "mm/s", maximumValue: 4.5 }),
    ).toBe("IN_RANGE");
    expect(
      evaluateMeasurement({ value: 5.1, unit: "mm/s", maximumValue: 4.5 }),
    ).toBe("OUT_OF_RANGE");
  });

  it("rejects mismatched units and invalid configured ranges", () => {
    expect(() =>
      evaluateMeasurement({ value: 2, unit: "bar", expectedUnit: "mm/s" }),
    ).toThrowError(/unidad esperada/);
    expect(() =>
      evaluateMeasurement({
        value: 2,
        unit: "bar",
        minimumValue: 5,
        maximumValue: 3,
      }),
    ).toThrowError(/rango configurado/);
  });

  it("accepts operational notes and constrains uploaded evidence", () => {
    expect(() =>
      assertEvidenceInput({ kind: "NOTE", description: "Guarda sin fisuras." }),
    ).not.toThrow();
    expect(() =>
      assertEvidenceInput({
        kind: "PHOTO",
        description: "Estado inicial",
        sizeBytes: 1_024,
        contentType: "image/jpeg",
      }),
    ).not.toThrow();
    expect(() =>
      assertEvidenceInput({
        kind: "PHOTO",
        description: "Archivo inválido",
        sizeBytes: 1_024,
        contentType: "application/pdf",
      }),
    ).toThrowError(/tipo de archivo/);
  });
});

describe("field safety, identity and handover", () => {
  it("normalizes an asset code without weakening its scope", () => {
    expect(normalizeScanCode(" mz-lev-lm-02-app ")).toBe("MZ-LEV-LM-02-APP");
    expect(() => normalizeScanCode("x")).toThrowError(/formato válido/);
  });

  it("requires a different destination shift and an operational summary", () => {
    expect(() =>
      assertHandover({
        fromShift: "M1",
        toShift: "T1",
        summary: "LM-02 preparada para inspección.",
      }),
    ).not.toThrow();
    expect(() =>
      assertHandover({
        fromShift: "M1",
        toShift: "M1",
        summary: "Sin cambios",
      }),
    ).toThrowError(/turno diferente/);
  });

  it("grants field actions to technicians but not closure authority", () => {
    expect(() =>
      assertPermission("TECHNICIAN", "FIELD_CHECKLIST"),
    ).not.toThrow();
    expect(() =>
      assertPermission("TECHNICIAN", "FIELD_EVIDENCE"),
    ).not.toThrow();
    expect(() =>
      assertPermission("TECHNICIAN", "FIELD_SAFETY_ACKNOWLEDGE"),
    ).not.toThrow();
    expect(() =>
      assertPermission("TECHNICIAN", "WORK_ORDER_CLOSE"),
    ).toThrowError(/rol no permite/);
  });

  it("blocks completion while a required checklist response is pending", () => {
    expect(() =>
      assertCanCompleteWorkOrder({
        type: "PREVENTIVE",
        diagnosis: null,
        solution: "Inspección realizada sin desviaciones.",
        openLaborSessions: 0,
        openDowntimeEvents: 0,
        requiredChecklistPending: 1,
      }),
    ).toThrowError(/pasos obligatorios del checklist/);
  });
});
