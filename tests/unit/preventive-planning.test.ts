import { describe, expect, it } from "vitest";
import {
  calculatePlannedCapacity,
  detectPlanningConflicts,
  type PlanningWork,
  type WorkforceProfile,
} from "@/lib/domain/planning";
import {
  addCalendarInterval,
  advancePreventiveTrigger,
  assertValidMeterReading,
  calculatePmCompliance,
  evaluatePreventiveTrigger,
  nextCalendarExecution,
  preventiveWindowKey,
} from "@/lib/domain/preventive";
import { assertPermission } from "@/lib/domain/permissions";
import { assertWorkOrderTransition } from "@/lib/domain/work-orders";

const candidate: PlanningWork = {
  id: "wo-candidate",
  technicianId: "tech-1",
  plannedStart: "2026-09-01T06:00:00.000Z",
  plannedEnd: "2026-09-01T08:00:00.000Z",
  estimatedMinutes: 120,
  requiredSkills: [{ skillId: "skill-mech", minimumLevel: 3 }],
  requiredCertificationIds: ["cert-loto"],
};

const profile: WorkforceProfile = {
  technicianId: "tech-1",
  shiftStart: "06:00",
  shiftEnd: "14:00",
  dailyCapacityMinutes: 480,
  availabilityStatus: "AVAILABLE",
  skills: [{ skillId: "skill-mech", level: 4 }],
  certificationIds: ["cert-loto"],
  unavailableIntervals: [],
};

describe("preventive scheduling", () => {
  it("advances daily and weekly frequencies in UTC", () => {
    expect(addCalendarInterval("2026-09-01T08:00:00.000Z", 3, "DAY")).toBe(
      "2026-09-04T08:00:00.000Z",
    );
    expect(addCalendarInterval("2026-09-01T08:00:00.000Z", 2, "WEEK")).toBe(
      "2026-09-15T08:00:00.000Z",
    );
  });

  it("clamps month-end recurrence without date drift", () => {
    expect(addCalendarInterval("2026-01-31T08:00:00.000Z", 1, "MONTH")).toBe(
      "2026-02-28T08:00:00.000Z",
    );
  });

  it("finds the first recurrence after a planning horizon", () => {
    expect(
      nextCalendarExecution({
        baseAt: "2026-08-01T08:00:00.000Z",
        interval: 1,
        unit: "WEEK",
        after: "2026-08-19T08:00:00.000Z",
      }),
    ).toBe("2026-08-22T08:00:00.000Z");
  });

  it("evaluates calendar, meter and whichever-first triggers", () => {
    expect(
      evaluatePreventiveTrigger({
        mode: "CALENDAR",
        now: "2026-09-01T08:00:00.000Z",
        calendarDueAt: "2026-09-01T07:00:00.000Z",
        meterValue: 900,
        meterThreshold: 1_000,
      }),
    ).toEqual({ due: true, reasons: ["CALENDAR"] });
    expect(
      evaluatePreventiveTrigger({
        mode: "METER",
        now: "2026-09-01T08:00:00.000Z",
        calendarDueAt: null,
        meterValue: 1_020,
        meterThreshold: 1_000,
      }),
    ).toEqual({ due: true, reasons: ["METER"] });
    expect(
      evaluatePreventiveTrigger({
        mode: "WHICHEVER_FIRST",
        now: "2026-09-01T08:00:00.000Z",
        calendarDueAt: "2026-09-02T08:00:00.000Z",
        meterValue: 1_020,
        meterThreshold: 1_000,
      }).reasons,
    ).toEqual(["METER"]);
  });

  it("builds a stable idempotency key per preventive window", () => {
    const key = preventiveWindowKey({
      mode: "WHICHEVER_FIRST",
      calendarDueAt: "2026-09-10T08:00:00.000Z",
      meterThreshold: 2_000,
      triggerReasons: ["METER"],
    });
    expect(key).toBe("METER:2000");
    expect(
      preventiveWindowKey({
        mode: "CALENDAR",
        calendarDueAt: "2026-09-10T08:00:00.000Z",
        meterThreshold: null,
      }),
    ).toBe("CALENDAR:2026-09-10");
  });

  it("resets both clocks after whichever-first maintenance", () => {
    expect(
      advancePreventiveTrigger({
        mode: "WHICHEVER_FIRST",
        now: "2026-09-01T08:00:00.000Z",
        reasons: ["METER"],
        calendarNextAt: "2026-09-20T08:00:00.000Z",
        calendarInterval: 1,
        calendarUnit: "MONTH",
        meterValue: 1_050,
        meterThreshold: 1_000,
        meterInterval: 500,
      }),
    ).toEqual({
      occurrenceDueAt: "2026-09-01T08:00:00.000Z",
      calendarNextAt: "2026-10-01T08:00:00.000Z",
      meterThreshold: 1_550,
      nextDueAt: "2026-10-01T08:00:00.000Z",
    });
  });

  it("rejects decreasing and out-of-order cumulative readings", () => {
    expect(() =>
      assertValidMeterReading({
        readingAt: "2026-09-01T08:00:00.000Z",
        value: 999,
        previousValue: 1_000,
        previousReadingAt: "2026-08-31T08:00:00.000Z",
        cumulative: true,
      }),
    ).toThrowError(/no puede disminuir/);
    expect(() =>
      assertValidMeterReading({
        readingAt: "2026-08-30T08:00:00.000Z",
        value: 1_010,
        previousValue: 1_000,
        previousReadingAt: "2026-08-31T08:00:00.000Z",
        cumulative: true,
      }),
    ).toThrowError(/anterior/);
  });

  it("calculates PM compliance only from matured, non-cancelled windows", () => {
    expect(
      calculatePmCompliance(
        [
          {
            dueAt: "2026-08-25T10:00:00.000Z",
            completedAt: "2026-08-25T09:30:00.000Z",
            status: "CLOSED",
          },
          {
            dueAt: "2026-08-27T10:00:00.000Z",
            completedAt: "2026-08-28T09:30:00.000Z",
            status: "CLOSED",
          },
          {
            dueAt: "2026-09-10T10:00:00.000Z",
            completedAt: null,
            status: "PLANNED",
          },
          {
            dueAt: "2026-08-29T10:00:00.000Z",
            completedAt: null,
            status: "CANCELLED",
          },
        ],
        "2026-09-01T10:00:00.000Z",
      ),
    ).toEqual({ scheduled: 2, onTime: 1, overdue: 1, compliance: 50 });
  });
});

