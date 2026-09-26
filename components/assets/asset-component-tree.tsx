"use client";

import { Box, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, useMemo, useState } from "react";
import { HealthIndicator } from "@/components/ui/health-indicator";
import { useHydrated } from "@/lib/client/use-hydrated";
import type { AssetChild } from "@/lib/server/repositories/assets";

export function AssetComponentTree({
  parentId,
  items,
}: {
  parentId: string;
  items: AssetChild[];
}) {
  const childrenByParent = useMemo(() => {
    const result = new Map<string, AssetChild[]>();
    for (const item of items) {
      const children = result.get(item.parentId) ?? [];
      children.push(item);
      result.set(item.parentId, children);
    }
    for (const children of result.values())
      children.sort((left, right) => left.code.localeCompare(right.code));
    return result;
  }, [items]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const hydrated = useHydrated();
  const visible = useMemo(() => {
    const rows: Array<AssetChild & { depth: number }> = [];
    const visited = new Set<string>();
    const append = (item: AssetChild, depth: number) => {
      if (visited.has(item.id)) return;
      visited.add(item.id);
      rows.push({ ...item, depth });
      if (!expanded.has(item.id)) return;
      for (const child of childrenByParent.get(item.id) ?? [])
        append(child, depth + 1);
    };
    for (const child of childrenByParent.get(parentId) ?? []) append(child, 0);
    return rows;
  }, [childrenByParent, expanded, parentId]);

  return (
    <div className="component-tree" data-hydrated={hydrated || undefined}>
      {visible.map((child) => {
        const hasChildren = (childrenByParent.get(child.id) ?? []).length > 0;
        const open = expanded.has(child.id);
        return (
          <div
            className="component-tree-row"
            key={child.id}
            style={{ "--asset-depth": child.depth } as CSSProperties}
          >
            {hasChildren ? (
              <button
                aria-expanded={open}
                aria-label={`${open ? "Contraer" : "Expandir"} ${child.code} · ${child.name}`}
                className="asset-expand-button"
                disabled={!hydrated}
                onClick={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(child.id)) next.delete(child.id);
                    else next.add(child.id);
                    return next;
                  })
                }
                type="button"
              >
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
            ) : (
              <span className="asset-expand-spacer" aria-hidden="true" />
            )}
            <Link href={`/assets/${encodeURIComponent(child.code)}`}>
              <span className="component-icon">
                <Box size={17} />
              </span>
              <span>
                <small>
                  {child.code} · {child.className}
                </small>
                <strong>{child.name}</strong>
              </span>
              <HealthIndicator compact score={child.healthScore} />
            </Link>
          </div>
        );
      })}
    </div>
  );
}
