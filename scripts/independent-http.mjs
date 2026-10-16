// Compiled Worker + real HTTP + final-state assertions against its isolated D1.
// Never uses the user's development database or any remote deployment.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const state = mkdtempSync(join(tmpdir(), "mazmi-http-audit-"));
const base = "http://127.0.0.1:3041";
const visualMode = process.argv.includes("--visual-only");
const visualTestNow = "2026-09-08T12:00:00.000Z";
const workerArguments = [
  "node_modules/wrangler/bin/wrangler.js",
  "dev",
  "--config",
  "dist/server/wrangler.json",
  "--ip",
  "127.0.0.1",
  "--port",
  "3041",
  "--inspector-port",
  "9241",
  "--local",
  "--persist-to",
  state,
  "--show-interactive-dev-session=false",
  "--var",
  "MAZMI_APP_MODE:DEMO",
];
if (visualMode)
  workerArguments.push("--var", `MAZMI_TEST_NOW:${visualTestNow}`);
const worker = spawn(process.execPath, workerArguments, {
  env: visualMode
    ? { ...process.env, MAZMI_TEST_NOW: visualTestNow }
    : process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
worker.stdout.on("data", (chunk) => {
  logs += chunk;
});
worker.stderr.on("data", (chunk) => {
  logs += chunk;
});
let db;
let passed = 0;
const failures = [];
async function check(name, run) {
  try {
    await run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
async function post(path, cookie, body, headers = {}) {
  return fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: base,
      cookie,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
async function retryProxyTransport(label, request) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await request();
      if (
        response.status !== 500 ||
        (await response.clone().text()).trim() !==
          "Error: Network connection lost."
      )
        return response;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "Network connection lost."
      )
        throw error;
    }
    // Retry only Wrangler's ProxyWorker transport error, never an API 500.
    console.log(`WRANGLER_PROXY_RETRY ${label} ${attempt + 1}`);
    await delay(200);
  }
  throw new Error(`Wrangler proxy did not recover: ${label}`);
}
async function login(email) {
  const response = await post("/api/auth/login", "", {
    email,
    password: "Mazmi2026!",
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert(cookie);
  return cookie;
}
async function data(response) {
  const json = await response.json();
  assert(response.ok, `${response.status} ${json.error?.code}`);
  return json.data;
}
async function page(path, cookie) {
  const response = await fetch(base + path, {
    headers: { cookie },
    redirect: "manual",
  });
  return { status: response.status, body: await response.text() };
}
const hidden = (result) =>
  result.status === 404 ||
  /NEXT_HTTP_ERROR_FALLBACK;404/.test(result.body) ||
  (result.status >= 300 && result.status < 400);
try {
  let ready = false;
  for (let i = 0; i < 180; i++) {
    if (worker.exitCode !== null)
      throw new Error(`Worker exited ${worker.exitCode}: ${logs.slice(-1500)}`);
    try {
      const response = await fetch(base + "/api/health");
      const health = await response.json();
      if (response.ok) {
        assert.equal(health.schemaVersion, "0013_preventive_scheduler");
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  assert(ready, "Isolated Worker did not initialize");
  if (
    process.argv.includes("--smoke-only") ||
    process.argv.includes("--visual-only")
  ) {
    const visual = visualMode;
    const smoke = spawn(
      process.execPath,
      visual
        ? ["node_modules/@playwright/test/cli.js", "test"]
        : ["scripts/smoke.mjs"],
      {
        env: {
          ...process.env,
          MAZMI_BASE_URL: base,
          ...(visual ? { MAZMI_VISUAL_BASE_URL: base } : {}),
        },
        stdio: "inherit",
      },
    );
    const code = await new Promise((resolve, reject) => {
      smoke.once("error", reject);
      smoke.once("exit", resolve);
    });
    assert.equal(
      code,
      0,
      visual
        ? "Compiled visual gate failed"
        : "Compiled cumulative smoke failed",
    );
  } else {
    const directory = join(state, "v3/d1/miniflare-D1DatabaseObject");
    const databases = readdirSync(directory).filter((name) => {
      if (!name.endsWith(".sqlite")) return false;
      const candidate = new DatabaseSync(join(directory, name), {
        readOnly: true,
      });
      try {
        return Boolean(
          candidate
            .prepare("SELECT name FROM sqlite_master WHERE name='work_orders'")
            .get(),
        );
      } finally {
        candidate.close();
      }
    });
    assert.equal(databases.length, 1);
    db = new DatabaseSync(join(directory, databases[0]));
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    const tech = await login("tecnico4@mazmi.demo");
    const manager = await login("responsable@mazmi.demo");
    const number = "OT-LEV-2026-0390";
    const clone = (table, sourceId, overrides) => {
      const original = db
        .prepare(`SELECT * FROM ${table} WHERE id=?`)
        .get(sourceId);
      assert(original);
      const row = { ...original, ...overrides };
      db.prepare(
        `INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(
          row,
        )
          .map(() => "?")
          .join(",")})`,
      ).run(...Object.values(row));
    };
    await check(
      "every visible My Work order belongs to Irene's current authorized areas",
      async () => {
        const visible = await page("/my-work", tech);
        const numbers = [
          ...new Set(
            [...visible.body.matchAll(/href="\/my-work\/([^"?]+)"/g)].map(
              (match) => decodeURIComponent(match[1]),
            ),
          ),
        ];
        assert(numbers.length > 0);
        for (const order of numbers) {
          const permitted = db
            .prepare(
              `WITH RECURSIVE location(id,parent_id) AS (
        SELECT l.id,l.parent_id FROM functional_locations l INNER JOIN work_orders w ON w.functional_location_id=l.id WHERE w.number=?
        UNION ALL SELECT p.id,p.parent_id FROM functional_locations p INNER JOIN location c ON c.parent_id=p.id)
        SELECT l.id FROM location l INNER JOIN membership_area_scopes a ON a.functional_location_id=l.id
        INNER JOIN membership_site_scopes s ON s.id=a.membership_site_scope_id
        WHERE s.membership_id='membership-user-tech-4' AND s.site_id='site-levante' LIMIT 1`,
            )
            .get(order);
          assert(permitted, `Unauthorized visible order ${order}`);
        }
        console.log(`AUTHORIZED_MY_WORK ${numbers.join(",")}`);
      },
    );
    const handover = {
      fromShift: "M1",
      toShift: "T1",
      summary: "AUDIT_PRIVATE_HANDOVER",
      workOrderNumbers: [number],
    };
    const key = "independent-http-handover";
    const headers = {
      "idempotency-key": key,
      "x-mazmi-user": "user-tech-4",
      "x-mazmi-site": "site-levante",
      "x-mazmi-organization": "org-mazmi-flexpack",
    };
    let handoverId;
    await check(
      "same identity, concurrent handover/retry commits exactly once",
      async () => {
        const results = await Promise.all([
          post("/api/field/handovers", tech, handover, headers),
          post("/api/field/handovers", tech, handover, headers),
        ]);
        assert(results.some((r) => r.ok));
        assert(results.every((r) => r.ok || r.status === 409));
        const replay = await post(
          "/api/field/handovers",
          tech,
          handover,
          headers,
        );
        const payload = await replay.json();
        assert.equal(replay.status, 200);
        assert.equal(payload.replayed, true);
        const rows = db
          .prepare("SELECT id FROM shift_handovers WHERE summary=?")
          .all(handover.summary);
        assert.equal(rows.length, 1);
        handoverId = rows[0].id;
      },
    );
    for (const [label, changed] of [
      ["other user", { "x-mazmi-user": "user-manager" }],
      ["other site", { "x-mazmi-site": "site-alzira" }],
      ["other organization", { "x-mazmi-organization": "other-org" }],
    ])
      await check(`offline replay rejects ${label}`, async () => {
        const result = await retryProxyTransport(label, () =>
          post("/api/field/handovers", tech, handover, {
            ...headers,
            ...changed,
          }),
        );
        const body = await result.text();
        assert.equal(result.status, 403, body.slice(0, 500));
        assert.equal(JSON.parse(body).error.code, "OFFLINE_SCOPE_CHANGED");
        assert.equal(
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM shift_handovers WHERE summary=?",
            )
            .get(handover.summary).n,
          1,
        );
      });
    await check("same idempotency key cannot change payload", async () => {
      let changed;
      // Wrangler's local ProxyWorker can lose its dev-server connection while
      // the Worker remains healthy. Retry only this exact transport response;
      // the same idempotency key/payload must still be rejected by the API.
      let proxyRetries = 0;
      for (let attempt = 0; attempt < 6; attempt++) {
        changed = await post(
          "/api/field/handovers",
          tech,
          { ...handover, summary: "Altered payload" },
          headers,
        );
        if (
          changed.status !== 500 ||
          (await changed.clone().text()).trim() !==
            "Error: Network connection lost."
        )
          break;
        proxyRetries++;
        await delay(200);
      }
      const body = await changed.text();
      assert.equal(
        changed.status,
        409,
        `${changed.status} ${body.slice(0, 300)} after ${proxyRetries} ProxyWorker retries`,
      );
    });
    const evidencePath = `/api/field/work-orders/${number}/evidence`;
    const evidence = await data(
      await post(
        evidencePath,
        tech,
        {
          kind: "PHOTO",
          stage: "BEFORE",
          description: "AUDIT_PRIVATE_EVIDENCE",
          fileName: "audit.png",
          contentType: "image/png",
          dataBase64:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ9kAAAAASUVORK5CYII=",
        },
        { "idempotency-key": "independent-http-evidence" },
      ),
    );
    const evidenceUrl = `/api/field/evidence/${evidence.id}/content`;
    await check("evidence positive control reads stored R2 bytes", async () => {
      assert.equal(
        (await fetch(base + evidenceUrl, { headers: { cookie: tech } })).status,
        200,
      );
    });
    const scope = db
      .prepare(
        "SELECT id FROM membership_site_scopes WHERE membership_id='membership-user-tech-4' AND site_id='site-levante'",
      )
      .get();
    assert(scope);
    const areas = db
      .prepare(
        "SELECT * FROM membership_area_scopes WHERE membership_site_scope_id=?",
      )
      .all(scope.id);
    assert(areas.length);
    db.prepare(
      "DELETE FROM membership_area_scopes WHERE membership_site_scope_id=?",
    ).run(scope.id);
    try {
      await check("live area revocation denies cached replay", async () => {
        assert.equal(
          (await post("/api/field/handovers", tech, handover, headers)).status,
          403,
        );
      });
      await check("live area revocation denies evidence content", async () => {
        assert.equal(
          (await fetch(base + evidenceUrl, { headers: { cookie: tech } }))
            .status,
          404,
        );
      });
      for (const path of [
        `/my-work/${number}`,
        `/work-orders/${number}`,
        "/assets/LM-02-APP",
        "/scan/MZ-LEV-LM-02-APP",
      ])
        await check(`live area revocation denies ${path}`, async () => {
          assert(hidden(await page(path, tech)));
        });
      await check("live area revocation filters search", async () => {
        const result = await (
          await fetch(base + "/api/search?q=LM-02", {
            headers: { cookie: tech },
          })
        ).json();
        assert.equal(result.data.length, 0);
      });
      await check(
        "live area revocation filters My Work, handovers and notifications without erasing history",
        async () => {
          const result = await page("/my-work", tech);
          assert.equal(result.status, 200);
          assert(!result.body.includes(number));
          assert(!result.body.includes(handover.summary));
          assert(
            db
              .prepare("SELECT id FROM shift_handovers WHERE id=?")
              .get(handoverId),
          );
          assert(
            db
              .prepare("SELECT id FROM evidence_items WHERE id=?")
              .get(evidence.id),
          );
        },
      );
    } finally {
      for (const row of areas)
        db.prepare(
          "INSERT INTO membership_area_scopes (id,membership_site_scope_id,functional_location_id,created_at) VALUES (?,?,?,?)",
        ).run(
          row.id,
          row.membership_site_scope_id,
          row.functional_location_id,
          row.created_at,
        );
    }
    // Remove the role's execution grant without logging out. Membership remains valid.
    const grant = db
      .prepare(
        "SELECT * FROM role_permissions WHERE role_key='TECHNICIAN' AND permission_code='workorder.execute'",
      )
      .get();
    assert(grant);
    db.prepare(
      "DELETE FROM role_permissions WHERE role_key=? AND permission_code=?",
    ).run(grant.role_key, grant.permission_code);
    try {
      await check(
        "live permission revocation denies replay before cached response",
        async () => {
          assert.equal(
            (await post("/api/field/handovers", tech, handover, headers))
              .status,
            403,
          );
        },
      );
      await check(
        "live permission revocation denies direct field workspace",
        async () => {
          assert(hidden(await page(`/my-work/${number}`, tech)));
        },
      );
      await check(
        "live permission revocation denies evidence URL",
        async () => {
          assert.equal(
            (await fetch(base + evidenceUrl, { headers: { cookie: tech } }))
              .status,
            403,
          );
        },
      );
    } finally {
      db.prepare(
        "INSERT INTO role_permissions (role_key,permission_code,created_at) VALUES (?,?,?)",
      ).run(grant.role_key, grant.permission_code, grant.created_at);
    }
    await check("restoring scope restores legitimate access", async () => {
      assert.equal(
        (await fetch(base + evidenceUrl, { headers: { cookie: tech } })).status,
        200,
      );
    });
    const incident = await data(
      await post("/api/incidents", tech, {
        functionalLocationId: "loc-lev-lm-02",
        title: "AUDIT_PRIVATE_INCIDENT",
        description: "Aviso privado de regresión de permisos",
        severity: "LOW",
        initialImpact: "NO_IMPACT",
      }),
    );
    const reportGrant = db
      .prepare(
        "SELECT * FROM role_permissions WHERE role_key='TECHNICIAN' AND permission_code='incident.report'",
      )
      .get();
    assert(reportGrant);
    db.prepare(
      "DELETE FROM role_permissions WHERE role_key=? AND permission_code=?",
    ).run(reportGrant.role_key, reportGrant.permission_code);
    try {
      for (const path of ["/incidents", `/incidents/${incident.number}`])
        await check(
          `revoked navigation permission also denies ${path}`,
          async () => {
            assert(hidden(await page(path, tech)));
          },
        );
      await check(
        "search does not bypass revoked incident permission",
        async () => {
          const result = await (
            await fetch(base + "/api/search?q=AUDIT_PRIVATE_INCIDENT", {
              headers: { cookie: tech },
            })
          ).json();
          assert.equal(
            result.data.filter((item) => item.kind === "INCIDENT").length,
            0,
          );
        },
      );
    } finally {
      db.prepare(
        "INSERT INTO role_permissions (role_key,permission_code,created_at) VALUES (?,?,?)",
      ).run(
        reportGrant.role_key,
        reportGrant.permission_code,
        reportGrant.created_at,
      );
    }
    // Independent HTTP transactions: fixtures extend the isolated database only.
    const orders = ["AUDIT-HTTP-A", "AUDIT-HTTP-B"];
    const sourceOrder = db
      .prepare("SELECT id FROM work_orders WHERE number=?")
      .get(number).id;
    await check(
      "denied same-area work-order URL does not leak metadata",
      async () => {
        const row = db
          .prepare(
            `SELECT w.number,w.title FROM work_orders w WHERE w.site_id='site-levante' AND w.functional_location_id=(SELECT functional_location_id FROM work_orders WHERE id=?)
        AND NOT EXISTS (SELECT 1 FROM work_order_assignments a WHERE a.work_order_id=w.id AND a.user_id='user-tech-4' AND a.unassigned_at IS NULL) LIMIT 1`,
          )
          .get(sourceOrder);
        assert(
          row,
          "Fixture requires a same-area order assigned to someone else",
        );
        const result = await page(`/work-orders/${row.number}`, tech);
        assert(hidden(result));
        assert(
          !result.body.includes(row.title),
          "Denied order leaked title through metadata",
        );
      },
    );
    for (const order of orders) {
      clone("work_orders", sourceOrder, {
        id: order,
        number: order,
        maintenance_plan_id: null,
        maintenance_window_key: null,
        version: 1,
        safety_level: "STANDARD",
        isolation_required: 0,
      });
      await data(
        await post(`/api/work-orders/${order}/actions`, manager, {
          action: "ASSIGN",
          technicianId: "user-tech-4",
        }),
      );
    }
    await check(
      "parallel HTTP starts cannot create two active labor sessions for one technician",
      async () => {
        const results = await Promise.all(
          orders.map((order) =>
            post(`/api/work-orders/${order}/actions`, tech, {
              action: "START",
            }),
          ),
        );
        assert.equal(results.filter((r) => r.ok).length, 1);
        assert(results.every((r) => r.ok || r.status === 409));
        const rows = db
          .prepare(
            "SELECT id,work_order_id FROM labor_sessions WHERE user_id='user-tech-4' AND ended_at IS NULL",
          )
          .all();
        assert.equal(rows.length, 1);
        await data(
          await post(
            `/api/work-orders/${rows[0].work_order_id}/actions`,
            tech,
            { action: "STOP_SESSION", laborSessionId: rows[0].id },
          ),
        );
        assert.equal(
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM labor_sessions WHERE user_id='user-tech-4' AND ended_at IS NULL",
            )
            .get().n,
          0,
        );
      },
    );
    await check(
      "parallel HTTP last-stock reservations preserve material/stock/ledger equality",
      async () => {
        const stock = db
          .prepare(
            "SELECT * FROM stock_levels WHERE site_id='site-levante' AND on_hand>reserved AND part_id IN (SELECT part_id FROM stock_levels WHERE site_id='site-levante' GROUP BY part_id HAVING COUNT(*)=1) ORDER BY id LIMIT 1",
          )
          .get();
        assert(stock);
        const quantity = stock.on_hand - stock.reserved;
        const material = [];
        for (const order of orders)
          material.push(
            (
              await data(
                await post(`/api/work-orders/${order}/materials`, manager, {
                  action: "ADD_PLANNED",
                  partId: stock.part_id,
                  quantity,
                }),
              )
            ).materialId,
          );
        const results = await Promise.all(
          orders.map((order, i) =>
            post(`/api/work-orders/${order}/materials`, manager, {
              action: "RESERVE",
              materialId: material[i],
              quantity,
            }),
          ),
        );
        assert.equal(results.filter((r) => r.ok).length, 1);
        assert(results.every((r) => r.ok || r.status === 409));
        const after = db
          .prepare("SELECT * FROM stock_levels WHERE id=?")
          .get(stock.id);
        const reserved = db
          .prepare(
            "SELECT SUM(reserved_quantity) AS n FROM work_order_materials WHERE id IN (?,?)",
          )
          .get(...material).n;
        const ledger = db
          .prepare(
            "SELECT SUM(delta_reserved) AS n FROM inventory_movements WHERE work_order_id IN (?,?)",
          )
          .get(...orders).n;
        assert.equal(after.on_hand, stock.on_hand);
        assert.equal(after.reserved - stock.reserved, quantity);
        assert.equal(reserved, quantity);
        assert.equal(ledger, quantity);
        const winner = results.findIndex((r) => r.ok);
        await data(
          await post(`/api/work-orders/${orders[winner]}/materials`, manager, {
            action: "RELEASE",
            materialId: material[winner],
            quantity,
          }),
        );
      },
    );
    await check(
      "parallel HTTP downtime starts preserve one active event",
      async () => {
        const path = `/api/work-orders/${orders[0]}/downtime`;
        const payload = {
          action: "START",
          kind: "UNPLANNED",
          productionImpact: "FULL_STOP",
          cause: "Independent concurrency audit",
        };
        const results = await Promise.all([
          post(path, manager, payload),
          post(path, manager, payload),
        ]);
        assert.equal(results.filter((r) => r.ok).length, 1);
        assert(results.every((r) => r.ok || r.status === 409));
        const rows = db
          .prepare(
            "SELECT id FROM downtime_events WHERE work_order_id=? AND ended_at IS NULL",
          )
          .all(orders[0]);
        assert.equal(rows.length, 1);
        await data(
          await post(path, manager, { action: "END", downtimeId: rows[0].id }),
        );
      },
    );
    await check(
      "receipt HTTP fault rolls back PO, stock, on-order, receipt and ledger; retry/concurrency commits once",
      async () => {
        const po = db
          .prepare(
            "SELECT po.*,line.id AS line_id,line.part_id FROM purchase_orders po INNER JOIN purchase_order_lines line ON line.purchase_order_id=po.id WHERE po.site_id='site-levante' AND po.status IN ('SENT','PARTIALLY_RECEIVED') AND line.ordered_quantity-line.received_quantity>=1 LIMIT 1",
          )
          .get();
        assert(po);
        const path = `/api/procurement/purchase-orders/${po.number}/receipts`;
        const payload = {
          idempotencyKey: "independent-http-receipt",
          version: po.version,
          lines: [{ lineId: po.line_id, quantity: 1 }],
        };
        const snapshot = () => ({
          po: db.prepare("SELECT * FROM purchase_orders WHERE id=?").get(po.id),
          line: db
            .prepare("SELECT * FROM purchase_order_lines WHERE id=?")
            .get(po.line_id),
          stock: db
            .prepare("SELECT * FROM stock_levels WHERE part_id=? ORDER BY id")
            .all(po.part_id),
          receipts: db.prepare("SELECT COUNT(*) AS n FROM goods_receipts").get()
            .n,
          ledger: db
            .prepare("SELECT COUNT(*) AS n FROM inventory_movements")
            .get().n,
        });
        const before = snapshot();
        db.exec(
          "CREATE TRIGGER independent_http_receipt_fault BEFORE INSERT ON goods_receipt_lines BEGIN SELECT RAISE(ABORT,'INJECTED_RECEIPT_FAILURE'); END;",
        );
        try {
          assert.equal((await post(path, manager, payload)).status, 500);
          assert.deepEqual(snapshot(), before);
        } finally {
          db.exec("DROP TRIGGER independent_http_receipt_fault");
        }
        const results = await Promise.all([
          post(path, manager, payload),
          post(path, manager, payload),
        ]);
        assert(results.some((r) => r.ok));
        assert(results.every((r) => r.ok || r.status === 409));
        await data(await post(path, manager, payload));
        const after = snapshot();
        assert.equal(after.receipts - before.receipts, 1);
        assert.equal(
          after.line.received_quantity - before.line.received_quantity,
          1,
        );
        const sum = (rows, key) => rows.reduce((n, row) => n + row[key], 0);
        assert.equal(
          sum(after.stock, "on_hand") - sum(before.stock, "on_hand"),
          1,
        );
        assert.equal(
          sum(after.stock, "on_order") - sum(before.stock, "on_order"),
          -1,
        );
      },
    );
    await check(
      "parallel HTTP PM generation claims one window and creates one work order",
      async () => {
        const plan = db
          .prepare(
            "SELECT id FROM maintenance_plans WHERE site_id='site-levante' AND trigger_mode='CALENDAR' AND status='ACTIVE' LIMIT 1",
          )
          .get();
        assert(plan);
        const due = new Date(Date.now() - 86400000).toISOString();
        clone("maintenance_plans", plan.id, {
          id: "audit-http-plan",
          code: "AUDIT-HTTP-PM",
          version: 1,
          last_generated_at: null,
          last_executed_at: null,
          calendar_next_at: due,
          next_due_at: due,
        });
        const tasks = db
          .prepare(
            "SELECT * FROM maintenance_plan_tasks WHERE maintenance_plan_id=?",
          )
          .all(plan.id);
        for (const [i, task] of tasks.entries())
          clone("maintenance_plan_tasks", task.id, {
            id: `audit-http-plan-task-${i}`,
            maintenance_plan_id: "audit-http-plan",
          });
        const path = "/api/maintenance-plans/AUDIT-HTTP-PM/actions";
        const responses = await Promise.all([
          post(path, manager, { action: "GENERATE" }),
          post(path, manager, { action: "GENERATE" }),
        ]);
        assert(responses.some((r) => r.ok));
        assert(responses.every((r) => r.ok || r.status === 409));
        assert.equal(
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM work_orders WHERE maintenance_plan_id='audit-http-plan'",
            )
            .get().n,
          1,
        );
      },
    );
    await check(
      "parallel HTTP RCA actions cannot leave a duplicate generated WO",
      async () => {
        const rca = db
          .prepare(
            "SELECT id FROM root_cause_analyses WHERE site_id='site-levante' LIMIT 1",
          )
          .get();
        assert(rca);
        clone("root_cause_analyses", rca.id, {
          id: "audit-http-rca",
          number: "AUDIT-HTTP-RCA",
          status: "INVESTIGATING",
          version: 1,
          root_cause: "Fixture de investigación independiente",
        });
        const payload = {
          action: "CREATE_ACTION",
          title: "Inspección independiente",
          description: "Verificar la transmisión y registrar resultados",
          actionType: "CREATE_WORK_ORDER",
          ownerId: "user-manager",
          version: 1,
        };
        const responses = await Promise.all([
          post("/api/reliability/rca/AUDIT-HTTP-RCA/actions", manager, payload),
          post("/api/reliability/rca/AUDIT-HTTP-RCA/actions", manager, payload),
        ]);
        assert.equal(responses.filter((r) => r.ok).length, 1);
        assert(responses.every((r) => r.ok || r.status === 409));
        const actions = db
          .prepare(
            "SELECT linked_work_order_id FROM rca_actions WHERE root_cause_analysis_id='audit-http-rca'",
          )
          .all();
        assert.equal(actions.length, 1);
        assert(
          db
            .prepare("SELECT id FROM work_orders WHERE id=?")
            .get(actions[0].linked_work_order_id),
        );
      },
    );
    await check(
      "parallel due-session rotation creates one successor and logout revokes the whole family",
      async () => {
        const oldCookie = await login("planner@mazmi.demo");
        const tokenHash = createHash("sha256")
          .update(oldCookie.slice(oldCookie.indexOf("=") + 1))
          .digest("hex");
        const original = db
          .prepare("SELECT id FROM sessions WHERE token_hash=?")
          .get(tokenHash);
        assert(original);
        db.prepare("UPDATE sessions SET rotated_at=? WHERE id=?").run(
          new Date(Date.now() - 86400000).toISOString(),
          original.id,
        );
        const responses = await Promise.all([
          post("/api/incidents", oldCookie, {}),
          post("/api/incidents", oldCookie, {}),
        ]);
        assert.deepEqual(
          responses.map((response) => response.status),
          [400, 400],
        );
        for (const response of responses)
          assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
        const nextCookies = responses
          .map((response) => response.headers.get("set-cookie")?.split(";")[0])
          .filter(Boolean);
        assert.equal(nextCookies.length, 1);
        const family = db
          .prepare(
            "SELECT id, expires_at FROM sessions WHERE session_family_id=?",
          )
          .all(original.id);
        assert.equal(family.length, 2);
        assert(
          Date.parse(family.find((row) => row.id === original.id).expires_at) <=
            Date.now() + 31000,
        );
        // Advance only the predecessor's stored deadline, not the process clock.
        db.prepare("UPDATE sessions SET expires_at=? WHERE id=?").run(
          new Date(Date.now() - 1000).toISOString(),
          original.id,
        );
        assert.equal(
          (
            await fetch(base + "/api/search?q=LM-02", {
              headers: { cookie: oldCookie },
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await fetch(base + "/api/search?q=LM-02", {
              headers: { cookie: nextCookies[0] },
            })
          ).status,
          200,
        );
        assert((await post("/api/auth/logout", nextCookies[0], {})).ok);
        assert.equal(
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM sessions WHERE session_family_id=? AND revoked_at IS NULL",
            )
            .get(original.id).n,
          0,
        );
        assert.equal(
          (
            await fetch(base + "/api/search?q=LM-02", {
              headers: { cookie: nextCookies[0] },
            })
          ).status,
          401,
        );
      },
    );
    await check(
      "expired idle and absolute sessions are rejected by the compiled API",
      async () => {
        for (const column of ["idle_expires_at", "absolute_expires_at"]) {
          const loginResponse = await retryProxyTransport(
            `expired session login ${column}`,
            () =>
              post("/api/auth/login", "", {
                email: "planner@mazmi.demo",
                password: "Mazmi2026!",
              }),
          );
          assert.equal(loginResponse.status, 200, column);
          const expiredCookie = loginResponse.headers
            .get("set-cookie")
            ?.split(";")[0];
          assert(expiredCookie);
          const tokenHash = createHash("sha256")
            .update(expiredCookie.slice(expiredCookie.indexOf("=") + 1))
            .digest("hex");
          db.prepare(`UPDATE sessions SET ${column}=? WHERE token_hash=?`).run(
            new Date(Date.now() - 1000).toISOString(),
            tokenHash,
          );
          assert.equal(
            (
              await retryProxyTransport(
                `expired session search ${column}`,
                () =>
                  fetch(base + "/api/search?q=LM-02", {
                    headers: { cookie: expiredCookie },
                  }),
              )
            ).status,
            401,
            column,
          );
          assert.equal(
            (
              await retryProxyTransport(
                `expired session mutation ${column}`,
                () => post("/api/incidents", expiredCookie, {}),
              )
            ).status,
            401,
            column,
          );
        }
      },
    );
    await check("logout revokes cookie durably", async () => {
      assert((await post("/api/auth/logout", tech, {})).ok);
      assert.equal(
        (await fetch(base + evidenceUrl, { headers: { cookie: tech } })).status,
        401,
      );
    });
    await check(
      "compiled protected pages contain real content, not streamed render failures",
      async () => {
        for (const path of [
          "/overview",
          "/planner",
          "/reliability",
          "/procurement",
          "/reports",
          "/audit",
          "/governance",
        ]) {
          const result = await page(path, manager);
          assert.equal(result.status, 200, path);
          assert(/<h1(?:\s[^>]*)?>/.test(result.body), path);
          assert(
            !/:E\{"digest":/.test(result.body.replaceAll('\\"', '"')),
            path,
          );
        }
      },
    );
    await check("final database invariants and foreign keys", async () => {
      const health = await (await fetch(base + "/api/health")).json();
      for (const [name, value] of Object.entries(health))
        if (name.endsWith("Violations")) assert.equal(value, 0, name);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    });
    console.log(
      JSON.stringify({ passed, failed: failures.length, failures, state }),
    );
    assert.equal(failures.length, 0, "Independent HTTP gate failed");
  }
} finally {
  db?.close();
  worker.kill("SIGTERM");
  if (worker.exitCode === null && worker.signalCode === null)
    await Promise.race([
      new Promise((resolve) => worker.once("exit", resolve)),
      delay(3000),
    ]);
}
