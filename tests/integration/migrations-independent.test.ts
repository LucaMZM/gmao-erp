import { afterAll, describe, expect, it, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readdirSync, readFileSync } from "node:fs";
import { unstable_splitSqlQuery } from "wrangler";
import { seedDemoDatabase } from "@/db/seed";
import { seedV1BDatabase } from "@/db/seed-v1b";
import { seedV1CDatabase } from "@/db/seed-v1c";
import { seedV1DDatabase } from "@/db/seed-v1d";
import { seedV2ADatabase } from "@/db/seed-v2a";
import { seedV2BDatabase } from "@/db/seed-v2b";

const binding = vi.hoisted(() => ({ db: null as unknown as D1Database }));
vi.mock("@/db", () => ({ getD1: () => binding.db }));
// Migration torture exercises the established demo seed path. Production's
// empty bootstrap is covered separately by production-bootstrap.test.ts.
vi.mock("@/lib/server/runtime-mode", () => ({ applicationMode: () => "DEMO" }));
const runtimes: Miniflare[] = [];
const files = readdirSync("drizzle")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const seeds = [
  seedDemoDatabase,
  seedV1BDatabase,
  seedV1CDatabase,
  seedV1DDatabase,
  seedV2ADatabase,
  seedV2BDatabase,
];

async function database() {
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
  return binding.db;
}

