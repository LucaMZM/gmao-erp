import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const binding = vi.hoisted(() => ({ db: null as unknown as D1Database }));
vi.mock("@/db", () => ({ getD1: () => binding.db }));
vi.mock("@/lib/server/runtime-mode", () => ({ applicationMode: () => "DEMO" }));

let runtime: Miniflare;
let db: D1Database;
beforeAll(async () => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('test')}}",
      compatibilityDate: "2026-09-01",
      d1Databases: ["DB"],
    }),
  );
  db = (await runtime.getD1Database("DB")) as unknown as D1Database;
  binding.db = db;
  const { ensureDatabase } = await import("@/lib/server/database");
  await ensureDatabase();
  await db.prepare("UPDATE maintenance_plans SET status='INACTIVE'").run();
}, 60_000);
afterAll(async () => {
  if (runtime) await runtime.dispose();
});

async function dueNow(hoursAgo: number) {
  const due = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  await db
    .prepare(
      `UPDATE maintenance_plans SET status='ACTIVE',trigger_mode='CALENDAR',
      calendar_next_at=?,next_due_at=?,last_generated_at=NULL,lead_days=0
     WHERE id='pm-lm01-monthly'`,
    )
    .bind(due, due)
    .run();
}

describe("automatic preventive orchestration", () => {
  it("generates one real WO and persists a retryable run without duplicate windows", async () => {
    const { runPreventiveScheduler } =
      await import("@/lib/server/preventive-scheduler");
    await dueNow(25);
    const [first, concurrent] = await Promise.all([
      runPreventiveScheduler(),
      runPreventiveScheduler(),
    ]);
    expect(first.status, JSON.stringify(first)).toBe("COMPLETE");
    expect(concurrent.status, JSON.stringify(concurrent)).toBe("COMPLETE");
    expect(first.errors).toEqual([]);
    expect(concurrent.errors).toEqual([]);
    const generated = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM work_orders WHERE maintenance_plan_id='pm-lm01-monthly' AND created_at >= ?",
      )
      .bind(new Date(Date.now() - 120_000).toISOString())
      .first<{ n: number }>();
    expect(generated?.n).toBe(1);
    const retry = await runPreventiveScheduler();
    expect(retry.created).toBe(0);
    expect(
      (
        await db
          .prepare("SELECT status FROM scheduler_runs WHERE id=?")
          .bind(first.id)
          .first<{ status: string }>()
      )?.status,
    ).toBe("COMPLETE");
  }, 60_000);

  it("records a partial failure without advancing the plan and succeeds on retry", async () => {
    const { runPreventiveScheduler } =
      await import("@/lib/server/preventive-scheduler");
    await dueNow(1);
    await db
      .prepare(
        "CREATE TRIGGER pilot_pm_failure BEFORE INSERT ON work_order_tasks BEGIN SELECT RAISE(ABORT,'INJECTED_PM_FAILURE'); END",
      )
      .run();
    let failed;
    try {
      failed = await runPreventiveScheduler();
    } finally {
      await db.prepare("DROP TRIGGER pilot_pm_failure").run();
    }
    expect(failed!.status).toBe("FAILED");
    expect(failed!.errors[0]?.plan).toBe("PM-LEV-2026-001");
    const countAfterFailure = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM work_orders WHERE maintenance_plan_id='pm-lm01-monthly'",
      )
      .first<{ n: number }>();
    const retry = await runPreventiveScheduler();
    expect(retry.status, JSON.stringify(retry)).toBe("COMPLETE");
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM work_orders WHERE maintenance_plan_id='pm-lm01-monthly'",
          )
          .first<{ n: number }>()
      )?.n,
    ).toBe((countAfterFailure?.n ?? 0) + 1);
    expect(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  }, 60_000);
});
