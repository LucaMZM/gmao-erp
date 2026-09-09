import { describe, expect, it } from "vitest";
import {
  assertEnterprisePermission,
  canAccessResource,
  integrityStatus,
} from "@/lib/domain/governance";
import {
  calendarAvailability,
  productiveExposureMinutes,
} from "@/lib/domain/production-calendar";
import { laborCostCents, totalWorkOrderCostCents } from "@/lib/domain/costs";
import {
  assertEvidencePolicy,
  sanitizeEvidenceFileName,
} from "@/lib/domain/evidence-policy";
import {
  nextLoginFailureState,
  sessionIsValid,
} from "@/lib/domain/auth-security";
import { isOfflineOperationSupported } from "@/lib/client/offline-queue";
import { reportingCsv } from "@/lib/domain/reporting";
import { derivePasswordHash, verifyPassword } from "@/lib/server/crypto";

describe("V2B governance and enterprise invariants", () => {
  it("enforces explicit permission grants", () => {
    expect(() =>
      assertEnterprisePermission(["incident.report"], "incident.report"),
    ).not.toThrow();
    expect(() =>
      assertEnterprisePermission(["incident.report"], "audit.read"),
    ).toThrowError(/perfil/i);
  });

  it("limits access to the current site and permitted area hierarchy", () => {
    const scope = {
      siteIds: ["levante"],
      currentSiteId: "levante",
      fullAreaAccess: false,
      areaIds: ["laminacion"],
      fullWarehouseAccess: false,
      warehouseIds: ["mro"],
    };
    expect(
      canAccessResource(scope, {
        siteId: "levante",
        areaId: "lm-02",
        ancestorAreaIds: ["laminacion"],
        warehouseId: "mro",
      }),
    ).toBe(true);
    expect(
      canAccessResource(scope, {
        siteId: "levante",
        areaId: "pr-01",
        ancestorAreaIds: ["impresion"],
      }),
    ).toBe(false);
    expect(canAccessResource(scope, { siteId: "alzira" })).toBe(false);
  });

  it("calculates productive exposure with planned-stop exceptions", () => {
    const exposure = productiveExposureMinutes(
      new Date("2026-09-07T00:00:00.000Z"),
      new Date("2026-09-08T00:00:00.000Z"),
      [
        {
          dayOfWeek: 1,
          startMinute: 360,
          endMinute: 1320,
          capacityPercent: 100,
          kind: "PRODUCTION",
        },
      ],
      [
        {
          date: "2026-09-07",
          startMinute: 720,
          endMinute: 840,
          capacityPercent: 0,
          kind: "PLANNED_STOP",
        },
      ],
    );
    expect(exposure).toBe(840);
    expect(calendarAvailability(exposure, 84)).toBe(90);
    expect(calendarAvailability(0, 0)).toBeNull();
  });

  it("freezes labor and consolidates maintenance cost in cents", () => {
    expect(laborCostCents(90, 2850)).toBe(4275);
    expect(
      totalWorkOrderCostCents({
        laborCents: 4275,
        materialCents: 8900,
        externalCents: 18500,
        otherCents: 0,
      }),
    ).toBe(31675);
  });

  it("applies configurable login lockout and session expiry", () => {
    const now = new Date("2026-09-08T08:00:00.000Z");
    expect(
      nextLoginFailureState(4, now, {
        maxFailedAttempts: 5,
        lockoutMinutes: 15,
      }),
    ).toEqual({
      failedAttempts: 5,
      lockedUntil: "2026-09-08T08:15:00.000Z",
    });
    expect(
      sessionIsValid(now, {
        expiresAt: "2026-09-08T09:00:00.000Z",
        absoluteExpiresAt: "2026-09-09T08:00:00.000Z",
        idleExpiresAt: "2026-09-08T08:30:00.000Z",
        revokedAt: null,
      }),
    ).toBe(true);
    expect(
      sessionIsValid(now, {
        expiresAt: "2026-09-08T09:00:00.000Z",
        absoluteExpiresAt: "2026-09-09T08:00:00.000Z",
        idleExpiresAt: "2026-09-08T07:59:00.000Z",
        revokedAt: null,
      }),
    ).toBe(false);
  });

  it("uses the hosted PBKDF2 limit while accepting legacy local hashes", async () => {
    const salt = "6d617a6d692d666163746f72792d7630";
    const current = await derivePasswordHash("Mazmi2026!", salt);
    const legacy = await derivePasswordHash("Mazmi2026!", salt, 120_000);

    await expect(verifyPassword("Mazmi2026!", salt, current)).resolves.toBe(
      true,
    );
    await expect(verifyPassword("Mazmi2026!", salt, legacy)).resolves.toBe(
      true,
    );
    await expect(verifyPassword("incorrecta", salt, current)).resolves.toBe(
      false,
    );
  });

  it("hardens attachment type, size and safe file name", () => {
    expect(sanitizeEvidenceFileName("foto rodillo nº 2.png")).toBe(
      "foto-rodillo-no-2.png",
    );
    expect(() => assertEvidencePolicy("image/png", 1024)).not.toThrow();
    expect(() => assertEvidencePolicy("text/html", 1024)).toThrowError(/tipo/i);
    expect(() => assertEvidencePolicy("image/png", 20_000_000)).toThrowError(
      /10 MB/i,
    );
  });

  it("queues only safe field operations while critical mutations stay online", () => {
    expect(
      isOfflineOperationSupported("/api/incidents", { title: "Fuga" }),
    ).toBe(true);
    expect(
      isOfflineOperationSupported("/api/field/work-orders/OT-1/evidence", {
        kind: "NOTE",
      }),
    ).toBe(true);
    expect(
      isOfflineOperationSupported("/api/work-orders/OT-1/materials", {
        action: "CONSUME",
      }),
    ).toBe(false);
    expect(
      isOfflineOperationSupported("/api/work-orders/OT-1/actions", {
        action: "CLOSE",
      }),
    ).toBe(false);
  });

  it("summarizes integrity without repairing critical data", () => {
    expect(
      integrityStatus([
        {
          code: "STOCK",
          severity: "CRITICAL",
          count: 1,
          title: "Stock",
          guidance: "Review",
        },
      ]),
    ).toEqual({ state: "CRITICAL", critical: 1, warning: 0 });
  });

  it("produces a bounded CSV report without unscoped columns", () => {
    const csv = reportingCsv({
      costsByAsset: [
        {
          code: "LM-02",
          name: "Línea, laminación",
          laborCents: 4275,
          materialCents: 8900,
          explicitCents: 18500,
          totalCents: 31675,
          downtimeMinutes: 84,
        },
      ],
    });
    expect(csv).toContain('"LM-02","Línea, laminación"');
    expect(csv).toContain('"316.75"');
  });
});
