import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readdirSync, readFileSync } from "node:fs";
import type { DemoUserSession } from "@/lib/server/auth";
import { enterprisePermissions } from "@/lib/domain/governance";
import { seedDemoDatabase } from "@/db/seed";
import { seedV1BDatabase } from "@/db/seed-v1b";
import { seedV1CDatabase } from "@/db/seed-v1c";
import { seedV1DDatabase } from "@/db/seed-v1d";
import { seedV2ADatabase } from "@/db/seed-v2a";
import { seedV2BDatabase } from "@/db/seed-v2b";
import { globalSearch } from "@/lib/server/repositories/search";
import {
  getProcurementCenter,
  getRequisitionDetail,
} from "@/lib/server/repositories/procurement";
import { getShellNotifications } from "@/lib/server/repositories/shell";
import {
  createPurchaseRequisition,
  changeRequisitionStatus,
  convertRequisitionToPurchaseOrder,
  changePurchaseOrderStatus,
  receivePurchaseOrder,
} from "@/lib/server/operations/procurement";
import {
  getReportingData,
  listExportAssetCosts,
} from "@/lib/server/repositories/reports";
import { tenantScope } from "@/lib/server/repositories/shared";
import {
  addPlannedMaterial,
  reserveMaterial,
  releaseMaterial,
  consumeMaterial,
  returnMaterial,
} from "@/lib/server/operations/materials";
import {
  setMaintenancePlanStatus,
  recordMeterReading,
  createMaintenancePlan,
  generatePreventiveWorkOrder,
} from "@/lib/server/operations/preventive";
import {
  createRootCauseAnalysis,
  createRcaAction,
} from "@/lib/server/operations/reliability";
import { startDowntime, endDowntime } from "@/lib/server/operations/downtime";
import {
  stopLaborSession,
  cancelWorkOrder,
  startWork,
  closeWorkOrder,
  completeWorkOrder,
} from "@/lib/server/operations/work-orders";
import { movePlannerWork } from "@/lib/server/operations/planner";
import { reportingCsv } from "@/lib/domain/reporting";
import { getOverview } from "@/lib/server/repositories/overview";
import {
  getMaintenancePlanDetail,
  listMaintenancePlans,
} from "@/lib/server/repositories/preventive";
import {
  getRootCauseAnalysis,
  getReliabilityCenter,
  getAssetReliability,
} from "@/lib/server/repositories/reliability";
import { getPlannerData } from "@/lib/server/repositories/planner";
import { listInventory } from "@/lib/server/repositories/inventory";
import { listAssets } from "@/lib/server/repositories/assets";
import {
  listWorkOrders,
  getWorkOrderDetail,
} from "@/lib/server/repositories/work-orders";
import { listIncidents } from "@/lib/server/repositories/incidents";
import { getMyWork } from "@/lib/server/repositories/field";
import {
  getAuditEntries,
  getAuditFacets,
} from "@/lib/server/repositories/governance";
import {
  createShiftHandover,
  createEvidenceMetadata,
} from "@/lib/server/operations/field";
import { runIdempotent } from "@/lib/server/operations/shared";
import { recordPhysicalCount } from "@/lib/server/operations/physical-count";
import { recordWorkOrderCost } from "@/lib/server/operations/work-order-costs";
import { addLaborRate } from "@/lib/server/operations/labor-rates";
import {
  reportIncident,
  triageIncident,
  convertIncidentToWorkOrder,
} from "@/lib/server/operations/incidents";

// Only the Cloudflare binding is injected. Queries, migrations, triggers,
// transactions and domain operations run against actual local D1/workerd.
const binding = vi.hoisted(() => ({ db: null as unknown as D1Database }));
vi.mock("@/db", () => ({ getD1: () => binding.db }));
vi.mock("@/lib/server/database", () => ({ ensureDatabase: async () => {} }));

let runtime: Miniflare;
let db: D1Database;
const manager = {
  organizationId: "org-mazmi-flexpack",
  siteId: "site-levante",
  siteCode: "ES-LEV",
  userId: "user-manager",
  roleKey: "MAINTENANCE_MANAGER",
  permissionCodes: [...enterprisePermissions],
  fullAreaAccess: true,
  areaIds: [],
  fullWarehouseAccess: true,
  warehouseIds: [],
} as unknown as DemoUserSession;
const context = (session = manager) => ({
  session,
  requestId: crypto.randomUUID(),
});
const restricted = {
  ...manager,
  fullAreaAccess: false,
  areaIds: ["loc-lev-print"],
};

