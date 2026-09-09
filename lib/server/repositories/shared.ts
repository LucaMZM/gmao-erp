import { getD1 } from "@/db";
import { ensureDatabase } from "../database";
import type { DemoUserSession } from "../auth";

export type SqlValue = string | number | null;
export type TenantScope = {
  organizationId: string;
  siteId: string;
  userId?: string;
  roleKey?: string;
  fullAreaAccess?: boolean;
  areaIds?: string[];
  fullWarehouseAccess?: boolean;
  warehouseIds?: string[];
};

export function tenantScope(session: DemoUserSession): TenantScope {
  return {
    organizationId: session.organizationId,
    siteId: session.siteId,
    userId: session.userId,
    roleKey: session.roleKey,
    fullAreaAccess: session.fullAreaAccess,
    areaIds: session.areaIds,
    fullWarehouseAccess: session.fullWarehouseAccess,
    warehouseIds: session.warehouseIds,
  };
}

export function warehouseScopePredicate(
  scope: TenantScope,
  warehouseExpression: string,
): { sql: string; params: SqlValue[] } {
  if (scope.fullWarehouseAccess !== false) return { sql: "1 = 1", params: [] };
  const ids = scope.warehouseIds ?? [];
  if (!ids.length) return { sql: "1 = 0", params: [] };
  return {
    sql: `${warehouseExpression} IN (${ids.map(() => "?").join(",")})`,
    params: ids,
  };
}

export function locationScopePredicate(
  scope: TenantScope,
  locationExpression: string,
): { sql: string; params: SqlValue[] } {
  if (scope.fullAreaAccess !== false) return { sql: "1 = 1", params: [] };
  const ids = scope.areaIds ?? [];
  if (!ids.length) return { sql: "1 = 0", params: [] };
  return {
    sql: `EXISTS (
      WITH RECURSIVE permitted_location(id, parent_id) AS (
        SELECT id, parent_id FROM functional_locations WHERE id = ${locationExpression}
        UNION ALL
        SELECT parent.id, parent.parent_id FROM functional_locations parent
        INNER JOIN permitted_location child ON child.parent_id = parent.id
      ) SELECT 1 FROM permitted_location WHERE id IN (${ids.map(() => "?").join(",")})
    )`,
    params: ids,
  };
}

export async function queryAll<T>(
  sql: string,
  params: SqlValue[] = [],
): Promise<T[]> {
  await ensureDatabase();
  const result = await getD1()
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return result.results ?? [];
}

export async function queryFirst<T>(
  sql: string,
  params: SqlValue[] = [],
): Promise<T | null> {
  await ensureDatabase();
  return (
    (await getD1()
      .prepare(sql)
      .bind(...params)
      .first<T>()) ?? null
  );
}

export function normalizePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(page) ? Math.max(1, Math.min(page, 10_000)) : 1;
}

export function normalizeQuery(
  value: string | string[] | undefined,
  max = 80,
): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim().slice(0, max);
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
