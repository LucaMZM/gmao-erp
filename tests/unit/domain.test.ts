import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "@/lib/domain/errors";
import { calculateDowntimeMinutes } from "@/lib/domain/downtime";
import {
  assertIncidentCanConvert,
  assertIncidentTransition,
} from "@/lib/domain/incidents";
import {
  applyInventoryMovement,
  assertCanConsume,
  assertCanRelease,
  assertCanReserve,
  assertCanReturn,
  availableStock,
  reservationConsumed,
} from "@/lib/domain/inventory";
import { assertCanStartLabor, calculateLaborMinutes } from "@/lib/domain/labor";
import { assertPermission } from "@/lib/domain/permissions";
import {
  assertAssetAcceptsPlannedWork,
  assertCanCloseWorkOrder,
  assertCanCompleteWorkOrder,
  assertWorkOrderTransition,
} from "@/lib/domain/work-orders";

describe("inventory invariants", () => {
  it("derives available stock from physical minus reserved", () => {
    expect(availableStock({ onHand: 12, reserved: 4, onOrder: 8 })).toBe(8);
  });

  it("applies a reservation without changing physical stock", () => {
    expect(
      applyInventoryMovement(
        { onHand: 12, reserved: 2, onOrder: 0 },
        { onHand: 0, reserved: 3, onOrder: 0 },
      ),
    ).toEqual({ onHand: 12, reserved: 5, onOrder: 0 });
  });

  it("rejects reservations above physical stock", () => {
    expect(() =>
      applyInventoryMovement(
        { onHand: 5, reserved: 2, onOrder: 0 },
        { onHand: 0, reserved: 4, onOrder: 0 },
      ),
    ).toThrowError(DomainInvariantError);
  });

  it("rejects negative stock buckets", () => {
    expect(() =>
      applyInventoryMovement(
        { onHand: 1, reserved: 0, onOrder: 0 },
        { onHand: -2, reserved: 0, onOrder: 0 },
      ),
    ).toThrowError(/cantidades negativas/);
  });

  it("rejects movements that do not change stock", () => {
    expect(() =>
      applyInventoryMovement(
        { onHand: 4, reserved: 0, onOrder: 0 },
        { onHand: 0, reserved: 0, onOrder: 0 },
      ),
    ).toThrowError(/al menos un bucket/);
  });

  it("guards reserve, release, consumption and return quantities", () => {
    const balance = { onHand: 10, reserved: 4, onOrder: 2 };
    expect(() => assertCanReserve(balance, 6)).not.toThrow();
    expect(() => assertCanReserve(balance, 7)).toThrowError(
      /stock disponible suficiente/,
    );
    expect(() => assertCanRelease(2, 3)).toThrowError(/más cantidad/);
    expect(() =>
      assertCanConsume({ balance, reservedForWorkOrder: 2, quantity: 8 }),
    ).not.toThrow();
    expect(() =>
      assertCanConsume({ balance, reservedForWorkOrder: 1, quantity: 8 }),
    ).toThrowError(/no cubre/);
    expect(reservationConsumed(2, 5)).toBe(2);
    expect(() =>
      assertCanReturn({ consumed: 3, returned: 1, quantity: 3 }),
    ).toThrowError(/cantidad consumida/);
  });
});

describe("work-order invariants", () => {
  it("accepts an industrial forward transition", () => {
    expect(() =>
      assertWorkOrderTransition("ASSIGNED", "IN_PROGRESS"),
    ).not.toThrow();
  });

  it("rejects an impossible transition", () => {
    expect(() =>
      assertWorkOrderTransition("CLOSED", "IN_PROGRESS"),
    ).toThrowError(/no está permitida/);
  });

  it("requires completed labor and a documented solution to close", () => {
    expect(() =>
      assertCanCloseWorkOrder({
        openLaborSessions: 1,
        actualEnd: "2026-08-25T12:00:00.000Z",
        solution: "Rodamiento sustituido.",
      }),
    ).toThrowError(/sesiones de trabajo activas/);
    expect(() =>
      assertCanCloseWorkOrder({
        openLaborSessions: 0,
        actualEnd: null,
        solution: null,
      }),
    ).toThrowError(/requiere fecha real/);
  });

  it("prevents planned work on retired assets", () => {
    expect(() => assertAssetAcceptsPlannedWork("RETIRED")).toThrowError(
      /activo retirado/,
    );
    expect(() => assertAssetAcceptsPlannedWork("OPERATING")).not.toThrow();
  });

  it("requires operational closure data before completion", () => {
    expect(() =>
      assertCanCompleteWorkOrder({
        type: "CORRECTIVE",
        diagnosis: null,
        solution: "Rodamiento sustituido.",
        openLaborSessions: 0,
        openDowntimeEvents: 0,
      }),
    ).toThrowError(/diagnóstico/);
    expect(() =>
      assertCanCompleteWorkOrder({
        type: "CORRECTIVE",
        diagnosis: "Desgaste del rodamiento.",
        solution: "Rodamiento sustituido.",
        openLaborSessions: 0,
        openDowntimeEvents: 0,
      }),
    ).not.toThrow();
  });
});

describe("incident invariants", () => {
  it("accepts triage and rejects conversion before acceptance", () => {
    expect(() => assertIncidentTransition("NEW", "IN_TRIAGE")).not.toThrow();
    expect(() => assertIncidentTransition("NEW", "CONVERTED")).toThrowError(
      /no está permitida/,
    );
    expect(() =>
      assertIncidentCanConvert({
        status: "IN_TRIAGE",
        assetId: "asset-1",
        priority: "P2_URGENT",
        classification: "CORRECTIVE",
      }),
    ).toThrowError(/aceptada/);
  });
});

describe("labor and downtime invariants", () => {
  it("prevents duplicate/unassigned labor and derives elapsed time", () => {
    expect(() =>
      assertCanStartLabor({
        workOrderStatus: "ASSIGNED",
        isAssigned: false,
        hasActiveSession: false,
      }),
    ).toThrowError(/asignado/);
    expect(
      calculateLaborMinutes(
        "2026-08-25T08:00:00.000Z",
        "2026-08-25T09:25:00.000Z",
      ),
    ).toBe(85);
    expect(() =>
      calculateLaborMinutes(
        "2026-08-25T09:00:00.000Z",
        "2026-08-25T08:00:00.000Z",
      ),
    ).toThrowError(/anterior/);
  });

  it("rejects negative downtime intervals", () => {
    expect(
      calculateDowntimeMinutes(
        "2026-08-25T08:00:00.000Z",
        "2026-08-25T10:00:00.000Z",
      ),
    ).toBe(120);
    expect(() =>
      calculateDowntimeMinutes(
        "2026-08-25T10:00:00.000Z",
        "2026-08-25T08:00:00.000Z",
      ),
    ).toThrowError(/anterior/);
  });
});

describe("operation permissions", () => {
  it("keeps reporting broad and closure restricted", () => {
    expect(() => assertPermission("VIEWER", "INCIDENT_REPORT")).not.toThrow();
    expect(() =>
      assertPermission("TECHNICIAN", "WORK_ORDER_CLOSE"),
    ).toThrowError(/rol no permite/);
    expect(() =>
      assertPermission("MAINTENANCE_MANAGER", "WORK_ORDER_CLOSE"),
    ).not.toThrow();
  });
});
