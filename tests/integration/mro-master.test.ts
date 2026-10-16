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
    permissionCodes: ["inventory.manage"],
    fullAreaAccess: true,
    areaIds: [],
    fullWarehouseAccess: true,
    warehouseIds: [],
  } as unknown as DemoUserSession;
  return {
    db: binding.db,
    admin,
    operations: await import("@/lib/server/operations/mro-master"),
  };
}

describe("MRO master data without stock mutation", () => {
  it("creates catalog, supplier, offer, substitute and policy while leaving ledger unchanged", async () => {
    const { db, admin, operations } = await fixture();
    const category = await operations.saveMroMaster(admin, "req-category", {
      type: "CATEGORY",
      code: "BEARING",
      name: "Rodamientos",
    });
    const warehouse = await operations.saveMroMaster(admin, "req-wh", {
      type: "WAREHOUSE",
      code: "MRO-01",
      name: "Almacén técnico",
      status: "ACTIVE",
    });
    const bin = await operations.saveMroMaster(admin, "req-bin", {
      type: "BIN",
      warehouseId: warehouse.id,
      code: "A-01",
      description: "Estantería A",
      status: "ACTIVE",
    });
    const vendor = await operations.saveMroMaster(admin, "req-vendor", {
      type: "VENDOR",
      code: "SKF",
      name: "Distribuidor SKF",
      category: "MRO",
      paymentTerms: "NET30",
      currency: "EUR",
      leadTimeDays: 5,
      status: "ACTIVE",
    });
    const first = await operations.saveMroMaster(admin, "req-part-1", {
      type: "PART",
      sku: "BRG-6205",
      name: "Rodamiento 6205",
      description: "Rodamiento estándar",
      categoryId: category.id,
      unit: "ud",
      standardCost: 12,
      currency: "EUR",
      status: "ACTIVE",
    });
    const second = await operations.saveMroMaster(admin, "req-part-2", {
      type: "PART",
      sku: "BRG-6205-ALT",
      name: "Rodamiento alternativo",
      description: "Sustituto aprobado",
      categoryId: category.id,
      unit: "ud",
      standardCost: 10,
      currency: "EUR",
      status: "ACTIVE",
    });
    await operations.saveMroMaster(admin, "req-policy", {
      type: "POLICY",
      partId: first.id,
      primaryVendorId: vendor.id,
      critical: true,
      minStock: 2,
      maxStock: 20,
      reorderPoint: 5,
      leadTimeDays: 5,
    });
    await operations.saveMroMaster(admin, "req-offer", {
      type: "OFFER",
      partId: first.id,
      vendorId: vendor.id,
      vendorSku: "SKF-6205",
      unitPrice: 11,
      currency: "EUR",
      minimumOrderQuantity: 1,
      leadTimeDays: 5,
      preferred: true,
    });
    await operations.saveMroMaster(admin, "req-sub", {
      type: "SUBSTITUTE",
      partId: first.id,
      substitutePartId: second.id,
      approvalStatus: "APPROVED",
    });
    await operations.saveMroMaster(admin, "req-cost", {
      type: "PART",
      id: first.id,
      sku: "BRG-6205",
      name: "Rodamiento 6205",
      description: "Rodamiento estándar",
      categoryId: category.id,
      unit: "ud",
      standardCost: 18,
      currency: "EUR",
      status: "ACTIVE",
    });
    expect(
      (
        await db
          .prepare(
            "SELECT average_cost AS cost FROM part_site_policies WHERE part_id=?",
          )
          .bind(first.id)
          .first<{ cost: number }>()
      )?.cost,
    ).toBe(12);
    expect(
      (
        await db
          .prepare(
            "SELECT unit_price AS price FROM part_vendor_offers WHERE part_id=?",
          )
          .bind(first.id)
          .first<{ price: number }>()
      )?.price,
    ).toBe(11);
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM inventory_movements")
          .first<{ count: number }>()
      )?.count,
    ).toBe(0);
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM stock_levels")
          .first<{ count: number }>()
      )?.count,
    ).toBe(0);
    expect(
      (
        await db
          .prepare("SELECT warehouse_id AS id FROM warehouse_bins WHERE id=?")
          .bind(bin.id)
          .first<{ id: string }>()
      )?.id,
    ).toBe(warehouse.id);
    expect(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  }, 60000);

  it("first physical count on an imported part creates one balance and ledger entry atomically", async () => {
    const { db, admin, operations } = await fixture();
    const category = await operations.saveMroMaster(admin, "category", {
      type: "CATEGORY",
      code: "MRO",
      name: "Recambios",
    });
    const part = await operations.saveMroMaster(admin, "part", {
      type: "PART",
      sku: "BRG-01",
      name: "Rodamiento",
      description: "Rodamiento de ensayo",
      categoryId: category.id,
      unit: "ud",
      standardCost: 12.5,
      currency: "EUR",
      status: "ACTIVE",
    });
    await operations.saveMroMaster(admin, "policy", {
      type: "POLICY",
      partId: part.id,
      critical: true,
      minStock: 1,
      maxStock: 20,
      reorderPoint: 2,
      leadTimeDays: 5,
    });
    const warehouse = await operations.saveMroMaster(admin, "warehouse", {
      type: "WAREHOUSE",
      code: "MRO-01",
      name: "Almacén técnico",
      status: "ACTIVE",
    });
    const bin = await operations.saveMroMaster(admin, "bin", {
      type: "BIN",
      warehouseId: warehouse.id,
      code: "A-01",
      description: "Estantería A",
      status: "ACTIVE",
    });
    const { recordPhysicalCount } =
      await import("@/lib/server/operations/physical-count");
    const input = {
      partId: part.id,
      binId: bin.id,
      expectedVersion: 0 as const,
      countedQuantity: 7,
      reason: "Inventario inicial piloto",
    };
    const outcomes = await Promise.allSettled(
      [0, 1].map(() =>
        recordPhysicalCount(
          { session: admin, requestId: crypto.randomUUID() },
          input,
        ),
      ),
    );
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.find((outcome) => outcome.status === "rejected"),
    ).toMatchObject({ reason: { code: "CONCURRENT_MODIFICATION" } });
    const stock = await db
      .prepare(
        "SELECT id,on_hand AS physical,reserved,version FROM stock_levels WHERE part_id=? AND bin_id=?",
      )
      .bind(part.id, bin.id)
      .first<{
        id: string;
        physical: number;
        reserved: number;
        version: number;
      }>();
    expect(stock).toMatchObject({ physical: 7, reserved: 0, version: 1 });
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM inventory_movements WHERE part_id=? AND movement_type='ADJUSTMENT'",
          )
          .bind(part.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    const corrected = await recordPhysicalCount(
      { session: admin, requestId: crypto.randomUUID() },
      {
        stockId: stock!.id,
        expectedVersion: 1,
        countedQuantity: 6,
        reason: "Segundo conteo verificado",
      },
    );
    expect(corrected).toMatchObject({ delta: -1, physical: 6, available: 6 });
    expect(
      (
        await db
          .prepare(
            "SELECT SUM(delta_on_hand) AS balance FROM inventory_movements WHERE part_id=?",
          )
          .bind(part.id)
          .first<{ balance: number }>()
      )?.balance,
    ).toBe(6);
    expect(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  }, 60000);
});
