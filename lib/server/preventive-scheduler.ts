import { getD1 } from "@/db";
import type { DemoUserSession } from "./auth";
import { ensureDatabase } from "./database";
import { generatePreventiveWorkOrder } from "./operations/preventive";

export type PreventiveSchedulerResult = {
  id: string;
  status: "COMPLETE" | "PARTIAL" | "FAILED";
  scanned: number;
  created: number;
  alreadyGenerated: number;
  errors: Array<{ plan: string; code: string }>;
};

export async function latestPreventiveSchedulerRun(): Promise<{
  status: string;
  startedAt: string;
  finishedAt: string | null;
} | null> {
  await ensureDatabase();
  const row = await getD1()
    .prepare(
      "SELECT status,started_at AS startedAt,finished_at AS finishedAt FROM scheduler_runs WHERE job_key='PREVENTIVE' ORDER BY started_at DESC LIMIT 1",
    )
    .first<{ status: string; startedAt: string; finishedAt: string | null }>();
  if (!row) return null;
  return row.status === "RUNNING" &&
    Date.now() - new Date(row.startedAt).getTime() > 30 * 60_000
    ? { ...row, status: "INTERRUPTED" }
    : row;
}

/** Scheduled service operation; never exposed as a user-authenticated route.
 * Each plan's existing version CAS and unique maintenance-window index protect
 * against concurrent runs and retries. The owner is the FK audit actor; the
 * request ID identifies automation unambiguously.
 */
export async function runPreventiveScheduler(
  at = new Date().toISOString(),
): Promise<PreventiveSchedulerResult> {
  await ensureDatabase();
  const db = getD1();
  const id = `scheduler-${crypto.randomUUID()}`;
  await db
    .prepare(
      "INSERT INTO scheduler_runs (id,job_key,status,started_at) VALUES (?,'PREVENTIVE','RUNNING',?)",
    )
    .bind(id, at)
    .run();
  let scanned = 0;
  let created = 0;
  let alreadyGenerated = 0;
  const errors: PreventiveSchedulerResult["errors"] = [];
  let cursor = "";
  try {
    for (;;) {
      const due = await db
        .prepare(
          `SELECT plan.id,plan.code,plan.organization_id AS organizationId,
          plan.site_id AS siteId,site.code AS siteCode,plan.owner_id AS ownerId
         FROM maintenance_plans plan
         INNER JOIN sites site ON site.id=plan.site_id
         INNER JOIN assets asset ON asset.id=plan.asset_id
         LEFT JOIN meters meter ON meter.id=plan.meter_id
         WHERE plan.id>? AND plan.status='ACTIVE' AND asset.status!='RETIRED'
           AND ((plan.trigger_mode!='METER' AND plan.calendar_next_at IS NOT NULL
                  AND julianday(plan.calendar_next_at)<=julianday(?)+plan.lead_days)
             OR (plan.trigger_mode!='CALENDAR' AND meter.last_value IS NOT NULL
                 AND meter.last_value>=plan.meter_threshold))
         ORDER BY plan.id LIMIT 50`,
        )
        .bind(cursor, at)
        .all<{
          id: string;
          code: string;
          organizationId: string;
          siteId: string;
          siteCode: string;
          ownerId: string;
        }>();
      const plans = due.results ?? [];
      if (!plans.length) break;
      for (const plan of plans) {
        cursor = plan.id;
        scanned++;
        const serviceSession = {
          organizationId: plan.organizationId,
          siteId: plan.siteId,
          siteCode: plan.siteCode,
          userId: plan.ownerId,
          roleKey: "MAINTENANCE_MANAGER",
          permissionCodes: ["preventive.manage"],
          fullAreaAccess: true,
          areaIds: [],
          fullWarehouseAccess: true,
          warehouseIds: [],
        } as unknown as DemoUserSession;
        try {
          const result = await generatePreventiveWorkOrder(
            {
              session: serviceSession,
              requestId: `scheduler:${id}:${plan.id}`,
              now: at,
            },
            plan.code,
          );
          if (result.created) created++;
          else alreadyGenerated++;
        } catch (error) {
          const code =
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "SCHEDULER_PLAN_ERROR";
          if (code === "CONCURRENT_MODIFICATION") {
            // A concurrent run may have advanced the plan after this scan.
            // A fresh domain call observes its new version and exact window.
            try {
              const retry = await generatePreventiveWorkOrder(
                {
                  session: serviceSession,
                  requestId: `scheduler:${id}:${plan.id}:retry`,
                  now: at,
                },
                plan.code,
              );
              if (retry.created) created++;
              else alreadyGenerated++;
              continue;
            } catch {
              /* preserve the original conflict in the run log */
            }
          }
          errors.push({ plan: plan.code, code });
        }
      }
      if (plans.length < 50) break;
    }
  } catch (error) {
    errors.push({
      plan: "*",
      code:
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "SCHEDULER_QUERY_ERROR",
    });
  }
  const status = errors.length
    ? created || alreadyGenerated
      ? "PARTIAL"
      : "FAILED"
    : "COMPLETE";
  await db
    .prepare(
      "UPDATE scheduler_runs SET status=?,finished_at=?,scanned=?,created=?,already_generated=?,errors_json=? WHERE id=?",
    )
    .bind(
      status,
      new Date().toISOString(),
      scanned,
      created,
      alreadyGenerated,
      JSON.stringify(errors),
      id,
    )
    .run();
  return { id, status, scanned, created, alreadyGenerated, errors };
}
