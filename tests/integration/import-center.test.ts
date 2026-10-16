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
  await (await import("@/lib/server/database")).ensureDatabase();
  const token = "secure-one-time-bootstrap-token-0123456789";
  await (
    await import("@/lib/server/production-bootstrap")
  ).bootstrapProduction(
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
  const admin = {
    ...identity,
    permissionCodes: ["asset.manage", "inventory.manage"],
    fullAreaAccess: true,
    areaIds: [],
    fullWarehouseAccess: true,
    warehouseIds: [],
  } as unknown as DemoUserSession;
  return {
    db: binding.db,
    admin,
    imports: await import("@/lib/server/operations/imports"),
    masters: await import("@/lib/server/operations/master-data"),
    mro: await import("@/lib/server/operations/mro-master"),
  };
}

describe("Import Center on an empty production database", () => {
  it("dry-runs without writes, imports references in order and repeats without duplicates", async () => {
    const { db, admin, imports, masters, mro } = await fixture();
    const locations = {
      kind: "LOCATIONS" as const,
      csv: "code;name;type;parentCode\nAREA-01;Área de producción;AREA;\nLINE-01;Línea 01;PRODUCTION_LINE;AREA-01\n",
      mapping: {
        code: "code",
        name: "name",
        type: "type",
        parentCode: "parentCode",
      },
      sourceName: "ubicaciones.csv",
    };
    const preview = await imports.previewImport(admin, locations);
    expect(preview.errors).toEqual([]);
    expect(preview.created).toBe(2);
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM functional_locations")
          .first<{ count: number }>()
      )?.count,
    ).toBe(0);
    const first = await imports.commitImport(
      admin,
      "req-locations",
      locations,
      preview.hash,
    );
    expect(first.created).toBe(2);
    expect(first.failed).toBe(0);
    const retry = await imports.commitImport(
      admin,
      "req-repeat",
      locations,
      preview.hash,
    );
    expect(retry.jobId).toBe(first.jobId);
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM functional_locations")
          .first<{ count: number }>()
      )?.count,
    ).toBe(2);
    await masters.createAssetClass(admin, "req-class", {
      code: "PRESS",
      name: "Prensa",
      family: "PRODUCTION",
    });
    const assets = {
      kind: "ASSETS" as const,
      csv: "code,name,locationCode,classCode,criticality,parentCode\nPR-01,Prensa principal,LINE-01,PRESS,HIGH,\nPR-01-MOT,Motor principal,LINE-01,PRESS,MEDIUM,PR-01\n",
      mapping: {
        code: "code",
        name: "name",
        locationCode: "locationCode",
        classCode: "classCode",
        criticality: "criticality",
        parentCode: "parentCode",
      },
      sourceName: "activos.csv",
    };
    const assetPreview = await imports.previewImport(admin, assets);
    expect(assetPreview.errors).toEqual([]);
    const imported = await imports.commitImport(
      admin,
      "req-assets",
      assets,
      assetPreview.hash,
    );
    expect(imported.created).toBe(2);
    expect(imported.failed).toBe(0);
    await db
      .prepare(
        "UPDATE assets SET status='DEGRADED',manufacturer='Fabricante existente' WHERE code='PR-01'",
      )
      .run();
    const renamed = {
      ...assets,
      csv: "code,name,locationCode,classCode,criticality,parentCode\nPR-01,Prensa renovada,LINE-01,PRESS,HIGH,\n",
      sourceName: "activos-corregidos.csv",
    };
    const renamedPreview = await imports.previewImport(admin, renamed);
    expect(
      (
        await imports.commitImport(
          admin,
          "req-assets-update",
          renamed,
          renamedPreview.hash,
        )
      ).updated,
    ).toBe(1);
    expect(
      await db
        .prepare(
          "SELECT status,manufacturer,name FROM assets WHERE code='PR-01'",
        )
        .first(),
    ).toMatchObject({
      status: "DEGRADED",
      manufacturer: "Fabricante existente",
      name: "Prensa renovada",
    });
    const category = await mro.saveMroMaster(admin, "req-category", {
      type: "CATEGORY",
      code: "MRO",
      name: "Recambios",
    });
    expect(category.id).toBeTruthy();
    const parts = {
      kind: "PARTS" as const,
      csv: "sku;name;categoryCode;unit;standardCost\nBRG-01;Rodamiento;MRO;ud;12.5\n",
      mapping: {
        sku: "sku",
        name: "name",
        categoryCode: "categoryCode",
        unit: "unit",
        standardCost: "standardCost",
      },
      sourceName: "recambios.csv",
    };
    const partPreview = await imports.previewImport(admin, parts);
    expect(partPreview.errors).toEqual([]);
    expect(
      (await imports.commitImport(admin, "req-parts", parts, partPreview.hash))
        .created,
    ).toBe(1);
    const suppliers = {
      kind: "SUPPLIERS" as const,
      csv: "code,name,category,email\nSKF,Distribuidor SKF,MRO,ventas@skf.example\n",
      mapping: {
        code: "code",
        name: "name",
        category: "category",
        email: "email",
      },
      sourceName: "proveedores.csv",
    };
    const vendorPreview = await imports.previewImport(admin, suppliers);
    expect(vendorPreview.errors).toEqual([]);
    expect(
      (
        await imports.commitImport(
          admin,
          "req-vendors",
          suppliers,
          vendorPreview.hash,
        )
      ).created,
    ).toBe(1);
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS count FROM import_jobs WHERE status='COMPLETE'",
          )
          .first<{ count: number }>()
      )?.count,
    ).toBe(5);
    expect(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  }, 60000);

  it("rejects duplicate identities, missing references and hierarchy cycles in dry-run", async () => {
    const { admin, imports } = await fixture();
    const request = {
      kind: "LOCATIONS" as const,
      csv: "code,name,type,parentCode\nAREA-01,Área uno,AREA,AREA-02\nAREA-02,Área dos,AREA,AREA-01\nAREA-01,Repetida,AREA,\n",
      mapping: {
        code: "code",
        name: "name",
        type: "type",
        parentCode: "parentCode",
      },
      sourceName: "bad.csv",
    };
    const preview = await imports.previewImport(admin, request);
    expect(preview.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["DUPLICATE_IN_FILE", "HIERARCHY_CYCLE"]),
    );
    await expect(
      imports.commitImport(admin, "req-bad", request, preview.hash),
    ).rejects.toMatchObject({ code: "IMPORT_VALIDATION_FAILED" });
  }, 60000);
});
