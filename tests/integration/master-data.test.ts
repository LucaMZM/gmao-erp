import { afterAll, describe, expect, it, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { DemoUserSession } from "@/lib/server/auth";

const binding = vi.hoisted(() => ({ db: null as unknown as D1Database }));
vi.mock("@/db", () => ({ getD1: () => binding.db }));
vi.mock("@/lib/server/runtime-mode", () => ({
  applicationMode: () => "PRODUCTION",
}));
const runtimes: Miniflare[] = [];
afterAll(async () => {
  for (const runtime of runtimes) await runtime.dispose();
});

async function fixture() {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('test')}}",
      compatibilityDate: "2026-09-01",
      d1Databases: ["DB"],
    }),
  );
  runtimes.push(runtime);
  binding.db = (await runtime.getD1Database("DB")) as unknown as D1Database;
  vi.resetModules();
  const { ensureDatabase } = await import("@/lib/server/database");
  await ensureDatabase();
  const { bootstrapProduction } =
    await import("@/lib/server/production-bootstrap");
  const token = "secure-one-time-bootstrap-token-0123456789";
  await bootstrapProduction(
    {
      organizationCode: "REAL",
      organizationName: "Empresa Real",
      siteCode: "ES-PL-01",
      siteName: "Planta Principal",
      siteShortName: "Principal",
      city: "Valencia",
      adminEmail: "admin@real.example",
      adminName: "Ana García",
      adminPassword: "SecurePilot2026!Long",
    },
    token,
    token,
  );
  const identity = await binding.db
    .prepare(
      "SELECT o.id AS organizationId,s.id AS siteId,u.id AS userId FROM organizations o JOIN sites s ON s.organization_id=o.id JOIN users u ON 1=1 LIMIT 1",
    )
    .first<{ organizationId: string; siteId: string; userId: string }>();
  const session = {
    ...identity,
    permissionCodes: ["asset.manage"],
    fullAreaAccess: true,
    areaIds: [],
    fullWarehouseAccess: true,
    warehouseIds: [],
  } as unknown as DemoUserSession;
  const operation = await import("@/lib/server/operations/master-data");
  return { db: binding.db, session, operation };
}

describe("scoped master data", () => {
  it("creates locations/assets, prevents cycles and preserves retirement history", async () => {
    const { db, session, operation } = await fixture();
    const area = await operation.createLocation(session, "req-area", {
      code: "AREA-01",
      name: "Área de proceso",
      type: "AREA",
    });
    const line = await operation.createLocation(session, "req-line", {
      code: "LINE-01",
      name: "Línea principal",
      type: "PRODUCTION_LINE",
      parentId: area.id,
    });
    await expect(
      operation.updateLocation(session, "req-cycle", area.id, {
        code: "AREA-01",
        name: "Área de proceso",
        type: "AREA",
        parentId: line.id,
      }),
    ).rejects.toMatchObject({ code: "HIERARCHY_CYCLE" });
    await db
      .prepare(
        "INSERT INTO asset_classes (id,organization_id,code,name,family) VALUES (?,?,?,?,?)",
      )
      .bind(
        "class-press",
        session.organizationId,
        "PRESS",
        "Prensa",
        "PRODUCTION",
      )
      .run();
    const item = await operation.createAsset(session, "req-asset", {
      code: "PR-01",
      name: "Prensa principal",
      description: "Equipo piloto",
      kind: "EQUIPMENT",
      functionalLocationId: line.id,
      assetClassId: "class-press",
      status: "OPERATING",
      criticality: "HIGH",
    });
    expect(item.code).toBe("PR-01");
    const { tenantScope } = await import("@/lib/server/repositories/shared");
    const { listAssets, getAssetDetail } =
      await import("@/lib/server/repositories/assets");
    const { getOverview } = await import("@/lib/server/repositories/overview");
    const { getAssetReliability } =
      await import("@/lib/server/repositories/reliability");
    const scope = tenantScope(session);
    const scoreBefore = (await listAssets(scope, {})).items.find(
      (row) => row.id === item.id,
    )?.healthScore;
    expect(scoreBefore).toBe(
      (await getAssetDetail(scope, item.code))?.asset.healthScore,
    );
    expect(scoreBefore).toBe(
      (await getAssetReliability(scope, item.id))?.metrics.healthScore,
    );
    expect(
      (await getOverview(scope)).risks.find((risk) => risk.id === item.id)
        ?.healthScore ?? scoreBefore,
    ).toBe(scoreBefore);
    await operation.updateAsset(session, "req-health", item.id, {
      code: "PR-01",
      name: "Prensa principal",
      description: "Equipo piloto",
      kind: "EQUIPMENT",
      functionalLocationId: line.id,
      assetClassId: "class-press",
      status: "DOWN",
      criticality: "CRITICAL",
    });
    const scoreAfter = (await listAssets(scope, {})).items.find(
      (row) => row.id === item.id,
    )?.healthScore;
    expect(scoreAfter).toBeLessThan(scoreBefore!);
    expect(scoreAfter).toBe(
      (await getAssetDetail(scope, item.code))?.asset.healthScore,
    );
    expect(scoreAfter).toBe(
      (await getAssetReliability(scope, item.id))?.metrics.healthScore,
    );
    expect(
      (await getOverview(scope)).risks.find((risk) => risk.id === item.id)
        ?.healthScore,
    ).toBe(scoreAfter);
    const child = await operation.createAsset(session, "req-child", {
      code: "PR-01-MOT",
      name: "Motor principal",
      description: "Motor de la prensa",
      kind: "COMPONENT",
      functionalLocationId: line.id,
      parentAssetId: item.id,
      assetClassId: "class-press",
      status: "OPERATING",
      criticality: "MEDIUM",
    });
    await expect(
      operation.updateAsset(session, "req-asset-cycle", item.id, {
        code: "PR-01",
        name: "Prensa principal",
        description: "Equipo piloto",
        kind: "EQUIPMENT",
        functionalLocationId: line.id,
        parentAssetId: child.id,
        assetClassId: "class-press",
        status: "OPERATING",
        criticality: "HIGH",
      }),
    ).rejects.toMatchObject({ code: "HIERARCHY_CYCLE" });
    await expect(
      operation.updateAsset(session, "req-retire", item.id, {
        code: "PR-01",
        name: "Prensa principal",
        description: "Equipo piloto",
        kind: "EQUIPMENT",
        functionalLocationId: line.id,
        assetClassId: "class-press",
        status: "RETIRED",
        criticality: "HIGH",
      }),
    ).rejects.toMatchObject({ code: "ASSET_IN_USE" });
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS count FROM audit_entries WHERE action='ASSET_CREATED'",
          )
          .first<{ count: number }>()
      )?.count,
    ).toBe(2);
    expect(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  }, 60000);
});
