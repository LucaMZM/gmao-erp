import { describe, expect, it } from "vitest";
import {
  assertValidRcaStatusTransition,
  buildPareto,
  calculateHealthScore,
  calculateReliabilityMetrics,
  calculateRepeatFailureRate,
  calculateTrend,
  classifyFailurePattern,
} from "@/lib/domain/reliability";

describe("reliability metrics", () => {
  it("derives MTBF, MTTR, downtime and calendar availability", () => {
    const metrics = calculateReliabilityMetrics({
      windowStart: "2026-09-01T00:00:00.000Z",
      windowEnd: "2026-09-02T00:00:00.000Z",
      observations: [
        {
          occurredAt: "2026-09-01T02:00:00.000Z",
          restoredAt: "2026-09-01T03:00:00.000Z",
          repairMinutes: 60,
          downtimeMinutes: 60,
        },
        {
          occurredAt: "2026-09-01T12:00:00.000Z",
          restoredAt: "2026-09-01T14:00:00.000Z",
          repairMinutes: 120,
          downtimeMinutes: 120,
        },
      ],
    });
    expect(metrics.failureCount).toBe(2);
    expect(metrics.downtimeMinutes).toBe(180);
    expect(metrics.averageDowntimeMinutes).toBe(90);
    expect(metrics.mtbfMinutes).toBe(630);
    expect(metrics.mttrMinutes).toBe(90);
    expect(metrics.availability).toBe(87.5);
  });

  it("reports insufficient MTBF without two failures", () => {
    expect(
      calculateReliabilityMetrics({
        windowStart: "2026-09-01T00:00:00.000Z",
        windowEnd: "2026-09-02T00:00:00.000Z",
        observations: [
          {
            occurredAt: "2026-09-01T02:00:00.000Z",
            restoredAt: null,
            repairMinutes: null,
            downtimeMinutes: 20,
          },
        ],
      }).mtbfMinutes,
    ).toBeNull();
  });

  it("rejects incoherent reliability windows", () => {
    expect(() =>
      calculateReliabilityMetrics({
        windowStart: "2026-09-02T00:00:00.000Z",
        windowEnd: "2026-09-01T00:00:00.000Z",
        observations: [],
      }),
    ).toThrowError(/ventana de fiabilidad/);
  });
});

describe("repeat failure and trends", () => {
  it("classifies growing, recurrent, stable and isolated patterns", () => {
    expect(
      classifyFailurePattern({ total90: 5, recent30: 3, previous30: 1 }),
    ).toBe("GROWING");
    expect(
      classifyFailurePattern({ total90: 3, recent30: 1, previous30: 1 }),
    ).toBe("RECURRENT");
    expect(
      classifyFailurePattern({ total90: 2, recent30: 0, previous30: 1 }),
    ).toBe("STABLE");
    expect(
      classifyFailurePattern({ total90: 1, recent30: 1, previous30: 0 }),
    ).toBe("ISOLATED");
  });

  it("calculates repeated occurrences over all failures", () => {
    expect(calculateRepeatFailureRate([3, 2, 1])).toBeCloseTo(50);
    expect(calculateRepeatFailureRate([])).toBeNull();
  });

  it("requires samples and reports the raw metric trend", () => {
    expect(
      calculateTrend({
        current: 6,
        previous: 4,
        currentSamples: 3,
        previousSamples: 2,
      }),
    ).toEqual({ direction: "INCREASING", changePercent: 50 });
    expect(
      calculateTrend({
        current: 2,
        previous: 0,
        currentSamples: 2,
        previousSamples: 1,
      }).direction,
    ).toBe("INCREASING");
    expect(
      calculateTrend({
        current: 2,
        previous: 2,
        currentSamples: 0,
        previousSamples: 1,
      }).direction,
    ).toBe("INSUFFICIENT");
  });
});

describe("explainable health and pareto", () => {
  it("builds a reproducible health score and breakdown", () => {
    const result = calculateHealthScore(
      {
        criticality: "CRITICAL",
        status: "DEGRADED",
        commissionedAt: "2017-01-01T00:00:00.000Z",
        recentFailures: 3,
        recurrentFailures: 2,
        downtimeMinutes30: 360,
        overdueWorkOrders: 1,
        overduePreventive: 1,
        openIncidents: 2,
        criticalIncidents: 1,
        criticalBacklog: 1,
        recentCompletedMaintenance: 2,
      },
      "2026-09-05T00:00:00.000Z",
    );
    expect(result.score).toBe(41);
    expect(result.breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "recurrence", adjustment: -8 }),
        expect.objectContaining({ key: "recent-maintenance", adjustment: 4 }),
      ]),
    );
  });

  it("orders Pareto rows and calculates cumulative share", () => {
    const rows = buildPareto([
      { label: "A", value: 60 },
      { label: "B", value: 30 },
      { label: "C", value: 10 },
    ]);
    expect(rows.map((row) => row.label)).toEqual(["A", "B", "C"]);
    expect(rows[1].cumulativeShare).toBe(90);
  });
});

describe("root cause analysis lifecycle", () => {
  it("permits the investigation path and enforces closure completeness", () => {
    expect(() =>
      assertValidRcaStatusTransition("DRAFT", "INVESTIGATING", 0, null),
    ).not.toThrow();
    expect(() =>
      assertValidRcaStatusTransition("VERIFICATION", "CLOSED", 1, "Cause"),
    ).toThrowError(/acciones abiertas/);
    expect(() =>
      assertValidRcaStatusTransition("VERIFICATION", "CLOSED", 0, null),
    ).toThrowError(/causa raíz/);
    expect(() =>
      assertValidRcaStatusTransition(
        "VERIFICATION",
        "CLOSED",
        0,
        "Pauta incorrecta",
      ),
    ).not.toThrow();
  });

  it("keeps terminal analyses immutable", () => {
    expect(() =>
      assertValidRcaStatusTransition("CLOSED", "INVESTIGATING", 0, "Cause"),
    ).toThrowError(/no puede pasar/);
  });
});
