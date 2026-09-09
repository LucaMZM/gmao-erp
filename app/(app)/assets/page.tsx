import {
  Boxes,
  GitBranch,
  List,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { HealthIndicator } from "@/components/ui/health-indicator";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  criticalityLabels,
  formatDate,
  statusLabels,
} from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import {
  type AssetFilters,
  listAssets,
} from "@/lib/server/repositories/assets";
import { tenantScope } from "@/lib/server/repositories/shared";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<AssetFilters>;
}) {
  const filters = await searchParams;
  const session = await requireDemoSession();
  const data = await listAssets(tenantScope(session), filters);
  const view = typeof filters.view === "string" ? filters.view : "list";
  const items =
    view === "hierarchy"
      ? [...data.items].sort(
          (a, b) =>
            (a.parentCode ?? a.code).localeCompare(b.parentCode ?? b.code) ||
            Number(Boolean(a.parentCode)) - Number(Boolean(b.parentCode)) ||
            a.code.localeCompare(b.code),
        )
      : data.items;

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
        <form className="filter-form" method="get">
          <label className="search-field">
            <Search size={16} />
            <input
              defaultValue={data.query}
              name="q"
              placeholder="Código, activo, fabricante o modelo"
            />
          </label>
          <select
            aria-label="Filtrar por área"
            defaultValue={typeof filters.area === "string" ? filters.area : ""}
            name="area"
          >
            <option value="">Todas las áreas</option>
            {data.areas.map((area) => (
              <option key={area.code} value={area.code}>
                {area.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por estado"
            defaultValue={
              typeof filters.status === "string" ? filters.status : ""
            }
            name="status"
          >
            <option value="">Todos los estados</option>
            {["OPERATING", "DEGRADED", "DOWN", "MAINTENANCE", "STANDBY"].map(
              (status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ),
            )}
          </select>
          <select
            aria-label="Filtrar por criticidad"
            defaultValue={
              typeof filters.criticality === "string" ? filters.criticality : ""
            }
            name="criticality"
          >
            <option value="">Toda criticidad</option>
            {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((item) => (
              <option key={item} value={item}>
                {criticalityLabels[item]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por salud"
            defaultValue={
              typeof filters.health === "string" ? filters.health : ""
            }
            name="health"
          >
            <option value="">Cualquier salud</option>
            <option value="RISK">Riesgo · &lt;70</option>
            <option value="WATCH">Vigilar · 70–84</option>
            <option value="HEALTHY">Estable · ≥85</option>
          </select>
          <input name="view" type="hidden" value={view} />
          <button className="filter-submit" type="submit">
            <SlidersHorizontal size={15} /> Aplicar
          </button>
        </form>
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
            <GitBranch size={15} /> Jerarquía
          </Link>
        </div>
      </section>

      <section className="data-panel table-panel">
        {items.length ? (
          <div className="table-scroll">
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
                {items.map((asset) => {
                  const healthTone =
                    Number(asset.healthScore) < 65
                      ? "critical"
                      : Number(asset.healthScore) < 80
                        ? "warning"
                        : "good";
                  return (
                    <tr
                      className={[
                        view === "hierarchy" && asset.parentCode
                          ? "child-row"
                          : "",
                        `health-${healthTone}`,
                        `criticality-${asset.criticality.toLowerCase()}`,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={asset.id}
                    >
                      <td data-label="Activo">
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
                            ) : null}
                          </span>
                        </Link>
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
                        <StatusBadge
                          kind="criticality"
                          value={asset.criticality}
                        />
                      </td>
                      <td data-label="Salud">
                        <HealthIndicator
                          compact
                          score={Number(asset.healthScore)}
                        />
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
