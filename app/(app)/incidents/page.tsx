import {
  AlertTriangle,
  Inbox,
  Search,
  Siren,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/domain/governance";
import { IncidentCreateDialog } from "@/components/incidents/incident-create-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FacetedFilterForm } from "@/components/ui/faceted-filter-form";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatDateTime,
  incidentImpactLabels,
  incidentOriginLabels,
  statusLabels,
} from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import {
  getIncidentOptions,
  type IncidentFilters,
  listIncidents,
} from "@/lib/server/repositories/incidents";
import { tenantScope } from "@/lib/server/repositories/shared";

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<IncidentFilters>;
}) {
  const filters = await searchParams;
  const session = await requireDemoSession();
  if (!hasPermission(session.permissionCodes, "incident.report"))
    redirect("/overview");
  const scope = tenantScope(session);
  const [data, options] = await Promise.all([
    listIncidents(scope, filters),
    getIncidentOptions(scope),
  ]);
  const view = typeof filters.view === "string" ? filters.view : "triage";
  const selectedStatus =
    typeof filters.status === "string" ? filters.status : "";
  const selectedSeverity =
    typeof filters.severity === "string" ? filters.severity : "";
  const severityLabels: Record<string, string> = {
    CRITICAL: "Crítica",
    HIGH: "Alta",
    MEDIUM: "Media",
    LOW: "Baja",
  };
  const availableStatuses = new Set(
    data.facets.statuses.map((item) => item.value),
  );
  const availableSeverities = new Set(
    data.facets.severities.map((item) => item.value),
  );
  const activeFilters = [
    data.query ? { key: "q", label: `Búsqueda: ${data.query}` } : null,
    selectedStatus
      ? {
          key: "status",
          label: `Estado: ${statusLabels[selectedStatus] ?? selectedStatus}`,
        }
      : null,
    selectedSeverity
      ? {
          key: "severity",
          label: `Severidad: ${severityLabels[selectedSeverity] ?? selectedSeverity}`,
        }
      : null,
  ].filter((item): item is { key: string; label: string } => item !== null);
  const views = [
    {
      key: "triage",
      label: "Bandeja de triage",
      count: data.counts.new + data.counts.triage + data.counts.accepted,
    },
    { key: "new", label: "Nuevas", count: data.counts.new },
    {
      key: "converted",
      label: "Convertidas",
      count: Math.max(
        0,
        data.counts.all -
          data.counts.new -
          data.counts.triage -
          data.counts.accepted,
      ),
    },
    { key: "all", label: "Todas", count: data.counts.all },
  ];

  return (
    <div className="page-stack incidents-page">
      <PageHeader
        actions={
          <IncidentCreateDialog
            assets={options.assets}
            locations={options.locations}
          />
        }
        description="Registra problemas en pocos pasos y conviértelos en trabajo trazable cuando corresponde."
        eyebrow={`${session.siteCode} · Operaciones de mantenimiento`}
        title="Solicitudes e incidencias"
      />

      <nav
        aria-label="Vistas de incidencias"
        className="work-view-tabs incident-view-tabs"
      >
        {views.map((item) => (
          <Link
            className={view === item.key ? "active" : ""}
            href={{ pathname: "/incidents", query: { view: item.key } }}
            key={item.key}
          >
            {item.key === "triage" ? <Siren size={15} /> : <Inbox size={15} />}
            <span>{item.label}</span>
            <strong>{item.count}</strong>
          </Link>
        ))}
      </nav>

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
              placeholder="Incidencia, activo o ubicación"
            />
          </label>
          <select
            aria-label="Filtrar por estado"
            defaultValue={selectedStatus}
            name="status"
          >
            <option value="">Todos los estados</option>
            {selectedStatus && !availableStatuses.has(selectedStatus) ? (
              <option disabled value={selectedStatus}>
                {statusLabels[selectedStatus] ?? selectedStatus} · sin
                coincidencias
              </option>
            ) : null}
            {["NEW", "IN_TRIAGE", "ACCEPTED", "REJECTED", "CONVERTED", "CLOSED"]
              .filter((status) => availableStatuses.has(status))
              .map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
          </select>
          <select
            aria-label="Filtrar por severidad"
            defaultValue={selectedSeverity}
            name="severity"
          >
            <option value="">Toda severidad</option>
            {selectedSeverity && !availableSeverities.has(selectedSeverity) ? (
              <option disabled value={selectedSeverity}>
                {severityLabels[selectedSeverity] ?? selectedSeverity} · sin
                coincidencias
              </option>
            ) : null}
            {Object.entries(severityLabels)
              .filter(([value]) => availableSeverities.has(value))
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
          <input name="view" type="hidden" value={view} />
          <button className="filter-submit" type="submit">
            <SlidersHorizontal size={15} /> Aplicar
          </button>
        </FacetedFilterForm>
      </section>

      <section className="data-panel table-panel">
        {data.items.length ? (
          <div className="table-scroll">
            <table className="data-table incident-table">
              <thead>
                <tr>
                  <th>Incidencia</th>
                  <th>Contexto industrial</th>
                  <th>Severidad</th>
                  <th>Impacto</th>
                  <th>Estado</th>
                  <th>Reportada</th>
                  <th>Trazabilidad</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((incident) => (
                  <tr
                    className={`incident-row severity-${incident.severity.toLowerCase()}`}
                    key={incident.id}
                  >
                    <td data-label="Incidencia">
                      <Link
                        className="work-order-identity"
                        href={`/incidents/${encodeURIComponent(incident.number)}`}
                      >
                        <small>
                          {incident.number} ·{" "}
                          {incidentOriginLabels[incident.origin]}
                        </small>
                        <strong>{incident.title}</strong>
                      </Link>
                    </td>
                    <td data-label="Contexto">
                      <span className="stacked-cell">
                        <strong>
                          {incident.assetCode
                            ? `${incident.assetCode} · ${incident.assetName}`
                            : incident.locationName}
                        </strong>
                        <small>{incident.locationCode}</small>
                      </span>
                    </td>
                    <td data-label="Severidad">
                      <span
                        className={`incident-severity ${incident.severity.toLowerCase()}`}
                      >
                        <AlertTriangle size={12} />
                        {incident.severity === "CRITICAL"
                          ? "Crítica"
                          : incident.severity === "HIGH"
                            ? "Alta"
                            : incident.severity === "MEDIUM"
                              ? "Media"
                              : "Baja"}
                      </span>
                    </td>
                    <td data-label="Impacto">
                      {incidentImpactLabels[incident.initialImpact] ??
                        incident.initialImpact}
                    </td>
                    <td data-label="Estado">
                      <StatusBadge value={incident.status} />
                    </td>
                    <td data-label="Reportada">
                      <span className="stacked-cell">
                        <strong>{formatDateTime(incident.reportedAt)}</strong>
                        <small>{incident.reporterName}</small>
                      </span>
                    </td>
                    <td data-label="Trazabilidad">
                      {incident.workOrderNumber ? (
                        <Link
                          className="mono text-action"
                          href={`/work-orders/${incident.workOrderNumber}`}
                        >
                          {incident.workOrderNumber}
                        </Link>
                      ) : (
                        <span className="muted-value">Pendiente</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            action={
              <IncidentCreateDialog
                assets={options.assets}
                locations={options.locations}
              />
            }
            description="No hay incidencias que coincidan con esta vista."
            title="Bandeja al día"
          />
        )}
        <Pagination
          basePath="/incidents"
          page={data.page}
          searchParams={filters}
          totalPages={data.totalPages}
        />
      </section>
    </div>
  );
}
