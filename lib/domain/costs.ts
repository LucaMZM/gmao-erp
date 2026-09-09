import { DomainInvariantError } from "./errors";

export function laborCostCents(
  minutes: number,
  hourlyRateCents: number,
): number {
  if (minutes < 0 || hourlyRateCents < 0) {
    throw new DomainInvariantError(
      "INVALID_COST_INPUT",
      "El tiempo y la tarifa deben ser positivos.",
    );
  }
  return Math.round((minutes * hourlyRateCents) / 60);
}

export type WorkOrderCostParts = {
  laborCents: number;
  materialCents: number;
  externalCents: number;
  otherCents: number;
};

export function totalWorkOrderCostCents(parts: WorkOrderCostParts): number {
  const values = Object.values(parts);
  if (values.some((value) => value < 0 || !Number.isFinite(value))) {
    throw new DomainInvariantError(
      "INVALID_COST_INPUT",
      "El desglose de costes contiene importes no válidos.",
    );
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0));
}
