import { Boxes, List, ListTree, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { AssetTable } from "@/components/assets/asset-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FacetedFilterForm } from "@/components/ui/faceted-filter-form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { criticalityLabels, statusLabels } from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import {
  type AssetFilters,
  listAssets,
} from "@/lib/server/repositories/assets";
import { tenantScope } from "@/lib/server/repositories/shared";

const assetStatuses = [
  "OPERATING",
  "DEGRADED",
  "DOWN",
  "MAINTENANCE",
  "STANDBY",
];
const assetCriticalities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<AssetFilters>;
}) {
  const filters = await searchParams;
  const session = await requireDemoSession();
  const data = await listAssets(tenantScope(session), filters);
  const view = typeof filters.view === "string" ? filters.view : "list";
  const area = typeof filters.area === "string" ? filters.area : "";
  const status = typeof filters.status === "string" ? filters.status : "";
  const criticality =
    typeof filters.criticality === "string" ? filters.criticality : "";
  const health = typeof filters.health === "string" ? filters.health : "";
  const areaLabels = new Map(
    data.facets.areas.map((item) => [item.value, item.label]),
  );
  const activeFilters = [
    data.query ? { key: "q", label: `Búsqueda: ${data.query}` } : null,
    area
      ? { key: "area", label: `Área: ${areaLabels.get(area) ?? area}` }
      : null,
    status
      ? { key: "status", label: `Estado: ${statusLabels[status] ?? status}` }
      : null,
    criticality
      ? {
          key: "criticality",
          label: `Criticidad: ${criticalityLabels[criticality] ?? criticality}`,
        }
      : null,
    health
      ? {
          key: "health",
          label: `Salud: ${health === "RISK" ? "Riesgo" : health === "WATCH" ? "Vigilar" : "Estable"}`,
        }
      : null,
  ].filter((item): item is { key: string; label: string } => item !== null);
  const availableStatuses = new Set(
    data.facets.statuses.map((item) => item.value),
  );
  const availableCriticalities = new Set(
    data.facets.criticalities.map((item) => item.value),
  );
  const availableHealth = new Set(data.facets.health.map((item) => item.value));

  return (
    <div className="page-stack assets-page">
      <PageHeader
        description="Jerarquía mantenible, condición y contexto funcional de cada equipo."
        eyebrow={`${session.siteCode} · Registro técnico`}
        title="Activos"
        actions={
          <div className="entity-total">
            <Boxes size={15} />
            <span>
              <strong>{data.total}</strong> activos visibles
            </span>
          </div>
        }
      />
      <section className="toolbar-panel">
        <FacetedFilterForm
          activeFilters={activeFilters}
          preserveOnClear={["view"]}
        >
          <label className="search-field">
            <Search size={16} />
            <input
              defaultValue={data.query}
              name="q"
              placeholder="Código, activo, fabricante o modelo"
            />
          </label>
          <select aria-label="Filtrar por área" defaultValue={area} name="area">
            <option value="">Todas las áreas</option>
            {area && !areaLabels.has(area) ? (
              <option disabled value={area}>
                {area} · sin coincidencias
              </option>
            ) : null}
            {data.facets.areas.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por estado"
            defaultValue={status}
            name="status"
          >
            <option value="">Todos los estados</option>
            {status && !availableStatuses.has(status) ? (
              <option disabled value={status}>
                {statusLabels[status] ?? status} · sin coincidencias
              </option>
            ) : null}
            {assetStatuses
              .filter((item) => availableStatuses.has(item))
              .map((item) => (
                <option key={item} value={item}>
                  {statusLabels[item]}
                </option>
              ))}
          </select>
          <select
            aria-label="Filtrar por criticidad"
            defaultValue={criticality}
            name="criticality"
          >
            <option value="">Toda criticidad</option>
            {criticality && !availableCriticalities.has(criticality) ? (
              <option disabled value={criticality}>
                {criticalityLabels[criticality] ?? criticality} · sin
                coincidencias
              </option>
            ) : null}
            {assetCriticalities
              .filter((item) => availableCriticalities.has(item))
              .map((item) => (
                <option key={item} value={item}>
                  {criticalityLabels[item]}
                </option>
              ))}
          </select>
          <select
            aria-label="Filtrar por salud"
            defaultValue={health}
            name="health"
          >
            <option value="">Cualquier salud</option>
            {health && !availableHealth.has(health) ? (
              <option disabled value={health}>
                Filtro actual · sin coincidencias
              </option>
            ) : null}
            {availableHealth.has("RISK") ? (
              <option value="RISK">Riesgo · &lt;70</option>
            ) : null}
            {availableHealth.has("WATCH") ? (
              <option value="WATCH">Vigilar · 70–84</option>
            ) : null}
            {availableHealth.has("HEALTHY") ? (
              <option value="HEALTHY">Estable · ≥85</option>
            ) : null}
          </select>
          <input name="view" type="hidden" value={view} />
          <button className="filter-submit" type="submit">
            <SlidersHorizontal size={15} /> Aplicar
          </button>
        </FacetedFilterForm>
        <div className="view-switch" aria-label="Vista de activos">
          <Link
            className={view !== "hierarchy" ? "active" : ""}
            href={{
              pathname: "/assets",
              query: { ...filters, view: "list", page: undefined },
            }}
          >
            <List size={15} /> Lista
          </Link>
          <Link
            className={view === "hierarchy" ? "active" : ""}
            href={{
              pathname: "/assets",
              query: { ...filters, view: "hierarchy", page: undefined },
            }}
          >
            <ListTree size={15} /> Jerarquía
          </Link>
        </div>
      </section>
      <section className="data-panel table-panel">
        {data.items.length ? (
          <AssetTable
            autoExpand={Boolean(
              data.query || area || status || criticality || health,
            )}
            hierarchy={view === "hierarchy"}
            items={data.items}
            key={`${view}:${data.query}:${area}:${status}:${criticality}:${health}:${data.page}`}
          />
        ) : (
          <EmptyState
            action={
              <Link className="secondary-button" href="/assets">
                Limpiar filtros
              </Link>
            }
            description="No hay activos que coincidan con la búsqueda y los filtros actuales."
            title="Sin resultados"
          />
        )}
        <Pagination
          basePath="/assets"
          page={data.page}
          searchParams={filters}
          totalPages={data.totalPages}
        />
      </section>
    </div>
  );
}
