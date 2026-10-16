import { afterAll, describe, expect, it, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { DemoUserSession } from "@/lib/server/auth";
import { enterprisePermissions } from "@/lib/domain/governance";

const binding = vi.hoisted(() => ({ db: null as unknown as D1Database }));
vi.mock("@/db", () => ({ getD1: () => binding.db }));
vi.mock("@/lib/server/runtime-mode", () => ({
  applicationMode: () => "PRODUCTION",
}));
let runtime: Miniflare;
const rehearsalRoot = mkdtempSync(join(tmpdir(), "mazmi-pilot-factory-"));
const activePath = join(rehearsalRoot, "active");
const backupPath = join(rehearsalRoot, "backup");
afterAll(async () => {
  await runtime?.dispose();
  rmSync(rehearsalRoot, { recursive: true, force: true });
});

describe("pilot factory — clean production, no demo seed", () => {
  it("imports its own data, schedules and executes PM, reconciles MRO and reaches reporting", async () => {
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('test')}}",
        compatibilityDate: "2026-09-01",
        d1Databases: ["DB"],
        r2Buckets: ["FILES"],
        resourcePersistencePath: activePath,
      }),
    );
    const db = (await runtime.getD1Database("DB")) as unknown as D1Database;
    binding.db = db;
    vi.resetModules();
    await (await import("@/lib/server/database")).ensureDatabase();
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM organizations")
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
    const bootstrap = await import("@/lib/server/production-bootstrap");
    const token = "isolated-pilot-bootstrap-token-0123456789";
    await bootstrap.bootstrapProduction(
      {
        organizationCode: "PILOT-TEST",
        organizationName: "Convertidos del Turia, S.L.",
        siteCode: "ES-TUR",
        siteName: "Planta Turia",
        siteShortName: "Turia",
        city: "Valencia",
        adminEmail: "admin@turia.example",
        adminName: "María Sanz",
        adminPassword: "PilotPassword2026!Long",
      },
      token,
      token,
    );
    const identity = await db
      .prepare(
        "SELECT o.id AS organizationId,s.id AS siteId,u.id AS userId FROM organizations o JOIN sites s ON s.organization_id=o.id JOIN users u ON u.email='admin@turia.example'",
      )
      .first<{ organizationId: string; siteId: string; userId: string }>();
    expect(identity).toBeTruthy();
    const admin = {
      ...identity!,
      siteCode: "ES-TUR",
      siteIds: [identity!.siteId],
      roleKey: "ADMIN",
      permissionCodes: [...enterprisePermissions],
      fullAreaAccess: true,
      areaIds: [],
      fullWarehouseAccess: true,
      warehouseIds: [],
    } as unknown as DemoUserSession;
    const ctx = (session: DemoUserSession = admin) => ({
      session,
      requestId: crypto.randomUUID(),
    });

    const masters = await import("@/lib/server/operations/master-data");
    const area = await masters.createLocation(admin, "area", {
      code: "LAM",
      name: "Nave de laminación",
      type: "AREA",
    });
    const line = await masters.createLocation(admin, "line", {
      code: "LM-01",
      name: "Línea LM-01",
      type: "PRODUCTION_LINE",
      parentId: area.id,
    });
    const assetClass = await masters.createAssetClass(admin, "class", {
      code: "LAM_LINE",
      name: "Línea de laminación",
      family: "PRODUCTION",
    });
    const manualAsset = await masters.createAsset(admin, "asset", {
      code: "LM-01",
      name: "Laminadora LM-01",
      description: "Línea principal del ensayo",
      kind: "EQUIPMENT",
      functionalLocationId: line.id,
      assetClassId: assetClass.id,
      status: "OPERATING",
      criticality: "HIGH",
    });
    expect(manualAsset.code).toBe("LM-01");

    const imports = await import("@/lib/server/operations/imports");
    const locationsFile = {
      kind: "LOCATIONS" as const,
      csv: "code,name,type,parentCode\nIMP-AREA,Nave de impresión,AREA,\nPR-01,Línea de impresión PR-01,PRODUCTION_LINE,IMP-AREA\n",
      mapping: {
        code: "code",
        name: "name",
        type: "type",
        parentCode: "parentCode",
      },
      sourceName: "ubicaciones-piloto.csv",
    };
    const locationsPreview = await imports.previewImport(admin, locationsFile);
    expect(locationsPreview.errors).toEqual([]);
    expect(locationsPreview.created).toBe(2);
    expect(
      await imports.commitImport(
        admin,
        "locations-import",
        locationsFile,
        locationsPreview.hash,
      ),
    ).toMatchObject({ created: 2, failed: 0 });
    await masters.createAssetClass(admin, "print-class", {
      code: "PRINT_LINE",
      name: "Línea de impresión",
      family: "PRODUCTION",
    });
    const assetsFile = {
      kind: "ASSETS" as const,
      csv: "code,name,locationCode,classCode,criticality,parentCode\nPR-01,Impresora PR-01,PR-01,PRINT_LINE,HIGH,\n",
      mapping: {
        code: "code",
        name: "name",
        locationCode: "locationCode",
        classCode: "classCode",
        criticality: "criticality",
        parentCode: "parentCode",
      },
      sourceName: "activos-piloto.csv",
    };
    const assetsPreview = await imports.previewImport(admin, assetsFile);
    expect(assetsPreview.errors).toEqual([]);
    expect(
      await imports.commitImport(
        admin,
        "assets-import",
        assetsFile,
        assetsPreview.hash,
      ),
    ).toMatchObject({ created: 1, failed: 0 });
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM assets WHERE code='PR-01'")
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    const vendorFile = {
      kind: "SUPPLIERS" as const,
      csv: "code,name,category,email\nRODAMIENTOS,Rodamientos Turia,MRO,compras@turia.example\n",
      mapping: {
        code: "code",
        name: "name",
        category: "category",
        email: "email",
      },
      sourceName: "proveedores.csv",
    };
    const vendorPreview = await imports.previewImport(admin, vendorFile);
    expect(vendorPreview.errors).toEqual([]);
    await imports.commitImport(
      admin,
      "vendor-import",
      vendorFile,
      vendorPreview.hash,
    );
    const mro = await import("@/lib/server/operations/mro-master");
    await mro.saveMroMaster(admin, "cat", {
      type: "CATEGORY",
      code: "BEARING",
      name: "Rodamientos",
    });
    const partFile = {
      kind: "PARTS" as const,
      csv: "sku,name,categoryCode,unit,standardCost\nBRG-01,Rodamiento 6205,BEARING,ud,12.5\n",
      mapping: {
        sku: "sku",
        name: "name",
        categoryCode: "categoryCode",
        unit: "unit",
        standardCost: "standardCost",
      },
      sourceName: "recambios.csv",
    };
    const partPreview = await imports.previewImport(admin, partFile);
    expect(partPreview.errors).toEqual([]);
    await imports.commitImport(
      admin,
      "parts-import",
      partFile,
      partPreview.hash,
    );
    const part = await db
      .prepare("SELECT id FROM parts WHERE sku='BRG-01'")
      .first<{ id: string }>();
    expect(part).toBeTruthy();
    const warehouse = await mro.saveMroMaster(admin, "wh", {
      type: "WAREHOUSE",
      code: "MRO",
      name: "Almacén MRO",
      status: "ACTIVE",
    });
    const bin = await mro.saveMroMaster(admin, "bin", {
      type: "BIN",
      warehouseId: warehouse.id,
      code: "A-01",
      description: "Estantería A",
      status: "ACTIVE",
    });
    await mro.saveMroMaster(admin, "policy", {
      type: "POLICY",
      partId: part!.id,
      critical: true,
      minStock: 1,
      maxStock: 20,
      reorderPoint: 2,
      leadTimeDays: 5,
    });
    const count = await (
      await import("@/lib/server/operations/physical-count")
    ).recordPhysicalCount(ctx(), {
      partId: part!.id,
      binId: bin.id,
      expectedVersion: 0,
      countedQuantity: 5,
      reason: "Inventario inicial de piloto",
    });
    expect(count).toMatchObject({ physical: 5, available: 5, delta: 5 });
    const { recordPhysicalCount } =
      await import("@/lib/server/operations/physical-count");
    const initialStock = await db
      .prepare(
        "SELECT id,version FROM stock_levels WHERE part_id=? AND bin_id=?",
      )
      .bind(part!.id, bin.id)
      .first<{ id: string; version: number }>();
    expect(initialStock).toBeTruthy();
    expect(
      await recordPhysicalCount(ctx(), {
        stockId: initialStock!.id,
        expectedVersion: initialStock!.version,
        countedQuantity: 7,
        reason: "Recuento positivo de validación",
      }),
    ).toMatchObject({ physical: 7, reserved: 0, available: 7, delta: 2 });

    const identityAdmin =
      await import("@/lib/server/operations/identity-admin");
    const manager = await identityAdmin.createManagedUser(admin, "manager", {
      email: "responsable@turia.example",
      fullName: "Ana Ibáñez",
      jobTitle: "Responsable de mantenimiento",
      roleKey: "MAINTENANCE_MANAGER",
      password: "Temporary2026!Long",
      fullAreaAccess: true,
      areaIds: [],
      fullWarehouseAccess: true,
      warehouseIds: [],
    });
    const technician = await identityAdmin.createManagedUser(admin, "tech", {
      email: "tecnico@turia.example",
      fullName: "Javier Costa",
      jobTitle: "Técnico",
      roleKey: "TECHNICIAN",
      password: "Temporary2026!Long",
      fullAreaAccess: false,
      areaIds: [area.id],
      fullWarehouseAccess: false,
      warehouseIds: [warehouse.id],
    });
    const techSession = {
      ...admin,
      userId: technician.id,
      roleKey: "TECHNICIAN",
      permissionCodes: [
        "workorder.execute",
        "inventory.consume",
        "incident.report",
      ],
      fullAreaAccess: false,
      areaIds: [area.id],
      fullWarehouseAccess: false,
      warehouseIds: [warehouse.id],
    } as DemoUserSession;
    const preventive = await import("@/lib/server/operations/preventive");
    const firstDueAt = new Date(Date.now() - 60_000).toISOString();
    const plan = await preventive.createMaintenancePlan(ctx(), {
      assetId: manualAsset.id,
      ownerId: manager.id,
      title: "Inspección de rodillos LM-01",
      description: "Preventivo piloto verificable",
      criticality: "MEDIUM",
      priority: "P4_NORMAL",
      estimatedMinutes: 30,
      triggerMode: "CALENDAR",
      calendarUnit: "DAY",
      calendarInterval: 30,
      firstDueAt,
      leadDays: 0,
      tasks: [
        {
          title: "Comprobar rodillos",
          required: true,
          responseType: "CONFIRMATION",
        },
      ],
      skills: [],
      certificationIds: [],
      materials: [],
    });
    const scheduler = await (
      await import("@/lib/server/preventive-scheduler")
    ).runPreventiveScheduler();
    expect(scheduler.status).toBe("COMPLETE");
    expect(scheduler.created).toBe(1);
    const order = await db
      .prepare(
        "SELECT number,id,status FROM work_orders WHERE maintenance_plan_id=(SELECT id FROM maintenance_plans WHERE code=?)",
      )
      .bind(plan.code)
      .first<{ number: string; id: string; status: string }>();
    expect(order?.status).toBe("PLANNED");

    const work = await import("@/lib/server/operations/work-orders");
    await work.scheduleWorkOrder(ctx(), order!.number, {
      plannedStart: new Date().toISOString(),
      plannedEnd: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    await work.assignTechnician(ctx(), order!.number, technician.id);
    const labor = await work.startWork(ctx(techSession), order!.number);
    const field = await import("@/lib/server/operations/field");
    const task = await db
      .prepare("SELECT id FROM work_order_tasks WHERE work_order_id=? LIMIT 1")
      .bind(order!.id)
      .first<{ id: string }>();
    expect(task).toBeTruthy();
    await field.answerChecklistTask(ctx(techSession), order!.number, {
      taskId: task!.id,
      value: true,
    });
    const evidenceBytes = Uint8Array.from([37, 80, 68, 70, 45, 49, 46, 52, 10]);
    const evidenceKey = `${admin.organizationId}/${admin.siteId}/pilot-evidence.pdf`;
    await (
      await runtime.getR2Bucket("FILES")
    ).put(evidenceKey, evidenceBytes, {
      httpMetadata: { contentType: "application/pdf" },
    });
    const evidenceHash = createHash("sha256")
      .update(evidenceBytes)
      .digest("hex");
    await field.createEvidenceMetadata(ctx(techSession), order!.number, {
      id: "pilot-evidence",
      kind: "DOCUMENT",
      stage: "AFTER",
      description: "Informe de inspección",
      storageKey: evidenceKey,
      fileName: "inspeccion.pdf",
      contentType: "application/pdf",
      sizeBytes: evidenceBytes.byteLength,
      checksumSha256: evidenceHash,
    });
    const materials = await import("@/lib/server/operations/materials");
    const material = await materials.addPlannedMaterial(
      ctx(),
      order!.number,
      part!.id,
      1,
    );
    await materials.reserveMaterial(
      ctx(),
      order!.number,
      material.materialId,
      1,
    );
    await materials.consumeMaterial(
      ctx(techSession),
      order!.number,
      material.materialId,
      1,
    );
    const downtime = await import("@/lib/server/operations/downtime");
    const event = await downtime.startDowntime(
      ctx(techSession),
      order!.number,
      {
        kind: "PLANNED",
        productionImpact: "FULL_STOP",
        cause: "Intervención programada",
      },
    );
    await downtime.endDowntime(ctx(techSession), order!.number, event.id);
    await work.stopLaborSession(
      ctx(techSession),
      order!.number,
      labor.laborSessionId,
    );
    await work.completeWorkOrder(ctx(techSession), order!.number, {
      diagnosis: "Rodillos revisados; sin anomalías",
      solution: "Inspección completada y equipo liberado",
    });
    await work.closeWorkOrder(ctx(), order!.number);
    const stockBeforeRecount = await db
      .prepare(
        "SELECT id,version,on_hand AS physical FROM stock_levels WHERE part_id=? AND bin_id=?",
      )
      .bind(part!.id, bin.id)
      .first<{ id: string; version: number; physical: number }>();
    expect(stockBeforeRecount?.physical).toBe(6);
    expect(
      await recordPhysicalCount(ctx(), {
        stockId: stockBeforeRecount!.id,
        expectedVersion: stockBeforeRecount!.version,
        countedQuantity: 5,
        reason: "Recuento negativo de validación",
      }),
    ).toMatchObject({ physical: 5, reserved: 0, available: 5, delta: -1 });
    expect(
      (
        await db
          .prepare("SELECT status FROM work_orders WHERE id=?")
          .bind(order!.id)
          .first<{ status: string }>()
      )?.status,
    ).toBe("CLOSED");
    const stock = await db
      .prepare(
        "SELECT on_hand AS physical,reserved FROM stock_levels WHERE part_id=? AND bin_id=?",
      )
      .bind(part!.id, bin.id)
      .first<{ physical: number; reserved: number }>();
    expect(stock).toMatchObject({ physical: 5, reserved: 0 });
    expect(
      (
        await db
          .prepare(
            "SELECT SUM(delta_on_hand) AS delta FROM inventory_movements WHERE part_id=?",
          )
          .bind(part!.id)
          .first<{ delta: number }>()
      )?.delta,
    ).toBe(5);
    const { tenantScope } = await import("@/lib/server/repositories/shared");
    const { getAssetReliability } =
      await import("@/lib/server/repositories/reliability");
    const { getReportingData, listExportAssetCosts } =
      await import("@/lib/server/repositories/reports");
    expect(
      await getAssetReliability(tenantScope(admin), manualAsset.id),
    ).toBeTruthy();
    const from = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(await getReportingData(admin, { from, to })).toBeTruthy();
    expect(
      (await listExportAssetCosts(admin, { from, to }, "", 200)).some(
        (row) => row.id === manualAsset.id,
      ),
    ).toBe(true);
    expect(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
    // Restore only this disposable local D1+R2 persistence tree. After the
    // simulated loss the application repositories must still read the pilot.
    await runtime.dispose();
    cpSync(activePath, backupPath, { recursive: true });
    rmSync(activePath, { recursive: true, force: true });
    cpSync(backupPath, activePath, { recursive: true });
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('test')}}",
        compatibilityDate: "2026-09-01",
        d1Databases: ["DB"],
        r2Buckets: ["FILES"],
        resourcePersistencePath: activePath,
      }),
    );
    binding.db = (await runtime.getD1Database("DB")) as unknown as D1Database;
    vi.resetModules();
    expect(
      (await (await import("@/lib/server/database")).databaseHealth())
        .schemaVersion,
    ).toBe("0013_preventive_scheduler");
    expect(
      (
        await binding.db
          .prepare("SELECT status FROM work_orders WHERE id=?")
          .bind(order!.id)
          .first<{ status: string }>()
      )?.status,
    ).toBe("CLOSED");
    expect(
      await (
        await import("@/lib/server/repositories/reliability")
      ).getAssetReliability(tenantScope(admin), manualAsset.id),
    ).toBeTruthy();
    const restoredEvidence = await (
      await runtime.getR2Bucket("FILES")
    ).get(evidenceKey);
    expect(restoredEvidence).toBeTruthy();
    expect(
      createHash("sha256")
        .update(new Uint8Array(await restoredEvidence!.arrayBuffer()))
        .digest("hex"),
    ).toBe(
      (
        await binding.db
          .prepare(
            "SELECT checksum_sha256 AS hash FROM evidence_items WHERE id='pilot-evidence'",
          )
          .first<{ hash: string }>()
      )?.hash,
    );
    expect(
      (await binding.db.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  }, 120_000);
});
