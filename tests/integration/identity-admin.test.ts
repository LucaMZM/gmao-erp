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
    permissionCodes: ["identity.manage"],
    fullAreaAccess: true,
    areaIds: [],
    fullWarehouseAccess: true,
    warehouseIds: [],
  } as unknown as DemoUserSession;
  return {
    db: binding.db,
    admin,
    operations: await import("@/lib/server/operations/identity-admin"),
  };
}

describe("identity administration", () => {
  it("provisions a scoped user and revokes access when disabled", async () => {
    const { db, admin, operations } = await fixture();
    const created = await operations.createManagedUser(admin, "req-create", {
      email: "tecnico@real.example",
      fullName: "Javier Costa",
      jobTitle: "Técnico",
      roleKey: "TECHNICIAN",
      password: "Temporary2026!Long",
      fullAreaAccess: false,
      areaIds: [],
      fullWarehouseAccess: false,
      warehouseIds: [],
    });
    const scope = await db
      .prepare(
        "SELECT full_area_access AS fullAreaAccess,full_warehouse_access AS fullWarehouseAccess FROM membership_site_scopes WHERE membership_id=(SELECT id FROM memberships WHERE user_id=?)",
      )
      .bind(created.id)
      .first<{ fullAreaAccess: number; fullWarehouseAccess: number }>();
    expect(scope).toMatchObject({ fullAreaAccess: 0, fullWarehouseAccess: 0 });
    const changed = await operations.updateManagedUser(
      admin,
      "req-update",
      created.id,
      {
        roleKey: "TECHNICIAN",
        status: "INACTIVE",
        fullAreaAccess: false,
        areaIds: [],
        fullWarehouseAccess: false,
        warehouseIds: [],
      },
    );
    expect(changed.status).toBe("INACTIVE");
    expect(
      (
        await db
          .prepare("SELECT status FROM memberships WHERE user_id=?")
          .bind(created.id)
          .first<{ status: string }>()
      )?.status,
    ).toBe("INACTIVE");
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS count FROM audit_entries WHERE entity_type='USER' AND entity_id=?",
          )
          .bind(created.id)
          .first<{ count: number }>()
      )?.count,
    ).toBe(2);
    await expect(
      operations.updateManagedUser(admin, "req-self", admin.userId, {
        roleKey: "VIEWER",
        status: "INACTIVE",
        fullAreaAccess: true,
        areaIds: [],
        fullWarehouseAccess: true,
        warehouseIds: [],
      }),
    ).rejects.toMatchObject({ code: "SELF_LOCKOUT" });
    expect(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  }, 60000);

  it("denies missing permission and scope escalation", async () => {
    const { db, admin, operations } = await fixture();
    const limited = {
      ...admin,
      fullAreaAccess: false,
      areaIds: [],
      fullWarehouseAccess: false,
      warehouseIds: [],
    } as DemoUserSession;
    await expect(
      operations.createManagedUser(limited, "req-scope", {
        email: "foo@real.example",
        fullName: "Foo Bar",
        jobTitle: "Técnico",
        roleKey: "TECHNICIAN",
        password: "Temporary2026!Long",
        fullAreaAccess: true,
        areaIds: [],
        fullWarehouseAccess: false,
        warehouseIds: [],
      }),
    ).rejects.toMatchObject({ code: "AREA_SCOPE_ESCALATION" });
    await expect(
      operations.createManagedUser(
        { ...admin, permissionCodes: [] } as DemoUserSession,
        "req-deny",
        {
          email: "foo@real.example",
          fullName: "Foo Bar",
          jobTitle: "Técnico",
          roleKey: "TECHNICIAN",
          password: "Temporary2026!Long",
          fullAreaAccess: false,
          areaIds: [],
          fullWarehouseAccess: false,
          warehouseIds: [],
        },
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_MANAGE_DENIED" });
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM users")
          .first<{ count: number }>()
      )?.count,
    ).toBe(1);
  }, 60000);
});
