import { DomainInvariantError } from "./errors";

export type StockBalance = {
  onHand: number;
  reserved: number;
  onOrder: number;
};

export type StockDelta = {
  onHand: number;
  reserved: number;
  onOrder: number;
};

export function availableStock(balance: StockBalance): number {
  return balance.onHand - balance.reserved;
}

export function applyInventoryMovement(
  current: StockBalance,
  delta: StockDelta,
): StockBalance {
  const normalizedDelta = {
    onHand: roundQuantity(delta.onHand),
    reserved: roundQuantity(delta.reserved),
    onOrder: roundQuantity(delta.onOrder),
  };
  if (
    normalizedDelta.onHand === 0 &&
    normalizedDelta.reserved === 0 &&
    normalizedDelta.onOrder === 0
  ) {
    throw new DomainInvariantError(
      "EMPTY_STOCK_MOVEMENT",
      "Un movimiento debe modificar al menos un bucket de stock.",
    );
  }

  const next = {
    onHand: roundQuantity(current.onHand + normalizedDelta.onHand),
    reserved: roundQuantity(current.reserved + normalizedDelta.reserved),
    onOrder: roundQuantity(current.onOrder + normalizedDelta.onOrder),
  };

  if (next.onHand < 0 || next.reserved < 0 || next.onOrder < 0) {
    throw new DomainInvariantError(
      "NEGATIVE_STOCK_BUCKET",
      "Un movimiento no puede dejar cantidades negativas.",
    );
  }
  if (next.reserved > next.onHand) {
    throw new DomainInvariantError(
      "RESERVATION_EXCEEDS_ON_HAND",
      "El stock reservado no puede exceder el stock físico.",
    );
  }

  return next;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function assertPositiveQuantity(quantity: number): void {
  if (!Number.isFinite(quantity) || roundQuantity(quantity) <= 0) {
    throw new DomainInvariantError(
      "INVALID_QUANTITY",
      "La cantidad debe ser mayor que cero.",
    );
  }
}

export function assertCanReserve(
  balance: StockBalance,
  quantity: number,
): void {
  assertPositiveQuantity(quantity);
  if (quantity > availableStock(balance)) {
    throw new DomainInvariantError(
      "INSUFFICIENT_AVAILABLE_STOCK",
      "No hay stock disponible suficiente para completar la reserva.",
    );
  }
}

export function assertCanRelease(
  reservedForWorkOrder: number,
  quantity: number,
) {
  assertPositiveQuantity(quantity);
  if (quantity > reservedForWorkOrder) {
    throw new DomainInvariantError(
      "RELEASE_EXCEEDS_RESERVATION",
      "No se puede liberar más cantidad de la reservada para esta orden.",
    );
  }
}

export function reservationConsumed(
  reservedForWorkOrder: number,
  quantity: number,
): number {
  assertPositiveQuantity(quantity);
  return Math.min(roundQuantity(reservedForWorkOrder), roundQuantity(quantity));
}

export function assertCanConsume(input: {
  balance: StockBalance;
  reservedForWorkOrder: number;
  quantity: number;
}): void {
  assertPositiveQuantity(input.quantity);
  const usable = availableStock(input.balance) + input.reservedForWorkOrder;
  if (input.quantity > usable || input.quantity > input.balance.onHand) {
    throw new DomainInvariantError(
      "INSUFFICIENT_STOCK_FOR_CONSUMPTION",
      "El stock libre y reservado para la orden no cubre el consumo.",
    );
  }
}

export function assertCanReturn(input: {
  consumed: number;
  returned: number;
  quantity: number;
}): void {
  assertPositiveQuantity(input.quantity);
  if (input.returned + input.quantity > input.consumed) {
    throw new DomainInvariantError(
      "RETURN_EXCEEDS_CONSUMPTION",
      "La devolución no puede superar la cantidad consumida.",
    );
  }
}
