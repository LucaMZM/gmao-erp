import { tenantScope } from "@/lib/server/repositories/shared";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  Gauge,
  Search,
  ShieldCheck,
  TimerReset,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MaintenancePlanCreateDialog } from "@/components/preventive/maintenance-plan-create-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FacetedFilterForm } from "@/components/ui/faceted-filter-form";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { can } from "@/lib/domain/permissions";
import { hasPermission } from "@/lib/domain/governance";
import {
  calendarUnitLabels,
  formatDateTime,
  formatDuration,
  preventiveTriggerLabels,
  priorityLabels,
} from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import { listMaintenancePlans } from "@/lib/server/repositories/preventive";

function triggerDetail(item: {
  triggerMode: string;
  calendarInterval: number | null;
  calendarUnit: string | null;
  meterThreshold: number | null;
  meterUnit: string | null;
}): string {
  const calendar =
    item.calendarInterval && item.calendarUnit
      ? `cada ${item.calendarInterval} ${calendarUnitLabels[item.calendarUnit]}`
      : null;
  const meter =
    item.meterThreshold !== null
      ? `umbral ${new Intl.NumberFormat("es-ES").format(item.meterThreshold)} ${item.meterUnit ?? ""}`
      : null;
  return [calendar, meter].filter(Boolean).join(" · ");
}

export default async function MaintenancePlansPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; status?: string | string[] }>;
}) {
  const filters = await searchParams;
  const session = await requireDemoSession();
  if (!hasPermission(session.permissionCodes, "preventive.manage"))
    redirect("/overview");
  const data = await listMaintenancePlans(tenantScope(session), filters);
  const canCreate = can(session, "MAINTENANCE_PLAN_CREATE");
  const now = new Date().toISOString();
  const statusLabels: Record<string, string> = {
    all: "Todos los planes",
    due: "Requieren atención",
    upcoming: "Próximos 7 días",
    active: "Activos",
    inactive: "Inactivos",
  };
  const availableStatuses = new Set(
    data.statusFacets.map((item) => item.value),
  );
  const activeFilters = [
    data.query ? { key: "q", label: `Búsqueda: ${data.query}` } : null,
    data.status !== "all"
      ? {
          key: "status",
          label: `Estado: ${statusLabels[data.status] ?? data.status}`,
        }
      : null,
  ].filter((item): item is { key: string; label: string } => item !== null);

  return (
    <div className="page-stack preventive-page">
      <PageHeader
        actions={
          canCreate ? (
            <MaintenancePlanCreateDialog catalog={data.catalog} />
          ) : null
        }
        description="Estrategias calendarizadas y por contador que generan trabajo trazable sin duplicar ventanas."
        eyebrow={`${session.siteCode} · Preventivo`}
        title="Planes de mantenimiento"
      />

      <section
        className="preventive-kpi-strip"
        aria-label="Indicadores preventivos"
      >
        <article className="preventive-kpi primary">
          <span>
            <ShieldCheck size={17} /> Cumplimiento PM
          </span>
          <strong>{data.compliance.compliance.toFixed(1)}%</strong>
          <small>
            {data.compliance.onTime}/{data.compliance.scheduled} ejecutados a
            tiempo
          </small>
        </article>
        <article className="preventive-kpi attention">
          <span>
            <TimerReset size={17} /> Atención
          </span>
          <strong>{data.counts.due}</strong>
          <small>planes vencidos o por umbral</small>
        </article>
        <article className="preventive-kpi">
          <span>
            <CalendarClock size={17} /> Próximos 7 días
          </span>
          <strong>{data.counts.upcoming}</strong>
          <small>ventanas próximas</small>
        </article>
        <article className="preventive-kpi quiet">
          <span>
            <CheckCircle2 size={17} /> Estrategias activas
          </span>
          <strong>{data.counts.active}</strong>
          <small>{data.counts.inactive} pausadas</small>
        </article>
      </section>

      <section className="toolbar-panel preventive-toolbar">
        <FacetedFilterForm activeFilters={activeFilters}>
          <label className="search-field">
            <Search size={16} />
            <input
              defaultValue={data.query}
              name="q"
              placeholder="Plan, activo o descripción"
            />
          </label>
          <select
            aria-label="Estado del plan"
            defaultValue={data.status}
            name="status"
          >
            {!availableStatuses.has(data.status) ? (
              <option disabled value={data.status}>
                {statusLabels[data.status] ?? data.status} · sin coincidencias
              </option>
            ) : null}
            {Object.entries(statusLabels)
              .filter(([value]) => availableStatuses.has(value))
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
          <button className="filter-submit" type="submit">
            Aplicar
          </button>
        </FacetedFilterForm>
        <Link className="secondary-button" href="/planner">
          <CalendarClock size={15} /> Abrir Planner
        </Link>
      </section>

      <section className="data-panel table-panel preventive-table-panel">
        {data.items.length ? (
          <div className="table-scroll">
            <table className="data-table preventive-table">
              <thead>
                <tr>
                  <th>Plan / activo</th>
                  <th>Estrategia</th>
                  <th>Próxima ejecución</th>
                  <th>Trabajo</th>
                  <th>Responsable</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => {
                  const meterDue =
                    item.meterValue !== null &&
                    item.meterThreshold !== null &&
                    item.meterValue >= item.meterThreshold;
                  const due =
                    item.status === "ACTIVE" &&
                    (meterDue ||
                      (item.nextDueAt !== null && item.nextDueAt <= now));
                  return (
                    <tr
                      className={
                        due ? "preventive-row is-due" : "preventive-row"
                      }
                      key={item.id}
                    >
                      <td data-label="Plan">
                        <Link
                          className="preventive-identity"
                          href={`/maintenance-plans/${encodeURIComponent(item.code)}`}
                        >
                          <small>
                            {item.code} · {item.assetCode}
                          </small>
                          <strong>{item.title}</strong>
                          <span>
                            {item.assetName} · {item.locationName}
                          </span>
                        </Link>
                      </td>
                      <td data-label="Estrategia">
                        <span className="trigger-mark">
                          {item.triggerMode === "METER" ? (
                            <Gauge size={15} />
                          ) : (
                            <Activity size={15} />
                          )}
                          <strong>
                            {preventiveTriggerLabels[item.triggerMode]}
                          </strong>
                        </span>
                        <small className="table-subcopy">
                          {triggerDetail(item)}
                        </small>
                      </td>
                      <td data-label="Próxima">
                        <span
                          className={due ? "due-date critical" : "due-date"}
                        >
                          <strong>
                            {meterDue
                              ? "Umbral alcanzado"
                              : formatDateTime(item.nextDueAt)}
                          </strong>
                          <small>
                            {item.meterCode
                              ? `${item.meterValue ?? "—"} / ${item.meterThreshold ?? "—"} ${item.meterUnit}`
                              : due
                                ? "Generación pendiente"
                                : "Ventana calculada"}
                          </small>
                        </span>
                      </td>
                      <td data-label="Trabajo">
                        <span className="stacked-cell">
                          <strong>
                            {formatDuration(item.estimatedMinutes)}
                          </strong>
                          <small>
                            {priorityLabels[item.priority]} ·{" "}
                            {item.openGeneratedCount} OT abiertas
                          </small>
                        </span>
                      </td>
                      <td data-label="Responsable">
                        <strong>{item.ownerName}</strong>
                      </td>
                      <td data-label="Estado">
                        <StatusBadge value={item.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            description="Ajusta la búsqueda o crea una estrategia preventiva para este centro."
            title="No hay planes en esta vista"
          />
        )}
      </section>
    </div>
  );
}
