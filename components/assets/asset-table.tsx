"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, useMemo, useState } from "react";
import { HealthIndicator } from "@/components/ui/health-indicator";
import { StatusBadge } from "@/components/ui/status-badge";
import { useHydrated } from "@/lib/client/use-hydrated";
import { formatDate } from "@/lib/presentation";
import type { AssetListItem } from "@/lib/server/repositories/assets";

type VisibleAsset = AssetListItem & { depth: number };

function healthTone(score: number) {
  return score < 65 ? "critical" : score < 80 ? "warning" : "good";
}

export function AssetTable({
  items,
  hierarchy,
  autoExpand,
}: {
  items: AssetListItem[];
  hierarchy: boolean;
  autoExpand: boolean;
}) {
  const childrenByParent = useMemo(() => {
    const result = new Map<string, AssetListItem[]>();
    for (const item of items) {
      if (!item.parentId) continue;
      const children = result.get(item.parentId) ?? [];
      children.push(item);
      result.set(item.parentId, children);
    }
    for (const children of result.values())
      children.sort((left, right) => left.code.localeCompare(right.code));
    return result;
  }, [items]);
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set(
        autoExpand
          ? items
              .filter((item) => childrenByParent.has(item.id))
              .map((item) => item.id)
          : [],
      ),
  );
  const hydrated = useHydrated();
  const visible = useMemo(() => {
    if (!hierarchy) return items.map((item) => ({ ...item, depth: 0 }));
    const byId = new Map(items.map((item) => [item.id, item]));
    const roots = items
      .filter((item) => !item.parentId || !byId.has(item.parentId))
      .sort((left, right) => left.code.localeCompare(right.code));
    const rows: VisibleAsset[] = [];
    const visited = new Set<string>();
    const append = (item: AssetListItem, depth: number) => {
      if (visited.has(item.id)) return;
      visited.add(item.id);
      rows.push({ ...item, depth });
      if (!expanded.has(item.id)) return;
      for (const child of childrenByParent.get(item.id) ?? [])
        append(child, depth + 1);
    };
    for (const root of roots) append(root, 0);
    return rows;
  }, [childrenByParent, expanded, hierarchy, items]);

  return (
    <div className="table-scroll" data-hydrated={hydrated || undefined}>
      <table className="data-table asset-table">
        <thead>
          <tr>
            <th>Activo</th>
            <th>Contexto industrial</th>
            <th>Clase</th>
            <th>Estado</th>
            <th>Criticidad</th>
            <th>Salud</th>
            <th>OT</th>
            <th>Último mant.</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((asset) => {
            const tone = healthTone(Number(asset.healthScore));
            const children = childrenByParent.get(asset.id) ?? [];
            const open = expanded.has(asset.id);
            return (
              <tr
                className={[
                  hierarchy && asset.depth ? "child-row" : "",
                  asset.isContext ? "hierarchy-context-row" : "",
                  `health-${tone}`,
                  `criticality-${asset.criticality.toLowerCase()}`,
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={asset.id}
              >
                <td data-label="Activo">
                  <div
                    className="asset-hierarchy-cell"
                    style={{ "--asset-depth": asset.depth } as CSSProperties}
                  >
                    {hierarchy ? (
                      children.length ? (
                        <button
                          aria-expanded={open}
                          aria-label={`${open ? "Contraer" : "Expandir"} ${asset.code} · ${asset.name}`}
                          className="asset-expand-button"
                          disabled={!hydrated}
                          onClick={() =>
                            setExpanded((current) => {
                              const next = new Set(current);
                              if (next.has(asset.id)) next.delete(asset.id);
                              else next.add(asset.id);
                              return next;
                            })
                          }
                          type="button"
                        >
                          {open ? (
                            <ChevronDown size={15} />
                          ) : (
                            <ChevronRight size={15} />
                          )}
                        </button>
                      ) : (
                        <span
                          className="asset-expand-spacer"
                          aria-hidden="true"
                        />
                      )
                    ) : null}
                    <Link
                      className="entity-cell"
                      href={`/assets/${encodeURIComponent(asset.code)}`}
                    >
                      <span className="asset-mini-token">
                        {asset.code.split("-")[0]}
                      </span>
                      <span>
                        <small>{asset.code}</small>
                        <strong>{asset.name}</strong>
                        {asset.parentCode ? (
                          <em>Componente de {asset.parentCode}</em>
                        ) : asset.isContext ? (
                          <em>Contexto de la coincidencia</em>
                        ) : null}
                      </span>
                    </Link>
                  </div>
                </td>
                <td data-label="Contexto">
                  <span className="stacked-cell">
                    <strong>{asset.locationName}</strong>
                    <small>{asset.locationCode}</small>
                  </span>
                </td>
                <td data-label="Clase">{asset.className}</td>
                <td data-label="Estado">
                  <StatusBadge value={asset.status} />
                </td>
                <td data-label="Criticidad">
                  <StatusBadge kind="criticality" value={asset.criticality} />
                </td>
                <td data-label="Salud">
                  <HealthIndicator compact score={Number(asset.healthScore)} />
                </td>
                <td data-label="OT">
                  <span
                    className={
                      Number(asset.openOrders)
                        ? "numeric-chip active"
                        : "numeric-chip"
                    }
                  >
                    {asset.openOrders}
                  </span>
                </td>
                <td data-label="Último mantenimiento">
                  <span className="date-cell">
                    {formatDate(asset.lastMaintenanceAt)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
