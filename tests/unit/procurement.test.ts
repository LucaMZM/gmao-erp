import { describe, expect, it } from "vitest";
import {
  assertPositiveProcurementQuantity,
  assertPurchaseOrderTransition,
  assertReceiptAllowed,
  assertRequisitionTransition,
  assertTransferTransition,
  calculateCriticalSpareRisk,
  calculateReorderSuggestion,
  purchaseOrderTotals,
} from "@/lib/domain/procurement";
import { assertPermission } from "@/lib/domain/permissions";

describe("purchase requisition lifecycle", () => {
  it("accepts submit, approval and conversion in sequence", () => {
    expect(() =>
      assertRequisitionTransition("DRAFT", "SUBMITTED"),
    ).not.toThrow();
    expect(() =>
      assertRequisitionTransition("SUBMITTED", "APPROVED"),
    ).not.toThrow();
    expect(() =>
      assertRequisitionTransition("APPROVED", "CONVERTED"),
    ).not.toThrow();
  });

  it("prevents duplicate conversion and terminal reopening", () => {
    expect(() =>
      assertRequisitionTransition("CONVERTED", "CONVERTED"),
    ).toThrowError(/no permitida/);
    expect(() =>
      assertRequisitionTransition("REJECTED", "SUBMITTED"),
    ).toThrowError(/no permitida/);
  });
});

describe("purchase order lifecycle and receipts", () => {
  it("requires approval before sending", () => {
    expect(() => assertPurchaseOrderTransition("DRAFT", "SENT")).toThrowError(
      /no permitida/,
    );
    expect(() =>
      assertPurchaseOrderTransition("DRAFT", "APPROVED"),
    ).not.toThrow();
    expect(() =>
      assertPurchaseOrderTransition("APPROVED", "SENT"),
    ).not.toThrow();
  });

  it("supports partial and complete receipts", () => {
    expect(() =>
      assertPurchaseOrderTransition("SENT", "PARTIALLY_RECEIVED"),
    ).not.toThrow();
    expect(() =>
      assertPurchaseOrderTransition("PARTIALLY_RECEIVED", "RECEIVED"),
    ).not.toThrow();
  });

  it("rejects receipt before dispatch or after cancellation", () => {
    expect(() =>
      assertReceiptAllowed({
        status: "APPROVED",
        ordered: 10,
        received: 0,
        quantity: 1,
      }),
    ).toThrowError(/enviado/);
    expect(() =>
      assertReceiptAllowed({
        status: "CANCELLED",
        ordered: 10,
        received: 0,
        quantity: 1,
      }),
    ).toThrowError(/enviado/);
  });

  it("prevents over-receipt", () => {
    expect(() =>
      assertReceiptAllowed({
        status: "PARTIALLY_RECEIVED",
        ordered: 10,
        received: 7,
        quantity: 4,
      }),
    ).toThrowError(/superar/);
    expect(() =>
      assertReceiptAllowed({
        status: "PARTIALLY_RECEIVED",
        ordered: 10,
        received: 7,
        quantity: 3,
      }),
    ).not.toThrow();
  });

  it("freezes order totals from line snapshots", () => {
    expect(
      purchaseOrderTotals(
        [
          { quantity: 2, unitPrice: 11.25 },
          { quantity: 3, unitPrice: 4.5 },
        ],
        21,
      ),
    ).toEqual({ subtotal: 36, taxAmount: 7.56, total: 43.56 });
  });
});

describe("replenishment and critical spare risk", () => {
  it("derives replenishment to max from projected coverage", () => {
    expect(
      calculateReorderSuggestion({
        available: 2,
        onOrder: 3,
        maxStock: 15,
        reorderPoint: 5,
      }),
    ).toMatchObject({ required: true, suggestedQuantity: 10 });
  });

  it("does not duplicate supply when projected coverage reaches max", () => {
    expect(
      calculateReorderSuggestion({
        available: 2,
        onOrder: 13,
        maxStock: 15,
        reorderPoint: 5,
      }),
    ).toMatchObject({ required: false, suggestedQuantity: 0 });
  });

  it("explains a critical stockout with waiting work", () => {
    const risk = calculateCriticalSpareRisk({
      critical: true,
      available: 0,
      onOrder: 0,
      leadTimeDays: 24,
      approvedSubstitutes: 0,
      openDemand: 2,
      waitingWorkOrders: 2,
    });
    expect(risk.level).toBe("CRITICAL");
    expect(risk.reasons).toEqual(
      expect.arrayContaining([
        "Sin stock disponible",
        "2 OT esperando recambio",
        "Sin sustituto aprobado",
      ]),
    );
  });

  it("reduces risk when supply and an approved substitute exist", () => {
    const exposed = calculateCriticalSpareRisk({
      critical: true,
      available: 0,
      onOrder: 0,
      leadTimeDays: 21,
      approvedSubstitutes: 0,
      openDemand: 1,
      waitingWorkOrders: 1,
    });
    const covered = calculateCriticalSpareRisk({
      critical: true,
      available: 8,
      onOrder: 6,
      leadTimeDays: 4,
      approvedSubstitutes: 1,
      openDemand: 1,
      waitingWorkOrders: 0,
    });
    expect(covered.score).toBeLessThan(exposed.score);
    expect(covered.level).toBe("CONTROLLED");
  });
});

describe("stock transfers", () => {
  it("supports dispatch and receipt without duplicate final stock", () => {
    expect(() =>
      assertTransferTransition("CREATED", "IN_TRANSIT"),
    ).not.toThrow();
    expect(() =>
      assertTransferTransition("IN_TRANSIT", "RECEIVED"),
    ).not.toThrow();
  });

  it("only permits cancellation before dispatch", () => {
    expect(() =>
      assertTransferTransition("CREATED", "CANCELLED"),
    ).not.toThrow();
    expect(() =>
      assertTransferTransition("IN_TRANSIT", "CANCELLED"),
    ).toThrowError(/no permitida/);
  });

  it("rejects zero and negative movement quantities", () => {
    expect(() => assertPositiveProcurementQuantity(0)).toThrowError(
      /mayor que cero/,
    );
    expect(() => assertPositiveProcurementQuantity(-1)).toThrowError(
      /mayor que cero/,
    );
  });
});

describe("procurement RBAC", () => {
  it("allows broad requisition creation but restricts approval", () => {
    expect(() =>
      assertPermission("TECHNICIAN", "PURCHASE_REQUISITION_CREATE"),
    ).not.toThrow();
    expect(() =>
      assertPermission("TECHNICIAN", "PURCHASE_REQUISITION_APPROVE"),
    ).toThrowError(/rol no permite/);
    expect(() =>
      assertPermission("MAINTENANCE_MANAGER", "PURCHASE_REQUISITION_APPROVE"),
    ).not.toThrow();
  });

  it("lets warehouse receive and transfer but not approve purchase orders", () => {
    expect(() =>
      assertPermission("WAREHOUSE", "INVENTORY_RECEIVE"),
    ).not.toThrow();
    expect(() =>
      assertPermission("WAREHOUSE", "INVENTORY_TRANSFER"),
    ).not.toThrow();
    expect(() =>
      assertPermission("WAREHOUSE", "PURCHASE_ORDER_MANAGE"),
    ).toThrowError(/rol no permite/);
  });
});