describe("planner capacity and constraints", () => {
  it("derives daily capacity from planned work", () => {
    expect(
      calculatePlannedCapacity(
        [candidate, { ...candidate, id: "wo-2", estimatedMinutes: 90 }],
        "tech-1",
        "2026-09-01",
      ),
    ).toBe(210);
  });

  it("reports overlap and over-capacity as warnings", () => {
    const conflicts = detectPlanningConflicts({
      candidate: { ...candidate, estimatedMinutes: 420 },
      profile,
      existing: [
        {
          ...candidate,
          id: "wo-existing",
          plannedStart: "2026-09-01T07:00:00.000Z",
          plannedEnd: "2026-09-01T09:00:00.000Z",
          estimatedMinutes: 120,
        },
      ],
    });
    expect(conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "OVERLAP", severity: "WARNING" }),
        expect.objectContaining({ code: "OVER_CAPACITY", severity: "WARNING" }),
      ]),
    );
  });

  it("detects insufficient skill level", () => {
    const conflicts = detectPlanningConflicts({
      candidate,
      profile: {
        ...profile,
        skills: [{ skillId: "skill-mech", level: 2 }],
      },
      existing: [],
    });
    expect(conflicts).toContainEqual(
      expect.objectContaining({ code: "MISSING_SKILL", severity: "WARNING" }),
    );
  });

  it("treats missing certification and recorded absence as hard constraints", () => {
    const conflicts = detectPlanningConflicts({
      candidate,
      profile: {
        ...profile,
        certificationIds: [],
        unavailableIntervals: [
          {
            startsAt: "2026-09-01T05:00:00.000Z",
            endsAt: "2026-09-01T10:00:00.000Z",
          },
        ],
      },
      existing: [],
    });
    expect(conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MISSING_CERTIFICATION",
          severity: "HARD",
        }),
        expect.objectContaining({
          code: "TECHNICIAN_UNAVAILABLE",
          severity: "HARD",
        }),
      ]),
    );
  });

  it("warns when work falls outside the configured plant-local shift", () => {
    const conflicts = detectPlanningConflicts({
      candidate: {
        ...candidate,
        plannedStart: "2026-09-01T13:00:00.000Z",
        plannedEnd: "2026-09-01T15:00:00.000Z",
      },
      profile,
      existing: [],
    });
    expect(conflicts).toContainEqual(
      expect.objectContaining({ code: "OUTSIDE_SHIFT", severity: "WARNING" }),
    );
  });

  it("allows planner rollback transitions without reopening executed work", () => {
    expect(() =>
      assertWorkOrderTransition("ASSIGNED", "PLANNED"),
    ).not.toThrow();
    expect(() =>
      assertWorkOrderTransition("SCHEDULED", "PLANNED"),
    ).not.toThrow();
    expect(() => assertWorkOrderTransition("IN_PROGRESS", "PLANNED")).toThrow();
  });

  it("keeps preventive and planning mutations role-scoped", () => {
    expect(() =>
      assertPermission("PLANNER", "MAINTENANCE_PLAN_CREATE"),
    ).not.toThrow();
    expect(() => assertPermission("PLANNER", "PLANNER_MANAGE")).not.toThrow();
    expect(() => assertPermission("TECHNICIAN", "PLANNER_MANAGE")).toThrowError(
      /rol no permite/,
    );
    expect(() => assertPermission("TECHNICIAN", "METER_RECORD")).not.toThrow();
  });
});