async function historicalSchema(
  db: D1Database,
  version: number,
  ledger = true,
) {
  if (ledger)
    await db
      .prepare(
        "CREATE TABLE _mazmi_migrations (id TEXT PRIMARY KEY NOT NULL,applied_at TEXT NOT NULL)",
      )
      .run();
  for (const file of files.filter((f) => Number(f.slice(0, 4)) <= version)) {
    const statements = readFileSync(`drizzle/${file}`, "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(statements.map((s) => db.prepare(s)));
    if (ledger)
      await db
        .prepare("INSERT INTO _mazmi_migrations VALUES (?,?)")
        .bind(file.replace(/\.sql$/, ""), new Date().toISOString())
        .run();
  }
}

async function initializeActual() {
  vi.resetModules();
  const databaseModule = await import("@/lib/server/database");
  await databaseModule.ensureDatabase();
  return databaseModule;
}

afterAll(async () => {
  for (const runtime of runtimes) await runtime.dispose();
});
describe("independent migration torture — actual bootstrap and D1", () => {
  it("0010 keeps complete triggers through deployment SQL splitting", async () => {
    const db = await database();
    await historicalSchema(db, 9);
    const sql = readFileSync(
      "drizzle/0010_atomic_mutation_assertions.sql",
      "utf8",
    );
    const statements = unstable_splitSqlQuery(sql);
    expect(statements).toHaveLength(6);
    expect(
      statements.filter((statement) => statement.startsWith("CREATE TRIGGER")),
    ).toHaveLength(3);
    await db.batch(statements.map((statement) => db.prepare(statement)));
    const guards = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('_mutation_assertions','uq_labor_one_active_user','uq_downtime_one_active_order','trg_work_order_finalization_guard','trg_material_final_order_guard','trg_downtime_final_order_guard')",
      )
      .all();
    expect(guards.results).toHaveLength(6);
    expect(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  });
  it("rejects a hosted guard with the right name but a weaker definition", async () => {
    const db = await database();
    await historicalSchema(db, 10);
    await db.prepare("DROP INDEX uq_labor_one_active_user").run();
    await db
      .prepare(
        "CREATE INDEX uq_labor_one_active_user ON labor_sessions(user_id)",
      )
      .run();
    await expect(initializeActual()).rejects.toThrow(
      "MIGRATION_0010_SCHEMA_MISMATCH",
    );
  }, 60000);
  it("preflight refuses duplicate active labor without deleting history", async () => {
    const db = await database();
    await historicalSchema(db, 9);
    for (const seed of seeds) await seed(db);
    const template = await db
      .prepare(
        "SELECT * FROM labor_sessions WHERE ended_at IS NOT NULL LIMIT 1",
      )
      .first<Record<string, unknown>>();
    for (let i = 0; i < 2; i++) {
      const row = {
        ...template!,
        id: `audit-duplicate-labor-${i}`,
        ended_at: null,
        status: "ACTIVE",
      };
      await db
        .prepare(
          `INSERT INTO labor_sessions (${Object.keys(row).join(",")}) VALUES (${Object.keys(
            row,
          )
            .map(() => "?")
            .join(",")})`,
        )
        .bind(...Object.values(row))
        .run();
    }
    const before = (await db
      .prepare("SELECT COUNT(*) AS n FROM labor_sessions")
      .first<{ n: number }>())!.n;
    await expect(initializeActual()).rejects.toThrow(
      "MIGRATION_0010_PREFLIGHT_FAILED",
    );
    expect(
      (await db
        .prepare("SELECT COUNT(*) AS n FROM labor_sessions")
        .first<{ n: number }>())!.n,
    ).toBe(before);
    expect(
      await db
        .prepare(
          "SELECT id FROM _mazmi_migrations WHERE id='0010_atomic_mutation_assertions'",
        )
        .first(),
    ).toBeNull();
  }, 60000);
  it.each([-1, 6, 7, 8, 9])(
    "preserves data and invariants upgrading schema %i to latest",
    async (version) => {
      const db = await database();
      if (version >= 0) {
        await historicalSchema(db, version);
        for (const seed of seeds.slice(
          0,
          version >= 8 ? 6 : version >= 7 ? 5 : 4,
        ))
          await seed(db);
        await db
          .prepare(
            "INSERT INTO system_state (key,value,updated_at) VALUES ('independent-sentinel','do-not-overwrite','2026-09-10T00:00:00Z')",
          )
          .run();
        await db
          .prepare(
            "UPDATE work_orders SET title='Independent preserved intervention' WHERE id='wo-001'",
          )
          .run();
      }
      const { databaseHealth } = await initializeActual();
      const health = await databaseHealth();
      expect(health.schemaVersion).toBe("0013_preventive_scheduler");
      for (const [name, value] of Object.entries(health))
        if (name.endsWith("Violations")) expect(value, name).toBe(0);
      const before = await db
        .prepare(
          "SELECT (SELECT COUNT(*) FROM inventory_movements) AS movements,(SELECT COUNT(*) FROM audit_entries) AS audit,(SELECT COUNT(*) FROM work_orders) AS work",
        )
        .first();
      for (const seed of seeds) await seed(db);
      await initializeActual();
      expect(
        await db
          .prepare(
            "SELECT (SELECT COUNT(*) FROM inventory_movements) AS movements,(SELECT COUNT(*) FROM audit_entries) AS audit,(SELECT COUNT(*) FROM work_orders) AS work",
          )
          .first(),
      ).toEqual(before);
      expect(
        (await db
          .prepare("PRAGMA quick_check")
          .first<{ quick_check: string }>())!.quick_check,
      ).toBe("ok");
      expect(
        (await db.prepare("PRAGMA foreign_key_check").all()).results,
      ).toEqual([]);
      expect(
        (
          await db
            .prepare(
              "SELECT name FROM sqlite_master WHERE name IN ('uq_labor_one_active_user','uq_downtime_one_active_order','_mutation_assertions')",
            )
            .all()
        ).results,
      ).toHaveLength(3);
      expect(
        (
          await db
            .prepare(
              "SELECT name FROM sqlite_master WHERE name IN ('import_jobs','uq_import_jobs_source','idx_import_jobs_site_created')",
            )
            .all()
        ).results,
      ).toHaveLength(3);
      if (version >= 0) {
        expect(
          (await db
            .prepare(
              "SELECT value FROM system_state WHERE key='independent-sentinel'",
            )
            .first<{ value: string }>())!.value,
        ).toBe("do-not-overwrite");
        expect(
          (await db
            .prepare("SELECT title FROM work_orders WHERE id='wo-001'")
            .first<{ title: string }>())!.title,
        ).toBe("Independent preserved intervention");
      }
    },
    120_000,
  );

  it("adopting a hosted 0009 schema must still apply 0010", async () => {
    const db = await database();
    await historicalSchema(db, 9, false);
    await initializeActual();
    expect(
      await db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='_mutation_assertions'",
        )
        .first(),
    ).not.toBeNull();
  }, 60_000);

  it("hosting-applied 0010 is adopted when the application ledger still ends at 0009", async () => {
    const db = await database();
    await historicalSchema(db, 9);
    const sql = readFileSync(
      "drizzle/0010_atomic_mutation_assertions.sql",
      "utf8",
    )
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(sql.map((s) => db.prepare(s)));
    await initializeActual();
    expect(
      await db
        .prepare(
          "SELECT id FROM _mazmi_migrations WHERE id='0010_atomic_mutation_assertions'",
        )
        .first(),
    ).not.toBeNull();
  }, 60_000);

  it("adopts a hosting-applied 0011 only when its table and indexes really exist", async () => {
    const db = await database();
    await historicalSchema(db, 10);
    const sql = readFileSync("drizzle/0011_pilot_import_jobs.sql", "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(sql.map((s) => db.prepare(s)));
    await initializeActual();
    expect(
      await db
        .prepare(
          "SELECT id FROM _mazmi_migrations WHERE id='0011_pilot_import_jobs'",
        )
        .first(),
    ).not.toBeNull();
    expect(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  }, 60000);

  it("adopts hosting-applied 0012 with its complete change queue and triggers", async () => {
    const db = await database();
    await historicalSchema(db, 11);
    const statements = readFileSync(
      "drizzle/0012_health_projection.sql",
      "utf8",
    )
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(statements.map((statement) => db.prepare(statement)));
    await initializeActual();
    expect(
      await db
        .prepare(
          "SELECT id FROM _mazmi_migrations WHERE id='0012_health_projection'",
        )
        .first(),
    ).not.toBeNull();
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'trg_health_%'",
          )
          .first<{ n: number }>()
      )?.n,
    ).toBe(8);
    expect(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  }, 60000);

  it("adopts hosting-applied 0013 only with run journal and index", async () => {
    const db = await database();
    await historicalSchema(db, 12);
    const statements = readFileSync(
      "drizzle/0013_preventive_scheduler.sql",
      "utf8",
    )
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(statements.map((statement) => db.prepare(statement)));
    await initializeActual();
    expect(
      await db
        .prepare(
          "SELECT id FROM _mazmi_migrations WHERE id='0013_preventive_scheduler'",
        )
        .first(),
    ).not.toBeNull();
    expect(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  }, 60000);
});
