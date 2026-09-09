import { DomainInvariantError } from "./errors";

export const requisitionStatuses = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "CONVERTED",
  "CANCELLED",
] as const;

export const purchaseOrderStatuses = [
  "DRAFT",
  "APPROVED",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;

export const transferStatuses = [
  "CREATED",
  "IN_TRANSIT",
  "RECEIVED",
  "CANCELLED",
] as const;

export type RequisitionStatus = (typeof requisitionStatuses)[number];
export type PurchaseOrderStatus = (typeof purchaseOrderStatuses)[number];
export type TransferStatus = (typeof transferStatuses)[number];

const requisitionTransitions: Record<RequisitionStatus, RequisitionStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["CONVERTED", "CANCELLED"],
  REJECTED: [],
  CONVERTED: [],
  CANCELLED: [],
};

const orderTransitions: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  DRAFT: ["APPROVED", "CANCELLED"],
  APPROVED: ["SENT", "CANCELLED"],
  SENT: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["PARTIALLY_RECEIVED", "RECEIVED"],
  RECEIVED: [],
  CANCELLED: [],
};

const transferTransitions: Record<TransferStatus, TransferStatus[]> = {
  CREATED: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED"],
  RECEIVED: [],
  CANCELLED: [],
};

function assertTransition<T extends string>(
  transitions: Record<T, T[]>,
  from: T,
  to: T,
  entity: string,
): void {
  if (!transitions[from]?.includes(to)) {
    throw new DomainInvariantError(
      "INVALID_TRANSITION",
      `${entity}: transición ${from} → ${to} no permitida.`,
    );
  }
}

export function assertRequisitionTransition(
  from: RequisitionStatus,
  to: RequisitionStatus,
): void {
  assertTransition(requisitionTransitions, from, to, "Requisición");
}

export function assertPurchaseOrderTransition(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): void {
  assertTransition(orderTransitions, from, to, "Pedido");
}

export function assertTransferTransition(
  from: TransferStatus,
  to: TransferStatus,
): void {
  assertTransition(transferTransitions, from, to, "Transferencia");
}

export function assertPositiveProcurementQuantity(quantity: number): void {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new DomainInvariantError(
      "INVALID_QUANTITY",
      "La cantidad debe ser mayor que cero.",
    );
  }
}

export function assertReceiptAllowed(input: {
  status: PurchaseOrderStatus;
  ordered: number;
  received: number;
  quantity: number;
}): void {
  assertPositiveProcurementQuantity(input.quantity);
  if (!["SENT", "PARTIALLY_RECEIVED"].includes(input.status)) {
    throw new DomainInvariantError(
      "PURCHASE_ORDER_NOT_RECEIVABLE",
      "El pedido debe estar enviado y abierto para registrar una recepción.",
    );
  }
  if (input.received + input.quantity > input.ordered + 1e-9) {
    throw new DomainInvariantError(
      "OVER_RECEIPT",
      "La recepción no puede superar la cantidad pendiente del pedido.",
    );
  }
}

export function calculateReorderSuggestion(input: {
  available: number;
  onOrder: number;
  maxStock: number;
  reorderPoint: number;
}): { required: boolean; suggestedQuantity: number; explanation: string } {
  const projected = input.available + input.onOrder;
  const required =
    input.available <= input.reorderPoint && projected < input.maxStock;
  const suggestedQuantity = required
    ? Math.max(0, Number((input.maxStock - projected).toFixed(3)))
    : 0;
  return {
    required,
    suggestedQuantity,
    explanation: required
      ? `Disponible ${input.available}; en pedido ${input.onOrder}; objetivo máximo ${input.maxStock}.`
      : `Cobertura proyectada ${projected}; punto de reposición ${input.reorderPoint}.`,
  };
}

export type CriticalSpareRisk = {
  score: number;
  level: "CRITICAL" | "HIGH" | "WATCH" | "CONTROLLED";
  reasons: string[];
};

export function calculateCriticalSpareRisk(input: {
  critical: boolean;
  available: number;
  onOrder: number;
  leadTimeDays: number;
  approvedSubstitutes: number;
  openDemand: number;
  waitingWorkOrders: number;
}): CriticalSpareRisk {
  const reasons: string[] = [];
  let score = input.critical ? 22 : 4;
  if (input.available <= 0) {
    score += 34;
    reasons.push("Sin stock disponible");
  } else if (input.available <= input.openDemand) {
    score += 20;
    reasons.push("Disponible no cubre la demanda abierta");
  }
  if (input.leadTimeDays >= 21) {
    score += 18;
    reasons.push(`Lead time ${input.leadTimeDays} días`);
  } else if (input.leadTimeDays >= 10) {
    score += 9;
    reasons.push(`Lead time ${input.leadTimeDays} días`);
  }
  if (input.waitingWorkOrders > 0) {
    score += Math.min(18, input.waitingWorkOrders * 9);
    reasons.push(`${input.waitingWorkOrders} OT esperando recambio`);
  }
  if (input.approvedSubstitutes === 0) {
    score += 8;
    reasons.push("Sin sustituto aprobado");
  }
  if (input.onOrder > 0) {
    score -= 10;
    reasons.push(`${input.onOrder} en pedido`);
  }
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    level:
      score >= 70
        ? "CRITICAL"
        : score >= 50
          ? "HIGH"
          : score >= 30
            ? "WATCH"
            : "CONTROLLED",
    reasons: reasons.length ? reasons : ["Cobertura y suministro estables"],
  };
}

export function purchaseOrderTotals(
  lines: Array<{ quantity: number; unitPrice: number }>,
  taxRate: number,
): { subtotal: number; taxAmount: number; total: number } {
  const subtotal = Number(
    lines
      .reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
      .toFixed(2),
  );
  const taxAmount = Number((subtotal * (taxRate / 100)).toFixed(2));
  return {
    subtotal,
    taxAmount,
    total: Number((subtotal + taxAmount).toFixed(2)),
  };
}
