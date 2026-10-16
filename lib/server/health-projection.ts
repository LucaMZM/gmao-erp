import { getD1 } from "@/db";
import { ensureDatabase } from "./database";
import { calculateCurrentAssetHealth } from "./repositories/reliability";
import type { TenantScope } from "./repositories/shared";

/** One materialized index for all health-based list filters and aggregates.
 * The underlying score is calculated only by Reliability's metric query and
 * domain function. Triggers enqueue changes; the versioned queue prevents a
 * concurrent mutation from being silently acknowledged with an older score.
 */
export async function syncHealthProjection(scope: TenantScope): Promise<void> {
  await ensureDatabase();
  const db = getD1();
  const asOf = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 86_400_000).toISOString();
  const calculationScope: TenantScope = {
    organizationId: scope.organizationId,
    siteId: scope.siteId,
    fullAreaAccess: true,
    areaIds: [],
    fullWarehouseAccess: true,
    warehouseIds: [],
  };

  // Every read is exact at a daily time boundary. Event-triggered changes are
  // immediate; daily refresh accounts for rolling windows and overdue dates.
  for (;;) {
    const pending = await db
      .prepare(
        `SELECT asset.id,dirty.version
         FROM assets asset LEFT JOIN health_dirty_assets dirty ON dirty.asset_id=asset.id
         WHERE asset.organization_id=? AND asset.site_id=? AND asset.status!='RETIRED'
           AND (dirty.asset_id IS NOT NULL OR asset.health_computed_at IS NULL OR asset.health_computed_at < ?)
         ORDER BY dirty.asset_id IS NULL,asset.id LIMIT 50`,
      )
      .bind(scope.organizationId, scope.siteId, staleBefore)
      .all<{ id: string; version: number | null }>();
    const rows = pending.results ?? [];
    if (!rows.length) break;
    const scoreById = new Map(
      (
        await calculateCurrentAssetHealth(
          calculationScope,
          rows.map((row) => row.id),
          asOf,
        )
      ).map((row) => [row.id, row.score]),
    );
    const statements = rows.flatMap((row) => {
      const score = scoreById.get(row.id);
      if (score === undefined)
        throw new Error(`HEALTH_PROJECTION_MISSING:${row.id}`);
      return [
        db
          .prepare(
            "UPDATE assets SET health_score=?,health_computed_at=? WHERE id=? AND site_id=?",
          )
          .bind(score, asOf, row.id, scope.siteId),
        ...(row.version === null
          ? []
          : [
              db
                .prepare(
                  "DELETE FROM health_dirty_assets WHERE asset_id=? AND version=?",
                )
                .bind(row.id, row.version),
            ]),
      ];
    });
    await db.batch(statements);
  }
}
