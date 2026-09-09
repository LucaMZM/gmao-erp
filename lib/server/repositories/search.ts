import type { TenantScope } from "./shared";
import { normalizeQuery, queryAll } from "./shared";

export type GlobalSearchResult = {
  id: string;
  kind: "ASSET" | "INCIDENT" | "WORK_ORDER" | "PART";
  code: string;
  title: string;
  meta: string;
  href: string;
};

export async function globalSearch(
  scope: TenantScope,
  rawQuery: string,
): Promise<GlobalSearchResult[]> {
  const query = normalizeQuery(rawQuery, 60);
  if (query.length < 2) return [];
  const like = `%${query}%`;
  const [assets, incidents, orders, parts] = await Promise.all([
    queryAll<{ id: string; code: string; title: string; meta: string }>(
      `
      SELECT asset.id, asset.code, asset.name AS title, location.name AS meta
      FROM assets asset
      INNER JOIN functional_locations location ON location.id = asset.functional_location_id
      WHERE asset.site_id = ? AND asset.status != 'RETIRED'
        AND (asset.code LIKE ? OR asset.name LIKE ? OR asset.manufacturer LIKE ?)
      ORDER BY asset.code
      LIMIT 5
    `,
      [scope.siteId, like, like, like],
    ),
    queryAll<{ id: string; code: string; title: string; meta: string }>(
      `
      SELECT incident.id, incident.number AS code, incident.title,
        location.name || ' · ' || incident.status AS meta
      FROM incidents incident
      INNER JOIN functional_locations location ON location.id = incident.functional_location_id
      WHERE incident.organization_id = ? AND incident.site_id = ?
        AND (incident.number LIKE ? OR incident.title LIKE ? OR location.name LIKE ?)
      ORDER BY incident.reported_at DESC
      LIMIT 5
    `,
      [scope.organizationId, scope.siteId, like, like, like],
    ),
    queryAll<{ id: string; code: string; title: string; meta: string }>(
      `
      SELECT wo.id, wo.number AS code, wo.title, asset.code || ' · ' || wo.status AS meta
      FROM work_orders wo
      INNER JOIN assets asset ON asset.id = wo.asset_id
      WHERE wo.site_id = ? AND (wo.number LIKE ? OR wo.title LIKE ? OR asset.code LIKE ?)
      ORDER BY wo.requested_at DESC
      LIMIT 5
    `,
      [scope.siteId, like, like, like],
    ),
    queryAll<{ id: string; code: string; title: string; meta: string }>(
      `
      SELECT part.id, part.sku AS code, part.name AS title,
        COALESCE(part.manufacturer, 'Sin fabricante') AS meta
      FROM parts part
      INNER JOIN stock_levels stock ON stock.part_id = part.id AND stock.site_id = ?
      WHERE part.organization_id = ? AND (part.sku LIKE ? OR part.name LIKE ? OR part.manufacturer LIKE ?)
      ORDER BY part.sku
      LIMIT 5
    `,
      [scope.siteId, scope.organizationId, like, like, like],
    ),
  ]);
  return [
    ...assets.map((item) => ({
      ...item,
      kind: "ASSET" as const,
      href: `/assets/${encodeURIComponent(item.code)}`,
    })),
    ...incidents.map((item) => ({
      ...item,
      kind: "INCIDENT" as const,
      href: `/incidents/${encodeURIComponent(item.code)}`,
    })),
    ...orders.map((item) => ({
      ...item,
      kind: "WORK_ORDER" as const,
      href: `/work-orders/${encodeURIComponent(item.code)}`,
    })),
    ...parts.map((item) => ({
      ...item,
      kind: "PART" as const,
      href: `/inventory?part=${encodeURIComponent(item.id)}`,
    })),
  ];
}