async function cloneRow(
  table: string,
  sourceId: string,
  overrides: Record<string, unknown>,
) {
  const source = await db
    .prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .bind(sourceId)
    .first<Record<string, unknown>>();
  if (!source) throw new Error(`Missing fixture ${table}/${sourceId}`);
  const row = { ...source, ...overrides };
  const columns = Object.keys(row);
  await db
    .prepare(
      `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    )
    .bind(...Object.values(row))
    .run();
}

async function race<T>(operations: Array<() => Promise<T>>) {
  let arrivals = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  binding.db = {
    prepare: db.prepare.bind(db),
    batch: async (statements: D1PreparedStatement[]) => {
      if (++arrivals === operations.length) release();
      await ready;
      return db.batch(statements);
    },
  } as D1Database;
  try {
    return await Promise.allSettled(operations.map((run) => run()));
  } finally {
    binding.db = db;
  }
}

async function fixtureOrder(number: string, status = "ASSIGNED") {
  await cloneRow("work_orders", "wo-v2a-field", {
    id: number,
    number,
    status,
    maintenance_plan_id: null,
    maintenance_window_key: null,
    safety_level: "STANDARD",
    isolation_required: 0,
    version: 1,
  });
  return number;
}

async function fixtureRequisition() {
  const pr = await createPurchaseRequisition(context(), {
    partId: "part-024",
    quantity: 2,
    origin: "MANUAL",
    urgency: "ROUTINE",
    justification: "Independent audit procurement fixture",
    warehouseId: "warehouse-lev-mro",
    submit: true,
  });
  await changeRequisitionStatus(context(), pr.number, {
    action: "APPROVE",
    version: 1,
  });
  return pr;
}

async function fixturePurchaseOrder() {
  const pr = await fixtureRequisition();
  const po = await convertRequisitionToPurchaseOrder(context(), pr.number, {
    vendorId: "vendor-sensora",
    version: 2,
  });
  await changePurchaseOrderStatus(context(), po.number, {
    action: "APPROVE",
    version: 1,
  });
  await changePurchaseOrderStatus(context(), po.number, {
    action: "SEND",
    version: 2,
  });
  return po;
}

async function fixturePlan(label: string) {
  const plan = await createMaintenancePlan(context(), {
    assetId: "asset-pr-01",
    ownerId: manager.userId,
    title: label,
    description: "Independent transaction boundary",
    criticality: "MEDIUM",
    priority: "P4_NORMAL",
    estimatedMinutes: 30,
    triggerMode: "CALENDAR",
    calendarUnit: "DAY",
    calendarInterval: 30,
    firstDueAt: "2026-09-09T08:00:00.000Z",
    leadDays: 3,
    tasks: [{ title: "Inspección", required: true }],
    skills: [],
    certificationIds: [],
    materials: [],
  });
  return (await db
    .prepare("SELECT id,code FROM maintenance_plans WHERE code=?")
    .bind(plan.code)
    .first<{ id: string; code: string }>())!;
}

async function fixtureRca(label: string) {
  const created = await createRootCauseAnalysis(context(), {
    assetId: "asset-pr-01",
    ownerId: manager.userId,
    problem: label,
    impact: "Independent fault injection",
  });
  const rca = (await db
    .prepare("SELECT id,number FROM root_cause_analyses WHERE number=?")
    .bind(created.number)
    .first<{ id: string; number: string }>())!;
  await db
    .prepare(
      "UPDATE root_cause_analyses SET status='INVESTIGATING',root_cause='Fijación desgastada' WHERE id=?",
    )
    .bind(rca.id)
    .run();
  return rca;
}

beforeAll(async () => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } }",
      compatibilityDate: "2026-09-01",
      d1Databases: ["DB"],
    }),
  );
  db = (await runtime.getD1Database("DB")) as unknown as D1Database;
  binding.db = db;
  for (const file of readdirSync("drizzle")
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const statements = readFileSync(`drizzle/${file}`, "utf8")
      .split("--> statement-breakpoint")
      .map((sql) => sql.trim())
      .filter(Boolean);
    await db.batch(statements.map((sql) => db.prepare(sql)));
  }
  for (const seed of [
    seedDemoDatabase,
    seedV1BDatabase,
    seedV1CDatabase,
    seedV1DDatabase,
    seedV2ADatabase,
    seedV2BDatabase,
  ])
    await seed(db);
}, 60_000);
afterAll(async () => {
  await runtime?.dispose();
});

describe("independent audit — persisted boundaries", () => {
  it("interrupted idempotency checkpoint is reclaimed after its lease and commits only once", async () => {
    const number = await fixtureOrder("AUDIT-ORPHAN-IDEMPOTENCY");
    const identity = { number, description: "Original recoverable note" };
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(identity)),
    );
    const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    // Materialize precisely the durable checkpoint left by a terminated request:
    // reservation exists; business batch has never started. No process-kill mock.
    await db
      .prepare(
        `INSERT INTO operation_idempotency
      (id,organization_id,site_id,actor_id,idempotency_key,operation,entity_type,entity_id,response_json,created_at)
      VALUES (?,?,?,?,?,?,NULL,NULL,NULL,?)`,
      )
      .bind(
        "audit-orphan-reservation",
        manager.organizationId,
        manager.siteId,
        manager.userId,
        "audit_orphan_recovery",
        `FIELD_EVIDENCE:${fingerprint}`,
        "2026-08-01T08:00:00.000Z",
      )
      .run();
    let executions = 0;
    const retry = () => {
      const ctx = context();
      return runIdempotent(
        ctx,
        "audit_orphan_recovery",
        "FIELD_EVIDENCE",
        async () => {
          executions++;
          const id = `audit-recovered-${crypto.randomUUID()}`;
          await createEvidenceMetadata(ctx, number, {
            id,
            kind: "NOTE",
            stage: "GENERAL",
            description: identity.description,
          });
          return { id, ok: true };
        },
        identity,
      );
    };
    const result = await retry();
    expect(result.replayed).toBe(false);
    expect(await retry()).toEqual({ value: result.value, replayed: true });
    expect(executions).toBe(1);
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM audit_entries WHERE action='IDEMPOTENCY_RESERVATION_RECOVERED' AND entity_id='audit-orphan-reservation'",
          )
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM evidence_items WHERE work_order_id=?",
        )
        .bind(number)
        .first<{ n: number }>())!.n,
    ).toBe(1);
    expect(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  });
  it("idempotent evidence commits once, replays once, and rejects changed payload", async () => {
    const number = await fixtureOrder("AUDIT-EVIDENCE-RETRY");
    const execute = async (ctx: ReturnType<typeof context>) => {
      const id = `audit-evidence-${crypto.randomUUID()}`;
      await createEvidenceMetadata(ctx, number, {
        id,
        kind: "NOTE",
        stage: "GENERAL",
        description: "One durable evidence",
      });
      return { id, ok: true };
    };
    const run = (identity: unknown) => {
      const ctx = context();
      return runIdempotent(
        ctx,
        "audit_evidence_idempotent",
        "FIELD_EVIDENCE",
        () => execute(ctx),
        identity,
      );
    };
    const first = await run({ number, value: "A" });
    const second = await run({ number, value: "A" });
    expect(second).toEqual({ value: first.value, replayed: true });
    await expect(run({ number, value: "B" })).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM evidence_items WHERE work_order_id=?",
        )
        .bind(number)
        .first<{ n: number }>())!.n,
    ).toBe(1);
  });

  it("lease reclaim fences a delayed worker and rejects a changed payload", async () => {
    const number = await fixtureOrder("AUDIT-LEASE-RACE");
    const key = "audit_lease_race_key";
    let releaseOld!: () => void;
    let startedOld!: () => void;
    const started = new Promise<void>((resolve) => {
      startedOld = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const write = (ctx: ReturnType<typeof context>, id: string) =>
      createEvidenceMetadata(ctx, number, {
        id,
        kind: "NOTE",
        stage: "GENERAL",
        description: "Lease race evidence",
      }).then(() => ({ id, ok: true }));
    const oldContext = context();
    const old = runIdempotent(
      oldContext,
      key,
      "FIELD_EVIDENCE",
      async () => {
        startedOld();
        await hold;
        return write(oldContext, "audit-old-worker-evidence");
      },
      { number, description: "same" },
    );
    await started;
    await expect(
      runIdempotent(
        context(),
        key,
        "FIELD_EVIDENCE",
        async () => ({ id: "never" }),
        { number, description: "same" },
      ),
    ).rejects.toMatchObject({ code: "OPERATION_SYNCING" });
    await db
      .prepare(
        "UPDATE operation_idempotency SET created_at=? WHERE idempotency_key=?",
      )
      .bind("2026-01-01T00:00:00.000Z", key)
      .run();
    await expect(
      runIdempotent(
        context(),
        key,
        "FIELD_EVIDENCE",
        async () => ({ id: "never" }),
        { number, description: "changed" },
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const freshContext = context();
    const fresh = await runIdempotent(
      freshContext,
      key,
      "FIELD_EVIDENCE",
      () => write(freshContext, "audit-fresh-worker-evidence"),
      { number, description: "same" },
    );
    releaseOld();
    await expect(old).rejects.toMatchObject({
      code: "CONCURRENT_MODIFICATION",
    });
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM evidence_items WHERE work_order_id=? AND id IN (?,?)",
          )
          .bind(
            number,
            "audit-old-worker-evidence",
            "audit-fresh-worker-evidence",
          )
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    const replay = await runIdempotent(
      context(),
      key,
      "FIELD_EVIDENCE",
      async () => ({ id: "never" }),
      { number, description: "same" },
    );
    expect(replay).toEqual({ value: fresh.value, replayed: true });
  });

  it("double PR conversion commits one PO and one set of lines", async () => {
    const pr = await fixtureRequisition();
    const outcomes = await race(
      [0, 1].map(
        () => () =>
          convertRequisitionToPurchaseOrder(context(), pr.number, {
            vendorId: "vendor-sensora",
            version: 2,
          }),
      ),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM purchase_orders WHERE requisition_id=?",
        )
        .bind(pr.id)
        .first<{ n: number }>())!.n,
    ).toBe(1);
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM purchase_order_lines WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE requisition_id=?)",
        )
        .bind(pr.id)
        .first<{ n: number }>())!.n,
    ).toBe(1);
  });

  it("concurrent receipt plus retry never doubles stock, ledger or received quantity", async () => {
    const po = await fixturePurchaseOrder();
    const stock = await db
      .prepare(
        "SELECT stock.id,on_hand AS physical,on_order AS onOrder FROM stock_levels stock INNER JOIN purchase_orders po ON po.destination_bin_id=stock.bin_id AND po.site_id=stock.site_id WHERE po.id=? AND stock.part_id='part-024'",
      )
      .bind(po.id)
      .first<{ id: string; physical: number; onOrder: number }>();
    const input = {
      idempotencyKey: `audit_receipt_${po.id}`,
      version: 3,
      lines: [{ lineId: po.lines[0].id, quantity: 1 }],
    };
    const outcomes = await race(
      [0, 1].map(() => () => receivePurchaseOrder(context(), po.number, input)),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await receivePurchaseOrder(context(), po.number, input)).created,
    ).toBe(false);
    const after = await db
      .prepare(
        "SELECT on_hand AS physical,on_order AS onOrder FROM stock_levels WHERE id=?",
      )
      .bind(stock!.id)
      .first<{ physical: number; onOrder: number }>();
    expect(after).toEqual({
      physical: stock!.physical + 1,
      onOrder: stock!.onOrder - 1,
    });
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM goods_receipts WHERE purchase_order_id=?",
        )
        .bind(po.id)
        .first<{ n: number }>())!.n,
    ).toBe(1);
    expect(
      (await db
        .prepare(
          "SELECT received_quantity AS n FROM purchase_order_lines WHERE id=?",
        )
        .bind(po.lines[0].id)
        .first<{ n: number }>())!.n,
    ).toBe(1);
  });

  it("receipt failure rolls back receipt, line, stock, ledger and on-order together", async () => {
    const po = await fixturePurchaseOrder();
    const before = await db
      .prepare(
        "SELECT * FROM stock_levels WHERE part_id='part-024' AND site_id='site-levante' ORDER BY id",
      )
      .all();
    await db
      .prepare(
        "CREATE TRIGGER audit_receipt_failure BEFORE INSERT ON goods_receipt_lines BEGIN SELECT RAISE(ABORT,'INJECTED_RECEIPT_FAILURE'); END",
      )
      .run();
    try {
      await expect(
        receivePurchaseOrder(context(), po.number, {
          idempotencyKey: `audit_failure_${po.id}`,
          version: 3,
          lines: [{ lineId: po.lines[0].id, quantity: 1 }],
        }),
      ).rejects.toThrow();
      expect(
        (
          await db
            .prepare(
              "SELECT * FROM stock_levels WHERE part_id='part-024' AND site_id='site-levante' ORDER BY id",
            )
            .all()
        ).results,
      ).toEqual(before.results);
      expect(
        await db
          .prepare("SELECT id FROM goods_receipts WHERE purchase_order_id=?")
          .bind(po.id)
          .first(),
      ).toBeNull();
      expect(
        (await db
          .prepare(
            "SELECT received_quantity AS n FROM purchase_order_lines WHERE id=?",
          )
          .bind(po.lines[0].id)
          .first<{ n: number }>())!.n,
      ).toBe(0);
    } finally {
      await db.prepare("DROP TRIGGER audit_receipt_failure").run();
    }
  });

  it("preventive generation is one durable window under concurrency", async () => {
    const plan = await fixturePlan("Audit concurrent PM");
    const outcomes = await race(
      [0, 1].map(() => () => generatePreventiveWorkOrder(context(), plan.code)),
    );
    expect(outcomes.some((r) => r.status === "fulfilled")).toBe(true);
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM work_orders WHERE maintenance_plan_id=?",
        )
        .bind(plan.id)
        .first<{ n: number }>())!.n,
    ).toBe(1);
    expect(
      (await generatePreventiveWorkOrder(context(), plan.code)).created,
    ).toBe(false);
  });

  it("corrective completion persists an organization-scoped formal failure mode for Reliability", async () => {
    const number = await fixtureOrder("OT-LEV-2026-FORMAL", "IN_PROGRESS");
    await db
      .prepare(
        "UPDATE work_orders SET type='CORRECTIVE',source='MANUAL',requested_at=? WHERE number=?",
      )
      .bind(new Date().toISOString(), number)
      .run();
    const mode = await db
      .prepare(
        "SELECT id,code FROM failure_modes WHERE organization_id=? AND status='ACTIVE' LIMIT 1",
      )
      .bind(manager.organizationId)
      .first<{ id: string; code: string }>();
    expect(mode).toBeTruthy();
    const probe = await db
      .prepare("UPDATE work_orders SET diagnosis=diagnosis WHERE number=?")
      .bind(number)
      .run();
    expect(probe.meta.changes).toBeGreaterThan(1);
    await expect(
      completeWorkOrder(context(), number, {
        diagnosis: "Desgaste confirmado en rodillo aplicador",
        solution: "Sustitución y verificación de vibración correcta",
        failureModeId: "missing-mode",
      }),
    ).rejects.toMatchObject({ code: "INVALID_FAILURE_MODE" });
    await completeWorkOrder(context(), number, {
      diagnosis: "Desgaste confirmado en rodillo aplicador",
      solution: "Sustitución y verificación de vibración correcta",
      failureModeId: mode!.id,
    });
    expect(
      await db
        .prepare(
          "SELECT failure_mode_id AS id,failure_mode AS code FROM work_orders WHERE number=?",
        )
        .bind(number)
        .first(),
    ).toEqual({ id: mode!.id, code: mode!.code });
    const recorded = await db
      .prepare("SELECT asset_id AS assetId FROM work_orders WHERE number=?")
      .bind(number)
      .first<{ assetId: string }>();
    const actor = await getAssetReliability(
      tenantScope(manager),
      recorded!.assetId,
    );
    expect(
      actor?.signals.some((signal) => signal.failureModeId === mode!.id),
    ).toBe(true);
  });

  it("incident conversion remains atomic with health projection triggers and concurrent retries", async () => {
    const incident = await reportIncident(context(), {
      functionalLocationId: "loc-lev-lm-02",
      assetId: "asset-lm-02-app",
      title: "Vibración anómala en aplicador",
      description: "Oscilación en rodillo aplicador durante turno",
      severity: "HIGH",
      initialImpact: "REDUCED_SPEED",
      origin: "MAINTENANCE",
    });
    await triageIncident(context(), incident.id, { action: "START_TRIAGE" });
    await triageIncident(context(), incident.id, {
      action: "ACCEPT",
      priority: "P3_HIGH",
      classification: "CORRECTIVE",
      assetId: "asset-lm-02-app",
    });
    const results = await Promise.allSettled(
      [0, 1].map(() => convertIncidentToWorkOrder(context(), incident.id)),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM work_orders WHERE incident_id=?")
          .bind(incident.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    expect(
      (
        await db
          .prepare("SELECT status FROM incidents WHERE id=?")
          .bind(incident.id)
          .first<{ status: string }>()
      )?.status,
    ).toBe("CONVERTED");
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM audit_entries WHERE entity_id=? AND action='INCIDENT_CONVERTED'",
          )
          .bind(incident.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    expect(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  });

  it("physical count writes one ledger movement, respects reservations and rejects stale concurrent counts", async () => {
    const stock = await db
      .prepare(
        "SELECT id,on_hand AS physical,reserved,version FROM stock_levels WHERE site_id=? AND on_hand>reserved AND on_hand>=2 LIMIT 1",
      )
      .bind(manager.siteId)
      .first<{
        id: string;
        physical: number;
        reserved: number;
        version: number;
      }>();
    expect(stock).toBeTruthy();
    await expect(
      recordPhysicalCount(
        context({ ...manager, fullWarehouseAccess: false, warehouseIds: [] }),
        {
          stockId: stock!.id,
          countedQuantity: stock!.physical + 1,
          expectedVersion: stock!.version,
          reason: "Conteo fuera de almacén",
        },
      ),
    ).rejects.toMatchObject({ code: "WAREHOUSE_SCOPE_DENIED" });
    if (stock!.reserved > 0)
      await expect(
        recordPhysicalCount(context(), {
          stockId: stock!.id,
          countedQuantity: stock!.reserved - 1,
          expectedVersion: stock!.version,
          reason: "Conteo inferior a reserva",
        }),
      ).rejects.toMatchObject({ code: "COUNT_BELOW_RESERVED" });
    const baseline = (await db
      .prepare(
        "SELECT COUNT(*) AS n FROM inventory_movements WHERE bin_id=(SELECT bin_id FROM stock_levels WHERE id=?) AND part_id=(SELECT part_id FROM stock_levels WHERE id=?) AND movement_type='ADJUSTMENT'",
      )
      .bind(stock!.id, stock!.id)
      .first<{ n: number }>())!.n;
    const count = await recordPhysicalCount(context(), {
      stockId: stock!.id,
      countedQuantity: stock!.physical + 2,
      expectedVersion: stock!.version,
      reason: "Conteo cíclico auditado",
    });
    expect(count.delta).toBe(2);
    expect(count.available).toBe(count.physical - count.reserved);
    expect(
      (
        await db
          .prepare(
            "SELECT delta_on_hand AS delta,unit_cost AS cost FROM inventory_movements WHERE id=?",
          )
          .bind(count.movementId)
          .first<{ delta: number; cost: number }>()
      )?.delta,
    ).toBe(2);
    await expect(
      recordPhysicalCount(context(), {
        stockId: stock!.id,
        countedQuantity: stock!.physical + 3,
        expectedVersion: stock!.version,
        reason: "Reintento obsoleto de conteo",
      }),
    ).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
    const nextVersion = stock!.version + 1;
    const racing = await Promise.allSettled(
      [1, 2].map((delta) =>
        recordPhysicalCount(context(), {
          stockId: stock!.id,
          countedQuantity: stock!.physical + 2 + delta,
          expectedVersion: nextVersion,
          reason: "Conteo concurrente auditado",
        }),
      ),
    );
    expect(
      racing.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM inventory_movements WHERE bin_id=(SELECT bin_id FROM stock_levels WHERE id=?) AND part_id=(SELECT part_id FROM stock_levels WHERE id=?) AND movement_type='ADJUSTMENT'",
          )
          .bind(stock!.id, stock!.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(baseline + 2);
    const final = await db
      .prepare(
        "SELECT on_hand AS physical,reserved FROM stock_levels WHERE id=?",
      )
      .bind(stock!.id)
      .first<{ physical: number; reserved: number }>();
    expect(final!.physical).toBeGreaterThanOrEqual(final!.reserved);
  });

  it("preventive window and generated WO roll back on task insertion failure", async () => {
    const plan = await fixturePlan("Audit PM rollback");
    const before = await db
      .prepare("SELECT * FROM maintenance_plans WHERE id=?")
      .bind(plan.id)
      .first();
    await db
      .prepare(
        "CREATE TRIGGER audit_pm_failure BEFORE INSERT ON work_order_tasks BEGIN SELECT RAISE(ABORT,'INJECTED_PM_FAILURE'); END",
      )
      .run();
    try {
      await expect(
        generatePreventiveWorkOrder(context(), plan.code),
      ).rejects.toThrow();
      expect(
        await db
          .prepare("SELECT * FROM maintenance_plans WHERE id=?")
          .bind(plan.id)
          .first(),
      ).toEqual(before);
      expect(
        await db
          .prepare("SELECT id FROM work_orders WHERE maintenance_plan_id=?")
          .bind(plan.id)
          .first(),
      ).toBeNull();
    } finally {
      await db.prepare("DROP TRIGGER audit_pm_failure").run();
    }
  });

  it("RCA action failure cannot orphan its generated WO", async () => {
    const rca = await fixtureRca("Audit RCA rollback");
    await db
      .prepare(
        "CREATE TRIGGER audit_rca_failure BEFORE INSERT ON rca_actions BEGIN SELECT RAISE(ABORT,'INJECTED_RCA_FAILURE'); END",
      )
      .run();
    try {
      await expect(
        createRcaAction(context(), rca.number, {
          title: "AUDIT-RCA-ORPHAN",
          description: "Corregir fijación",
          actionType: "CREATE_WORK_ORDER",
          ownerId: manager.userId,
          version: 1,
        }),
      ).rejects.toThrow();
      expect(
        await db
          .prepare("SELECT id FROM work_orders WHERE title='AUDIT-RCA-ORPHAN'")
          .first(),
      ).toBeNull();
      expect(
        await db
          .prepare("SELECT id FROM rca_actions WHERE root_cause_analysis_id=?")
          .bind(rca.id)
          .first(),
      ).toBeNull();
    } finally {
      await db.prepare("DROP TRIGGER audit_rca_failure").run();
    }
  });

  it("concurrent RCA action updates cannot orphan the losing generated WO", async () => {
    const rca = await fixtureRca("Audit RCA concurrency");
    const outcomes = await race(
      [0, 1].map(
        () => () =>
          createRcaAction(context(), rca.number, {
            title: "AUDIT-RCA-CONCURRENT",
            description: "Corregir fijación",
            actionType: "CREATE_WORK_ORDER",
            ownerId: manager.userId,
            version: 1,
          }),
      ),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM work_orders WHERE title='AUDIT-RCA-CONCURRENT'",
        )
        .first<{ n: number }>())!.n,
    ).toBe(1);
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM rca_actions WHERE root_cause_analysis_id=?",
        )
        .bind(rca.id)
        .first<{ n: number }>())!.n,
    ).toBe(1);
  });

  it.each(["START", "END"] as const)(
    "downtime %s rolls back when its audit fails",
    async (action) => {
      const number = await fixtureOrder(`AUDIT-DOWNTIME-FAULT-${action}`);
      const down =
        action === "END"
          ? await startDowntime(context(), number, {
              kind: "UNPLANNED",
              productionImpact: "FULL_STOP",
            })
          : null;
      const before = await db
        .prepare("SELECT * FROM downtime_events WHERE work_order_id=?")
        .bind(number)
        .all();
      await db
        .prepare(
          `CREATE TRIGGER audit_downtime_failure BEFORE INSERT ON audit_entries WHEN NEW.action='DOWNTIME_${action === "START" ? "STARTED" : "ENDED"}' BEGIN SELECT RAISE(ABORT,'INJECTED_DOWNTIME_FAILURE'); END`,
        )
        .run();
      try {
        await expect(
          down
            ? endDowntime(context(), number, down.id)
            : startDowntime(context(), number, {
                kind: "UNPLANNED",
                productionImpact: "FULL_STOP",
              }),
        ).rejects.toThrow();
        expect(
          (
            await db
              .prepare("SELECT * FROM downtime_events WHERE work_order_id=?")
              .bind(number)
              .all()
          ).results,
        ).toEqual(before.results);
      } finally {
        await db.prepare("DROP TRIGGER audit_downtime_failure").run();
      }
    },
  );
  it("scope revocation removes old notifications without deleting their history", async () => {
    await db
      .prepare(
        "INSERT INTO notifications (id,organization_id,site_id,user_id,title,body,severity,entity_type,entity_id,created_at) VALUES ('audit-revoked-notification',?,?,?,'Sentinel scope','classified-lamination','CRITICAL','WORK_ORDER','wo-v2a-field','2099-01-01')",
      )
      .bind(manager.organizationId, manager.siteId, manager.userId)
      .run();
    expect(
      (await getShellNotifications(restricted)).some(
        (n) => n.id === "audit-revoked-notification",
      ),
    ).toBe(false);
    expect(
      await db
        .prepare(
          "SELECT id FROM notifications WHERE id='audit-revoked-notification'",
        )
        .first(),
    ).not.toBeNull();
  });

  it("Procurement list and detail respect the contextual WO area", async () => {
    const pr = await db
      .prepare(
        "SELECT id FROM purchase_requisitions WHERE site_id='site-levante' LIMIT 1",
      )
      .first<{ id: string }>();
    await cloneRow("purchase_requisitions", pr!.id, {
      id: "audit-area-pr",
      number: "AUDIT-AREA-PR",
      work_order_id: "wo-v2a-field",
      justification: "classified-lamination",
    });
    const line = await db
      .prepare(
        "SELECT id FROM purchase_requisition_lines WHERE purchase_requisition_id=? LIMIT 1",
      )
      .bind(pr!.id)
      .first<{ id: string }>();
    await cloneRow("purchase_requisition_lines", line!.id, {
      id: "audit-area-pr-line",
      purchase_requisition_id: "audit-area-pr",
    });
    expect(
      await getRequisitionDetail(tenantScope(manager), "AUDIT-AREA-PR"),
    ).not.toBeNull();
    expect(
      await getRequisitionDetail(tenantScope(restricted), "AUDIT-AREA-PR"),
    ).toBeNull();
    expect(
      JSON.stringify(await getProcurementCenter(tenantScope(restricted))),
    ).not.toContain("classified-lamination");
  });

  it("Procurement cannot create a contextual requisition outside area scope", async () => {
    const part = await db
      .prepare(
        "SELECT part_id AS id FROM part_site_policies WHERE site_id='site-levante' LIMIT 1",
      )
      .first<{ id: string }>();
    await expect(
      createPurchaseRequisition(context(restricted), {
        partId: part!.id,
        quantity: 1,
        workOrderNumber: "OT-LEV-2026-0390",
        justification: "Audit area boundary",
        origin: "WORK_ORDER",
        urgency: "HIGH",
      }),
    ).rejects.toMatchObject({ code: "AREA_SCOPE_DENIED" });
    expect(
      await db
        .prepare(
          "SELECT id FROM purchase_requisitions WHERE justification='Audit area boundary'",
        )
        .first(),
    ).toBeNull();
  });
  it("global search must not disclose assets or work from another area", async () => {
    const rows = await globalSearch(tenantScope(restricted), "LM-02");
    expect(rows.filter((row) => row.kind !== "PART")).toEqual([]);
  });

  it("warehouse-scoped Procurement renders real stock risks without SQL errors", async () => {
    const warehouse = await db
      .prepare(
        "SELECT id FROM warehouses WHERE site_id = 'site-levante' ORDER BY code LIMIT 1",
      )
      .first<{ id: string }>();
    const data = await getProcurementCenter(
      tenantScope({
        ...manager,
        fullWarehouseAccess: false,
        warehouseIds: [warehouse!.id],
      }),
    );
    expect(data.warehouses.map((row) => row.id)).toEqual([warehouse!.id]);
    expect(data.parts.length).toBeGreaterThan(0);
    expect(data.risks.length).toBeGreaterThan(0);
  });

  it("reporting cannot export costs of assets outside the user's area", async () => {
    const report = await getReportingData(restricted, {
      from: "2026-07-01",
      to: "2026-09-30",
    });
    expect(report.costsByAsset.some((row) => row.code === "LM-02")).toBe(false);
    expect(report.costsByArea.some((row) => row.code.includes("LAM"))).toBe(
      false,
    );
  });

  it("reporting export uses keyset pages and includes the full scoped asset set, not the top widget", async () => {
    const filters = { from: "2026-08-01", to: "2026-10-31" };
    const rows = await listExportAssetCosts(manager, filters, "", 200);
    const expected = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM assets WHERE organization_id=? AND site_id=?",
      )
      .bind(manager.organizationId, manager.siteId)
      .first<{ n: number }>();
    expect(rows.length).toBe(expected?.n);
    expect(rows.length).toBeGreaterThan(12);
    const first = await listExportAssetCosts(manager, filters, "", 7);
    const next = await listExportAssetCosts(
      manager,
      filters,
      first.at(-1)!.id,
      7,
    );
    expect(first).toHaveLength(7);
    expect(next).toHaveLength(7);
    expect(new Set([...first, ...next].map((row) => row.id)).size).toBe(14);
    const restrictedRows = await listExportAssetCosts(
      { ...manager, fullAreaAccess: false, areaIds: ["loc-lev-print"] },
      filters,
      "",
      200,
    );
    expect(restrictedRows.length).toBeLessThan(rows.length);
  });

  it("external costs and future labor rates are auditable without repricing historical sessions", async () => {
    const number = await fixtureOrder("OT-LEV-2026-COST", "IN_PROGRESS");
    const beforeLabor = await db
      .prepare(
        "SELECT id,labor_cost_cents AS cents FROM labor_sessions WHERE labor_cost_cents IS NOT NULL LIMIT 1",
      )
      .first<{ id: string; cents: number }>();
    expect(beforeLabor).toBeTruthy();
    const cost = await recordWorkOrderCost(context(), number, {
      kind: "EXTERNAL_VENDOR",
      description: "Diagnóstico externo de rodillo",
      amountCents: 125_50,
      vendorId: null,
    });
    expect(
      await db
        .prepare(
          "SELECT amount_cents AS cents,currency FROM work_order_cost_items WHERE id=?",
        )
        .bind(cost.id)
        .first(),
    ).toEqual({ cents: 12550, currency: "EUR" });
    const rate = await addLaborRate(context(), {
      userId: "user-tech-1",
      hourlyRateCents: 4875,
      effectiveFrom: "2026-10-04T00:00:00.000Z",
    });
    expect(rate.id).toBeTruthy();
    expect(
      (
        await db
          .prepare(
            "SELECT labor_cost_cents AS cents FROM labor_sessions WHERE id=?",
          )
          .bind(beforeLabor!.id)
          .first<{ cents: number }>()
      )?.cents,
    ).toBe(beforeLabor!.cents);
    const detail = await getWorkOrderDetail(tenantScope(manager), number);
    expect(detail?.costs.explicit).toBe(125.5);
    expect(detail?.costItems.some((item) => item.id === cost.id)).toBe(true);
    await expect(
      recordWorkOrderCost(
        context({ ...manager, permissionCodes: [] }),
        number,
        {
          kind: "OTHER",
          description: "Coste sin permiso",
          amountCents: 100,
          vendorId: null,
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN_OPERATION" });
  });

  it("CSV names cannot execute spreadsheet formulas", () => {
    const csv = reportingCsv({
      costsByAsset: [
        {
          code: "A",
          name: '=HYPERLINK("https://attacker.invalid","open")',
          laborCents: 0,
          materialCents: 0,
          explicitCents: 0,
          totalCents: 0,
          downtimeMinutes: 0,
        },
      ],
    });
    expect(csv).toContain("\"'=HYPERLINK");
  });

  it("partial-area aggregates, PM and RCA details never serialize the excluded asset", async () => {
    const scope = tenantScope(restricted);
    const plan = await db
      .prepare(
        "SELECT code FROM maintenance_plans WHERE asset_id = 'asset-lm-02-app' LIMIT 1",
      )
      .first<{ code: string }>();
    const rca = await db
      .prepare(
        "SELECT number FROM root_cause_analyses WHERE asset_id = 'asset-lm-02-app' LIMIT 1",
      )
      .first<{ number: string }>();
    expect(await getMaintenancePlanDetail(scope, plan!.code)).toBeNull();
    expect(await getRootCauseAnalysis(scope, rca!.number)).toBeNull();
    for (const data of [
      await getOverview(scope),
      await listMaintenancePlans(scope),
      await getReliabilityCenter(scope),
      await getPlannerData(scope, manager.userId),
    ]) {
      expect(JSON.stringify(data)).not.toContain("LM-02");
    }
  });

  it("facets apply every active condition except their own", async () => {
    const scope = tenantScope(manager);
    const assets = await listAssets(scope, {
      area: "LAM",
      status: "DEGRADED",
    });
    expect(assets.items.every((item) => item.status === "DEGRADED")).toBe(true);
    expect(assets.facets.statuses.map((item) => item.value)).toContain(
      "OPERATING",
    );
    expect(assets.facets.areas.map((item) => item.value)).toContain("LAM");
    const hierarchy = await listAssets(scope, {
      view: "hierarchy",
      q: "LM-02-APP",
    });
    expect(hierarchy.items.map((item) => item.code)).toEqual([
      "LM-02",
      "LM-02-APP",
    ]);
    expect(hierarchy.items[1]?.parentId).toBe(hierarchy.items[0]?.id);
    expect(new Set(hierarchy.items.map((item) => item.id)).size).toBe(
      hierarchy.items.length,
    );

    const orders = await listWorkOrders(scope, {
      view: "all",
      priority: "P2_URGENT",
      type: "CORRECTIVE",
    });
    expect(orders.items.every((item) => item.priority === "P2_URGENT")).toBe(
      true,
    );
    expect(orders.facets.priorities.length).toBeGreaterThan(0);
    expect(orders.facets.types.map((item) => item.value)).toContain(
      "CORRECTIVE",
    );

    const incidents = await listIncidents(scope, {
      view: "all",
      severity: "HIGH",
    });
    expect(incidents.items.every((item) => item.severity === "HIGH")).toBe(
      true,
    );
    expect(incidents.facets.severities.map((item) => item.value)).toContain(
      "HIGH",
    );

    const inventory = await listInventory(scope, { critical: "1" });
    expect(inventory.items.every((item) => Number(item.critical) === 1)).toBe(
      true,
    );
    expect(inventory.facets.categories.length).toBeGreaterThan(0);
    expect(inventory.facets.criticalCount).toBeGreaterThan(0);

    const audit = await getAuditFacets(manager, { outcome: "SUCCESS" });
    expect(audit.outcomes.map((item) => item.value)).toContain("SUCCESS");
    expect(audit.entities.length).toBeGreaterThan(0);
  });

  it("My Work removes assignments and handovers after area scope is revoked", async () => {
    const data = await getMyWork(
      tenantScope({
        ...manager,
        fullAreaAccess: false,
        areaIds: [],
        userId: "user-tech-1",
        roleKey: "TECHNICIAN",
      }),
      "user-tech-1",
    );
    expect(data.current).toBeNull();
    expect(data.today).toEqual([]);
    expect(data.upcoming).toEqual([]);
    expect(data.handovers).toEqual([]);
  });

  it("Audit cannot disclose an out-of-area WO via its event payload", async () => {
    await db
      .prepare(
        "INSERT INTO audit_entries (id,organization_id,site_id,actor_id,action,entity_type,entity_id,new_value,created_at) VALUES ('audit-scope-sentinel',?,?,?,'AUDIT_SCOPE_SENTINEL','WORK_ORDER','wo-v2a-field','classified-lamination',?)",
      )
      .bind(
        manager.organizationId,
        manager.siteId,
        manager.userId,
        new Date().toISOString(),
      )
      .run();
    expect(
      await getAuditEntries(restricted, { action: "AUDIT_SCOPE_SENTINEL" }),
    ).toEqual([]);
  });

  it("handover creation cannot bypass a revoked area scope", async () => {
    await expect(
      createShiftHandover(context(restricted), {
        fromShift: "Mañana",
        toShift: "Tarde",
        summary: "Auditoría de ámbito de relevo",
        workOrderNumbers: ["OT-LEV-2026-0390"],
      }),
    ).rejects.toMatchObject({ code: "AREA_SCOPE_DENIED" });
  });

  it("Planner applies the assignee's area membership, not only workforce profile", async () => {
    const number = await fixtureOrder("AUDIT-PLANNER-TARGET");
    await db
      .prepare(
        "UPDATE work_orders SET asset_id='asset-pr-01', functional_location_id=(SELECT functional_location_id FROM assets WHERE id='asset-pr-01') WHERE id=?",
      )
      .bind(number)
      .run();
    await expect(
      movePlannerWork(context(), number, {
        expectedVersion: 1,
        technicianId: "user-tech-4",
        date: "2026-09-14",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ASSIGNEE" });
  });

  it("a restricted supervisor cannot add material to another area", async () => {
    const part = await db
      .prepare(
        "SELECT part_id AS id FROM stock_levels WHERE site_id = 'site-levante' LIMIT 1",
      )
      .first<{ id: string }>();
    await expect(
      addPlannedMaterial(context(restricted), "OT-LEV-2026-0390", part!.id, 1),
    ).rejects.toMatchObject({ code: "AREA_SCOPE_DENIED" });
  });

  it("a warehouse-limited actor cannot reserve an excluded bin", async () => {
    const material = await db
      .prepare(
        "SELECT id FROM work_order_materials WHERE work_order_id = 'wo-v2a-field' LIMIT 1",
      )
      .first<{ id: string }>();
    await expect(
      reserveMaterial(
        context({ ...manager, fullWarehouseAccess: false, warehouseIds: [] }),
        "OT-LEV-2026-0390",
        material!.id,
        1,
      ),
    ).rejects.toMatchObject({ code: "WAREHOUSE_SCOPE_DENIED" });
  });

  it("preventive status changes enforce area scope", async () => {
    const plan = await db
      .prepare(
        "SELECT code,version FROM maintenance_plans WHERE asset_id = 'asset-lm-02-app' LIMIT 1",
      )
      .first<{ code: string; version: number }>();
    await expect(
      setMaintenancePlanStatus(
        context(restricted),
        plan!.code,
        "INACTIVE",
        plan!.version,
      ),
    ).rejects.toMatchObject({ code: "AREA_SCOPE_DENIED" });
  });

  it("RCA creation enforces the asset area", async () => {
    await expect(
      createRootCauseAnalysis(context(restricted), {
        assetId: "asset-lm-02-app",
        ownerId: "user-manager",
        problem: "Audit outside scope",
        impact: "No autorizado",
      }),
    ).rejects.toMatchObject({ code: "AREA_SCOPE_DENIED" });
  });

  it("Planner cannot move work from another area", async () => {
    const order = await db
      .prepare(
        "SELECT number,version FROM work_orders WHERE id = 'wo-v2a-field'",
      )
      .first<{ number: string; version: number }>();
    await expect(
      movePlannerWork(context(restricted), order!.number, {
        expectedVersion: order!.version,
        technicianId: null,
        date: null,
      }),
    ).rejects.toMatchObject({ code: "AREA_SCOPE_DENIED" });
  });

  it("downtime cannot be started outside the actor area", async () => {
    await expect(
      startDowntime(context(restricted), "OT-LEV-2026-0390", {
        kind: "UNPLANNED",
        productionImpact: "FULL_STOP",
      }),
    ).rejects.toMatchObject({ code: "AREA_SCOPE_DENIED" });
  });

  it("meter reading cannot bypass the asset area", async () => {
    const meter = await db
      .prepare(
        "SELECT meter.id,meter.last_value AS value FROM meters meter INNER JOIN assets asset ON asset.id = meter.asset_id WHERE asset.code LIKE 'LM-02%' LIMIT 1",
      )
      .first<{ id: string; value: number }>();
    await expect(
      recordMeterReading(context(restricted), meter!.id, {
        value: meter!.value + 1,
        recordedAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ code: "AREA_SCOPE_DENIED" });
  });

  it("labor stop rolls back if audit persistence fails", async () => {
    const labor = await db
      .prepare(
        "SELECT labor.id, wo.number FROM labor_sessions labor INNER JOIN work_orders wo ON wo.id = labor.work_order_id WHERE labor.ended_at IS NULL AND wo.site_id = 'site-levante' LIMIT 1",
      )
      .first<{ id: string; number: string }>();
    await db
      .prepare(
        "CREATE TRIGGER audit_injected_failure BEFORE INSERT ON audit_entries WHEN NEW.action = 'LABOR_SESSION_STOPPED' BEGIN SELECT RAISE(ABORT, 'INJECTED_AUDIT_FAILURE'); END",
      )
      .run();
    try {
      await expect(
        stopLaborSession(context(), labor!.number, labor!.id),
      ).rejects.toThrow();
      const after = await db
        .prepare("SELECT ended_at FROM labor_sessions WHERE id = ?")
        .bind(labor!.id)
        .first<{ ended_at: string | null }>();
      expect(after!.ended_at).toBeNull();
    } finally {
      await db.prepare("DROP TRIGGER audit_injected_failure").run();
    }
  });

  it("idempotency response failure cannot leave committed evidence that duplicates on retry", async () => {
    const ctx = context();
    await db
      .prepare(
        "CREATE TRIGGER audit_idempotency_failure BEFORE UPDATE OF response_json ON operation_idempotency BEGIN SELECT RAISE(ABORT, 'INJECTED_IDEMPOTENCY_FAILURE'); END",
      )
      .run();
    try {
      await expect(
        runIdempotent(
          ctx,
          "independent_evidence_retry",
          "FIELD_EVIDENCE",
          async () => {
            await createEvidenceMetadata(ctx, "OT-LEV-2026-0390", {
              id: "audit-idempotent-evidence",
              kind: "NOTE",
              stage: "GENERAL",
              description: "Atomic idempotency sentinel",
            });
            return { id: "audit-idempotent-evidence", ok: true };
          },
        ),
      ).rejects.toThrow();
      expect(
        await db
          .prepare(
            "SELECT id FROM evidence_items WHERE id='audit-idempotent-evidence'",
          )
          .first(),
      ).toBeNull();
    } finally {
      await db.prepare("DROP TRIGGER audit_idempotency_failure").run();
    }
  });

  it("cancellation cannot strand reserved stock", async () => {
    const row = await db
      .prepare(
        "SELECT wo.id,wo.number FROM work_orders wo INNER JOIN work_order_materials m ON m.work_order_id = wo.id WHERE wo.status IN ('ASSIGNED','WAITING_PART','APPROVED') AND m.reserved_quantity > 0 LIMIT 1",
      )
      .first<{ id: string; number: string }>();
    await expect(
      cancelWorkOrder(context(), row!.number, "Audit cancellation"),
    ).rejects.toMatchObject({ code: "RESERVED_MATERIALS" });
  });

  it("cancellation racing a reserve cannot leave stock reserved on a final order", async () => {
    const number = await fixtureOrder("AUDIT-CANCEL-RESERVE");
    const part = (await db
      .prepare(
        "SELECT part_id AS id FROM stock_levels WHERE site_id='site-levante' AND on_hand-reserved>=2 LIMIT 1",
      )
      .first<{ id: string }>())!;
    const { materialId } = await addPlannedMaterial(
      context(),
      number,
      part.id,
      1,
    );
    await race([
      () => reserveMaterial(context(), number, materialId, 1),
      () => cancelWorkOrder(context(), number, "Cancel race"),
    ]);
    const invalid = await db
      .prepare(
        "SELECT wo.id FROM work_orders wo INNER JOIN work_order_materials material ON material.work_order_id=wo.id WHERE wo.id=? AND wo.status='CANCELLED' AND material.reserved_quantity>0",
      )
      .bind(number)
      .first();
    expect(invalid).toBeNull();
  });

  it("completed work cannot start new downtime or close with existing active downtime", async () => {
    const number = await fixtureOrder("AUDIT-COMPLETED-DOWNTIME", "COMPLETED");
    await expect(
      startDowntime(context(), number, {
        kind: "UNPLANNED",
        productionImpact: "FULL_STOP",
      }),
    ).rejects.toThrow();
    expect(
      await db
        .prepare("SELECT id FROM downtime_events WHERE work_order_id=?")
        .bind(number)
        .first(),
    ).toBeNull();
  });

  it("completion racing downtime start cannot leave active downtime on completed work", async () => {
    const number = await fixtureOrder("AUDIT-COMPLETE-DOWNTIME", "IN_PROGRESS");
    await race<unknown>([
      () =>
        startDowntime(context(), number, {
          kind: "UNPLANNED",
          productionImpact: "FULL_STOP",
        }),
      () =>
        completeWorkOrder(context(), number, {
          diagnosis: "Inspección funcional completada",
          solution: "Prueba operativa correcta",
        }),
    ]);
    expect(
      await db
        .prepare(
          "SELECT down.id FROM downtime_events down INNER JOIN work_orders wo ON wo.id=down.work_order_id WHERE wo.id=? AND wo.status='COMPLETED' AND down.ended_at IS NULL",
        )
        .bind(number)
        .first(),
    ).toBeNull();
  });

  it("returns reverse historical mixed-price consumption, never the current or last price", async () => {
    const number = await fixtureOrder("AUDIT-RETURNS");
    const asset = (await db
      .prepare("SELECT asset_id AS id FROM work_orders WHERE id=?")
      .bind(number)
      .first<{ id: string }>())!;
    const reliabilityBefore = (await getAssetReliability(
      tenantScope(manager),
      asset.id,
    ))!.metrics.maintenanceCost;
    const part = await db
      .prepare(
        "SELECT part_id AS id, average_cost AS cost FROM part_site_policies WHERE site_id = 'site-levante' AND part_id IN (SELECT part_id FROM stock_levels WHERE site_id = 'site-levante' AND on_hand - reserved >= 4) LIMIT 1",
      )
      .first<{ id: string; cost: number }>();
    const { materialId } = await addPlannedMaterial(
      context(),
      number,
      part!.id,
      2,
    );
    const setCost = (cost: number) =>
      db
        .prepare(
          "UPDATE part_site_policies SET average_cost = ? WHERE site_id = 'site-levante' AND part_id = ?",
        )
        .bind(cost, part!.id)
        .run();
    try {
      await setCost(10);
      await consumeMaterial(
        { ...context(), now: "2026-09-09T08:00:00.000Z" },
        number,
        materialId,
        1,
      );
      await setCost(20);
      await consumeMaterial(
        { ...context(), now: "2026-09-09T09:00:00.000Z" },
        number,
        materialId,
        1,
      );
      await setCost(99);
      await returnMaterial(context(), number, materialId, 2);
      const totals = await db
        .prepare(
          "SELECT SUM(total_cost) AS cost, SUM(CASE WHEN usage_type = 'CONSUMPTION' THEN total_cost ELSE 0 END) AS consumed FROM work_order_part_usages WHERE work_order_id = ?",
        )
        .bind(number)
        .first<{ cost: number; consumed: number }>();
      expect(totals!.consumed).toBe(30);
      expect(totals!.cost).toBeCloseTo(0, 6);
      expect(
        (await getAssetReliability(tenantScope(manager), asset.id))!.metrics
          .maintenanceCost,
      ).toBeCloseTo(reliabilityBefore, 6);
    } finally {
      await setCost(part!.cost);
    }
  });

  it("partial mixed-price returns and concurrent retries cannot over-return or reprice", async () => {
    const number = await fixtureOrder("AUDIT-PARTIAL-RETURN");
    const part = (await db
      .prepare(
        "SELECT part_id AS id,average_cost AS cost FROM part_site_policies WHERE site_id='site-levante' AND part_id IN (SELECT part_id FROM stock_levels WHERE site_id='site-levante' AND on_hand-reserved>=5) LIMIT 1",
      )
      .first<{ id: string; cost: number }>())!;
    const { materialId } = await addPlannedMaterial(
      context(),
      number,
      part.id,
      4,
    );
    const setCost = (cost: number) =>
      db
        .prepare(
          "UPDATE part_site_policies SET average_cost=? WHERE part_id=? AND site_id='site-levante'",
        )
        .bind(cost, part.id)
        .run();
    try {
      await setCost(10);
      await consumeMaterial(context(), number, materialId, 2);
      await setCost(20);
      await consumeMaterial(context(), number, materialId, 2);
      await setCost(99);
      await returnMaterial(context(), number, materialId, 1);
      expect(
        (await db
          .prepare(
            "SELECT SUM(total_cost) AS cost FROM work_order_part_usages WHERE work_order_id=?",
          )
          .bind(number)
          .first<{ cost: number }>())!.cost,
      ).toBe(45);
      const results = await race(
        [0, 1].map(
          () => () => returnMaterial(context(), number, materialId, 3),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      await expect(
        returnMaterial(context(), number, materialId, 1),
      ).rejects.toThrow();
      const rows = await db
        .prepare(
          "SELECT usage_type,quantity,unit_cost_snapshot,total_cost FROM work_order_part_usages WHERE work_order_id=?",
        )
        .bind(number)
        .all<{
          usage_type: string;
          quantity: number;
          unit_cost_snapshot: number;
          total_cost: number;
        }>();
      expect(
        rows.results
          .filter((r) => r.usage_type === "RETURN")
          .reduce((a, r) => a + r.quantity, 0),
      ).toBe(4);
      expect(rows.results.reduce((a, r) => a + r.total_cost, 0)).toBeCloseTo(
        0,
        6,
      );
      expect(
        rows.results
          .filter((r) => r.usage_type === "RETURN")
          .every((r) => r.unit_cost_snapshot === 15),
      ).toBe(true);
      const audits = await db
        .prepare(
          "SELECT new_value AS value FROM audit_entries WHERE entity_id=? AND action='PART_RETURNED'",
        )
        .bind(materialId)
        .all<{ value: string }>();
      expect(
        audits.results.every(
          (r) => JSON.parse(r.value).valuationBasis.entries.length >= 2,
        ),
      ).toBe(true);
    } finally {
      await setCost(part.cost);
    }
  });

  it("two downtime starts cannot leave two active events", async () => {
    const number = await fixtureOrder("AUDIT-DOWNTIME");
    const outcomes = await race(
      [0, 1].map(
        () => () =>
          startDowntime(context(), number, {
            kind: "UNPLANNED",
            productionImpact: "FULL_STOP",
          }),
      ),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM downtime_events WHERE work_order_id = ? AND ended_at IS NULL",
        )
        .bind(number)
        .first<{ n: number }>())!.n,
    ).toBe(1);
  });

  it("one technician cannot start concurrent sessions on two different orders", async () => {
    const user = await db
      .prepare(
        "SELECT user.id FROM users user INNER JOIN memberships m ON m.user_id = user.id WHERE m.role_key = 'TECHNICIAN' AND user.id <> 'user-tech-4' AND NOT EXISTS (SELECT 1 FROM labor_sessions l WHERE l.user_id = user.id AND l.ended_at IS NULL) LIMIT 1",
      )
      .first<{ id: string }>();
    const numbers = [
      await fixtureOrder("AUDIT-LABOR-A"),
      await fixtureOrder("AUDIT-LABOR-B"),
    ];
    for (const number of numbers)
      await db
        .prepare(
          "INSERT INTO work_order_assignments (id,work_order_id,user_id,assignment_role,assigned_at) VALUES (?,?,?,'TECHNICIAN',?)",
        )
        .bind(crypto.randomUUID(), number, user!.id, new Date().toISOString())
        .run();
    const outcomes = await race(
      numbers.map((number) => () => startWork(context(), number, user!.id)),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM labor_sessions WHERE user_id = ? AND ended_at IS NULL",
        )
        .bind(user!.id)
        .first<{ n: number }>())!.n,
    ).toBe(1);
  });

  it("double close writes exactly one close event and one audit entry", async () => {
    const number = await fixtureOrder("AUDIT-CLOSE", "COMPLETED");
    await db
      .prepare(
        "UPDATE work_orders SET solution='Comprobado',diagnosis='Inspección', actual_end=?,completed_at=? WHERE id=?",
      )
      .bind(new Date().toISOString(), new Date().toISOString(), number)
      .run();
    const outcomes = await race(
      [0, 1].map(() => () => closeWorkOrder(context(), number)),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM work_order_events WHERE work_order_id = ? AND event_type='WORK_ORDER_CLOSED'",
        )
        .bind(number)
        .first<{ n: number }>())!.n,
    ).toBe(1);
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_entries WHERE entity_id = ? AND action='WORK_ORDER_CLOSED'",
        )
        .bind(number)
        .first<{ n: number }>())!.n,
    ).toBe(1);
  });

  it.each(["RESERVE", "CONSUME", "RELEASE", "RETURN"])(
    "%s rolls back stock/material when ledger insertion fails",
    async (action) => {
      const number = await fixtureOrder(`AUDIT-ROLLBACK-${action}`);
      const part = await db
        .prepare(
          "SELECT part_id AS id FROM stock_levels WHERE site_id = 'site-levante' AND on_hand - reserved >= 5 LIMIT 1",
        )
        .first<{ id: string }>();
      const { materialId } = await addPlannedMaterial(
        context(),
        number,
        part!.id,
        2,
      );
      if (action === "RELEASE")
        await reserveMaterial(context(), number, materialId, 1);
      if (action === "RETURN")
        await consumeMaterial(context(), number, materialId, 1);
      const snapshot = async () => ({
        material: await db
          .prepare("SELECT * FROM work_order_materials WHERE id=?")
          .bind(materialId)
          .first(),
        stock: (
          await db
            .prepare("SELECT * FROM stock_levels WHERE part_id=? ORDER BY id")
            .bind(part!.id)
            .all()
        ).results,
      });
      const before = await snapshot();
      await db
        .prepare(
          `CREATE TRIGGER audit_ledger_failure BEFORE INSERT ON inventory_movements WHEN NEW.reference = '${number}' BEGIN SELECT RAISE(ABORT, 'INJECTED_LEDGER_FAILURE'); END`,
        )
        .run();
      try {
        const operations = {
          RESERVE: reserveMaterial,
          CONSUME: consumeMaterial,
          RELEASE: releaseMaterial,
          RETURN: returnMaterial,
        };
        await expect(
          operations[action as keyof typeof operations](
            context(),
            number,
            materialId,
            1,
          ),
        ).rejects.toThrow();
        expect(await snapshot()).toEqual(before);
      } finally {
        await db.prepare("DROP TRIGGER audit_ledger_failure").run();
      }
    },
  );

  it("two last-stock reservations cannot commit a phantom material/ledger on CAS failure", async () => {
    const source = await db
      .prepare(
        "SELECT id FROM work_orders WHERE site_id = 'site-levante' AND status = 'ASSIGNED' LIMIT 1",
      )
      .first<{ id: string }>();
    const part = await db
      .prepare(
        "SELECT part_id AS id FROM stock_levels WHERE site_id = 'site-levante' AND on_hand - reserved >= 2 ORDER BY id LIMIT 1",
      )
      .first<{ id: string }>();
    const stockBefore = await db
      .prepare(
        "SELECT SUM(reserved) AS reserved FROM stock_levels WHERE site_id = 'site-levante' AND part_id = ?",
      )
      .bind(part!.id)
      .first<{ reserved: number }>();
    const numbers = ["AUDIT-CAS-A", "AUDIT-CAS-B"];
    const materials: string[] = [];
    for (const number of numbers) {
      await cloneRow("work_orders", source!.id, {
        id: number,
        number,
        maintenance_plan_id: null,
        maintenance_window_key: null,
        version: 1,
      });
      const result = await addPlannedMaterial(context(), number, part!.id, 2);
      materials.push(result.materialId);
    }
    // Synchronize at the transaction boundary so both requests read the same
    // versions. SQL is not stubbed; both batches execute on the D1 engine.
    let arrivals = 0;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    binding.db = {
      prepare: db.prepare.bind(db),
      batch: async (statements: D1PreparedStatement[]) => {
        if (++arrivals === 2) release();
        await ready;
        return db.batch(statements);
      },
    } as D1Database;
    let results: PromiseSettledResult<void>[];
    try {
      results = await Promise.allSettled(
        numbers.map((number, i) =>
          reserveMaterial(context(), number, materials[i], 1),
        ),
      );
    } finally {
      binding.db = db;
    }
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const stockAfter = await db
      .prepare(
        "SELECT SUM(reserved) AS reserved FROM stock_levels WHERE site_id = 'site-levante' AND part_id = ?",
      )
      .bind(part!.id)
      .first<{ reserved: number }>();
    const material = await db
      .prepare(
        "SELECT SUM(reserved_quantity) AS reserved FROM work_order_materials WHERE work_order_id IN ('AUDIT-CAS-A','AUDIT-CAS-B')",
      )
      .first<{ reserved: number }>();
    const ledger = await db
      .prepare(
        "SELECT SUM(delta_reserved) AS reserved FROM inventory_movements WHERE work_order_id IN ('AUDIT-CAS-A','AUDIT-CAS-B')",
      )
      .first<{ reserved: number }>();
    expect(material!.reserved).toBe(
      stockAfter!.reserved - stockBefore!.reserved,
    );
    expect(ledger!.reserved).toBe(material!.reserved);
  });
  it("Reliability keeps a real microstop distinct from no productive impact", async () => {
    await fixtureOrder("AUDIT-MICROSTOP");
    const started = await startDowntime(context(), "AUDIT-MICROSTOP", {
      startedAt: new Date(Date.now() - 120000).toISOString(),
      kind: "UNPLANNED",
      productionImpact: "MICROSTOP",
    });
    await endDowntime(context(), "AUDIT-MICROSTOP", started.id);
    const result = await getReliabilityCenter(tenantScope(manager));
    expect(
      result.downtime.find((item) => item.key === "MICROSTOP")?.label,
    ).toBe("Microparada");
  });
  it("Reliability excludes future failures from a historical as-of window", async () => {
    const asOf = new Date().toISOString();
    const scope = tenantScope(manager);
    const before = await getReliabilityCenter(scope, asOf);
    const future = new Date(Date.now() + 86400000).toISOString();
    await cloneRow("work_orders", "wo-v2a-field", {
      id: "audit-future",
      number: "AUDIT-FUTURE",
      status: "CLOSED",
      type: "CORRECTIVE",
      requested_at: future,
      actual_start: future,
      actual_end: future,
      completed_at: future,
      closed_at: future,
      maintenance_plan_id: null,
      maintenance_window_key: null,
    });
    try {
      const after = await getReliabilityCenter(scope, asOf);
      expect(after.summary).toEqual(before.summary);
      expect(after.trends).toEqual(before.trends);
      expect(after.pareto).toEqual(before.pareto);
    } finally {
      await db.prepare("DELETE FROM work_orders WHERE id='audit-future'").run();
    }
  });

  it("10x persisted asset/work volume does not truncate reliability totals", async () => {
    const scope = tenantScope(manager);
    const measurements: Array<{
      scale: string;
      route: string;
      milliseconds: number;
      bytes: number;
    }> = [];
    const measure = async (scale: string) => {
      const surfaces: Record<string, () => Promise<unknown>> = {
        overview: () => getOverview(scope),
        planner: () => getPlannerData(scope, manager.userId),
        reliability: () => getReliabilityCenter(scope),
        procurement: () => getProcurementCenter(scope),
        reporting: () =>
          getReportingData(manager, { from: "2026-07-01", to: "2026-09-10" }),
        inventory: () => listInventory(scope, {}),
        myWork: () => getMyWork(scope, manager.userId),
      };
      for (const [route, read] of Object.entries(surfaces)) {
        const start = performance.now();
        const data = await read();
        measurements.push({
          scale,
          route,
          milliseconds: Math.round(performance.now() - start),
          bytes: new TextEncoder().encode(JSON.stringify(data)).byteLength,
        });
      }
    };
    await measure("1x");
    const asset = (await db
      .prepare("SELECT * FROM assets WHERE id='asset-pr-01'")
      .first<Record<string, unknown>>())!;
    const work = (await db
      .prepare("SELECT * FROM work_orders WHERE id='wo-v2a-field'")
      .first<Record<string, unknown>>())!;
    const insert = (table: string, row: Record<string, unknown>) =>
      db
        .prepare(
          `INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(
            row,
          )
            .map(() => "?")
            .join(",")})`,
        )
        .bind(...Object.values(row));
    for (let group = 0; group < 18; group++) {
      const statements = [];
      for (let j = 0; j < 36; j++) {
        const id = `audit-scale-${group * 36 + j}`;
        statements.push(
          insert("assets", {
            ...asset,
            id,
            code: id,
            scan_code: `SCAN-${id}`,
            parent_asset_id: null,
          }),
        );
        statements.push(
          insert("work_orders", {
            ...work,
            id,
            number: id,
            asset_id: id,
            functional_location_id: asset.functional_location_id,
            status: "CLOSED",
            type: "CORRECTIVE",
            requested_at: "2026-09-01T08:00:00Z",
            actual_start: "2026-09-01T08:00:00Z",
            actual_end: "2026-09-01T09:00:00Z",
            completed_at: "2026-09-01T09:00:00Z",
            closed_at: "2026-09-01T09:05:00Z",
            maintenance_plan_id: null,
            maintenance_window_key: null,
          }),
        );
      }
      await db.batch(statements);
    }
    await measure("10x");
    console.info("INDEPENDENT_PERFORMANCE", JSON.stringify(measurements));
    const actual = await getReliabilityCenter(scope);
    const expected = (await db
      .prepare(
        "SELECT COUNT(*) AS n FROM work_orders wo INNER JOIN assets asset ON asset.id=wo.asset_id WHERE wo.site_id='site-levante' AND asset.status<>'RETIRED' AND wo.type='CORRECTIVE' AND wo.status IN ('COMPLETED','CLOSED') AND wo.requested_at>=?",
      )
      .bind(actual.window.startsAt)
      .first<{ n: number }>())!.n;
    expect(actual.summary.failureCount).toBe(expected);
    const [start, end] = [actual.window.startsAt, actual.window.endsAt];
    const oracle = (await db
      .prepare(
        `SELECT
      (SELECT COUNT(*) FROM assets WHERE site_id='site-levante' AND status<>'RETIRED') AS assets,
      (SELECT AVG((julianday(w.actual_end)-julianday(w.actual_start))*1440) FROM work_orders w INNER JOIN assets a ON a.id=w.asset_id WHERE w.site_id='site-levante' AND a.status<>'RETIRED' AND w.type='CORRECTIVE' AND w.status IN ('COMPLETED','CLOSED') AND w.requested_at BETWEEN ? AND ? AND w.actual_start IS NOT NULL AND w.actual_end IS NOT NULL) AS mttr,
      (SELECT COALESCE(SUM(d.duration_minutes),0) FROM downtime_events d INNER JOIN assets a ON a.id=d.asset_id WHERE d.site_id='site-levante' AND a.status<>'RETIRED' AND d.kind<>'PLANNED' AND d.started_at BETWEEN ? AND ? AND (d.work_order_id IS NULL OR d.work_order_id IN (SELECT id FROM work_orders WHERE type='CORRECTIVE'))) AS downtime`,
      )
      .bind(start, end, start, end)
      .first<{ assets: number; mttr: number; downtime: number }>())!;
    expect(actual.summary.downtimeMinutes).toBe(oracle.downtime);
    expect(actual.summary.mttrMinutes).toBeCloseTo(oracle.mttr, 6);
    expect(actual.summary.mtbfMinutes).toBeCloseTo(
      (oracle.assets * 90 * 1440 - oracle.downtime) / expected,
      6,
    );
    expect(actual.summary.availability).toBeCloseTo(
      100 * (1 - oracle.downtime / (oracle.assets * 90 * 1440)),
      6,
    );
    const pareto = (
      await db
        .prepare(
          `SELECT a.id,SUM(d.duration_minutes) AS value FROM downtime_events d INNER JOIN assets a ON a.id=d.asset_id
      WHERE d.site_id='site-levante' AND a.status<>'RETIRED' AND d.kind<>'PLANNED' AND d.started_at BETWEEN ? AND ?
      AND (d.work_order_id IS NULL OR d.work_order_id IN (SELECT id FROM work_orders WHERE type='CORRECTIVE')) GROUP BY a.id HAVING value>0 ORDER BY value DESC,a.id`,
        )
        .bind(start, end)
        .all<{ id: string; value: number }>()
    ).results;
    let cumulative = 0;
    for (let i = 0; i < Math.min(10, pareto.length); i++) {
      cumulative += pareto[i].value;
      expect(actual.pareto.downtimeByAsset[i].id).toBe(pareto[i].id);
      expect(actual.pareto.downtimeByAsset[i].share).toBeCloseTo(
        (pareto[i].value * 100) / oracle.downtime,
        6,
      );
      expect(actual.pareto.downtimeByAsset[i].cumulativeShare).toBeCloseTo(
        (cumulative * 100) / oracle.downtime,
        6,
      );
    }
    const at = (days: number) =>
      new Date(new Date(end).getTime() - days * 86400000).toISOString();
    const trend = actual.trends.find((item) => item.key === "failures")!;
    for (const [key, from, to] of [
      ["current", at(30), end],
      ["previous", at(60), at(30)],
    ] as const) {
      const count = (await db
        .prepare(
          `SELECT COUNT(*) AS n FROM work_orders WHERE site_id='site-levante' AND type='CORRECTIVE' AND status IN ('COMPLETED','CLOSED') AND requested_at>=? AND requested_at${key === "current" ? "<=" : "<"}?`,
        )
        .bind(from, to)
        .first<{ n: number }>())!.n;
      expect(trend[key]).toBe(count);
    }
    // Reporting uses completion dates / productive exposure, not the same
    // cohort as Reliability. Verify each documented window against raw rows.
    for (const days of [7, 30, 90]) {
      const filters = { from: at(days).slice(0, 10), to: end.slice(0, 10) };
      const report = await getReportingData(manager, filters);
      const raw = (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM work_orders WHERE site_id='site-levante' AND type='CORRECTIVE' AND completed_at BETWEEN ? AND ?",
        )
        .bind(filters.from + "T00:00:00.000Z", filters.to + "T23:59:59.999Z")
        .first<{ n: number }>())!.n;
      expect(report.summary.failureCount).toBe(raw);
      const repair = (await db
        .prepare(
          "SELECT AVG((julianday(actual_end)-julianday(actual_start))*1440) AS minutes FROM work_orders WHERE site_id='site-levante' AND type='CORRECTIVE' AND status IN ('COMPLETED','CLOSED') AND actual_start IS NOT NULL AND actual_end IS NOT NULL AND completed_at BETWEEN ? AND ?",
        )
        .bind(filters.from + "T00:00:00.000Z", filters.to + "T23:59:59.999Z")
        .first<{ minutes: number | null }>())!;
      expect(report.summary.mttrMinutes, `Reporting MTTR ${days}d`).toBeCloseTo(
        repair.minutes ?? 0,
        6,
      );
      expect(report.summary.totalCostCents).toBe(
        report.summary.laborCents +
          report.summary.materialCents +
          report.summary.explicitCents,
      );
    }
    const recurrence = (await db
      .prepare(
        `SELECT SUM(n-1) AS repeated,SUM(n) AS failures FROM (
      SELECT COUNT(*) AS n FROM work_orders wo INNER JOIN assets a ON a.id=wo.asset_id
      WHERE wo.site_id='site-levante' AND a.status<>'RETIRED' AND wo.type='CORRECTIVE'
      AND wo.status IN ('COMPLETED','CLOSED') AND wo.requested_at BETWEEN ? AND ?
      GROUP BY wo.asset_id,COALESCE(wo.failure_mode_id,wo.failure_mode))`,
      )
      .bind(actual.window.startsAt, actual.window.endsAt)
      .first<{ repeated: number; failures: number }>())!;
    expect(actual.summary.repeatFailureRate).toBeCloseTo(
      (recurrence.repeated * 100) / recurrence.failures,
      6,
    );
    const overview = await getOverview(scope);
    const overviewRepair = (await db
      .prepare(
        "SELECT AVG((julianday(actual_end)-julianday(actual_start))*1440) AS minutes FROM work_orders WHERE site_id='site-levante' AND type='CORRECTIVE' AND status IN ('COMPLETED','CLOSED') AND actual_start IS NOT NULL AND actual_end BETWEEN ? AND ?",
      )
      .bind(start, overview.generatedAt)
      .first<{ minutes: number | null }>())!;
    expect(overview.kpis.mttrMinutes, "Overview MTTR").toBe(
      Math.round(overviewRepair.minutes ?? 0),
    );
    for (const actor of actual.badActors) {
      const dossier = (await getAssetReliability(
        scope,
        actor.id,
        actual.window.endsAt,
      ))!;
      expect(actor.healthScore, actor.code).toBe(dossier.metrics.healthScore);
      expect(actor.healthScore).toBe(
        Math.max(
          0,
          Math.min(
            100,
            Math.round(
              100 +
                actor.healthBreakdown.reduce(
                  (sum, item) => sum + item.adjustment,
                  0,
                ),
            ),
          ),
        ),
      );
      expect(actor.repeatFailureRate, actor.code).toBe(
        dossier.metrics.repeatFailureRate,
      );
    }
  }, 120_000);
});
