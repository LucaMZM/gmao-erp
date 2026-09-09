import { describe, expect, it } from "vitest";
import {
  buildAssets,
  buildParts,
  buildWorkOrders,
  buildWorkOrderStatusHistory,
} from "@/db/seed";
import { assertWorkOrderTransition } from "@/lib/domain/work-orders";

describe("deterministic industrial seed", () => {
  const assets = buildAssets();
  const orders = buildWorkOrders(assets);
  const parts = buildParts();

  it("creates the intended V0 dataset sizes", () => {
    expect(assets).toHaveLength(72);
    expect(orders).toHaveLength(80);
    expect(parts).toHaveLength(180);
  });

  it("keeps human asset codes unique and contextualized", () => {
    expect(new Set(assets.map((asset) => asset.code)).size).toBe(assets.length);
    expect(assets.every((asset) => asset.locationId && asset.siteId)).toBe(
      true,
    );
    expect(assets.find((asset) => asset.code === "LM-02-APP")?.parentId).toBe(
      "asset-lm-02",
    );
  });

  it("contains a realistic work-order lifecycle", () => {
    const statuses = [...new Set(orders.map((order) => order.status))];
    expect(statuses).toEqual(
      expect.arrayContaining([
        "REQUESTED",
        "PLANNED",
        "IN_PROGRESS",
        "WAITING_PART",
        "COMPLETED",
        "CLOSED",
        "CANCELLED",
      ]),
    );
    expect(
      orders.find((order) => order.number === "OT-LEV-2026-0184")?.title,
    ).toContain("Vibración anómala");
  });

  it("keeps work-order timestamps temporally coherent", () => {
    for (const order of orders) {
      const requested = new Date(order.requestedAt).getTime();
      expect(new Date(order.dueAt).getTime()).toBeGreaterThanOrEqual(requested);
      if (order.plannedStart) {
        expect(new Date(order.plannedStart).getTime()).toBeGreaterThanOrEqual(
          requested,
        );
      }
      if (order.plannedStart && order.plannedEnd) {
        expect(new Date(order.plannedEnd).getTime()).toBeGreaterThanOrEqual(
          new Date(order.plannedStart).getTime(),
        );
      }
      if (order.actualStart) {
        expect(new Date(order.actualStart).getTime()).toBeGreaterThanOrEqual(
          requested,
        );
      }
      if (order.actualStart && order.actualEnd) {
        expect(new Date(order.actualEnd).getTime()).toBeGreaterThanOrEqual(
          new Date(order.actualStart).getTime(),
        );
      }
    }
  });

  it("builds chronological histories from valid industrial transitions", () => {
    for (const order of orders) {
      const history = buildWorkOrderStatusHistory(order);
      let previousTimestamp = new Date(order.requestedAt).getTime();
      let currentStatus = "REQUESTED";

      for (const event of history) {
        expect(event.fromStatus).toBe(currentStatus);
        expect(() =>
          assertWorkOrderTransition(event.fromStatus, event.toStatus),
        ).not.toThrow();
        expect(new Date(event.createdAt).getTime()).toBeGreaterThanOrEqual(
          previousTimestamp,
        );
        currentStatus = event.toStatus;
        previousTimestamp = new Date(event.createdAt).getTime();
      }

      expect(currentStatus).toBe(order.status);
    }
  });

  it("keeps every stock projection internally valid", () => {
    expect(parts.every((part) => part.reserved <= part.onHand)).toBe(true);
    expect(parts.every((part) => part.onHand >= 0 && part.onOrder >= 0)).toBe(
      true,
    );
    expect(parts.filter((part) => part.critical)).toHaveLength(30);
  });
});
