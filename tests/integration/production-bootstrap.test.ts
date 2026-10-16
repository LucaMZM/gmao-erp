import { afterAll, describe, expect, it, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const binding = vi.hoisted(() => ({ db: null as unknown as D1Database }));
vi.mock("@/db", () => ({ getD1: () => binding.db }));
vi.mock("@/lib/server/runtime-mode", () => ({
  applicationMode: () => "PRODUCTION",
}));

const runtimes: Miniflare[] = [];
async function cleanProduction() {
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
  const database = await import("@/lib/server/database");
  await database.ensureDatabase();
  return {
    db: binding.db,
    setup: await import("@/lib/server/production-bootstrap"),
  };
}

afterAll(async () => {
  for (const runtime of runtimes) await runtime.dispose();
});

const input = {
  organizationCode: "PILOT-01",
  organizationName: "Envases Mediterráneo, S.L.",
  siteCode: "ES-VAL-01",
  siteName: "Planta Valencia",
  siteShortName: "Valencia",
  city: "Valencia",
  adminEmail: "administracion@envases.example",
  adminName: "María Ferrer",
  adminPassword: "SecurePilot2026!Long",
};
const token = "secure-one-time-bootstrap-token-0123456789";

describe("production bootstrap", () => {
  it("migrates an empty database without demo organization, users or passwords", async () => {
    const { db, setup } = await cleanProduction();
    expect(await setup.productionNeedsSetup()).toBe(true);
    const counts = await db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM organizations) AS organizations, (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM roles) AS roles, (SELECT COUNT(*) FROM permission_definitions) AS permissions",
      )
      .first<{
        organizations: number;
        users: number;
        roles: number;
        permissions: number;
      }>();
    expect(counts?.organizations).toBe(0);
    expect(counts?.users).toBe(0);
    expect(counts?.roles).toBeGreaterThan(0);
    expect(counts?.permissions).toBeGreaterThan(0);
  }, 60000);

  it("requires the private token and atomically provisions one scoped administrator", async () => {
    const { db, setup } = await cleanProduction();
    await expect(
      setup.bootstrapProduction(input, "wrong", token),
    ).rejects.toMatchObject({ code: "SETUP_TOKEN_INVALID" });
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM organizations")
          .first<{ count: number }>()
      )?.count,
    ).toBe(0);
    await setup.bootstrapProduction(input, token, token);
    expect(await setup.productionNeedsSetup()).toBe(false);
    const row = await db
      .prepare(
        `SELECT u.email, u.password_hash AS passwordHash, m.role_key AS roleKey,
      s.full_area_access AS fullAreaAccess, s.full_warehouse_access AS fullWarehouseAccess
      FROM users u JOIN memberships m ON m.user_id=u.id JOIN membership_site_scopes s ON s.membership_id=m.id`,
      )
      .first<{
        email: string;
        passwordHash: string;
        roleKey: string;
        fullAreaAccess: number;
        fullWarehouseAccess: number;
      }>();
    expect(row).toMatchObject({
      email: input.adminEmail,
      roleKey: "ADMIN",
      fullAreaAccess: 1,
      fullWarehouseAccess: 1,
    });
    expect(row?.passwordHash).not.toBe(input.adminPassword);
    await expect(
      setup.bootstrapProduction(input, token, token),
    ).rejects.toMatchObject({ code: "ALREADY_PROVISIONED" });
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM users")
          .first<{ count: number }>()
      )?.count,
    ).toBe(1);
    expect(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  }, 60000);
});
