import {
  AlertCircle,
  CalendarDays,
  ClipboardList,
  Clock3,
  Search,
  SlidersHorizontal,
  TimerReset,
} from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  dueLabel,
  formatDateTime,
  formatDuration,
  priorityLabels,
  statusLabels,
  typeLabels,
} from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import {
  type WorkOrderFilters,
  listWorkOrders,
} from "@/lib/server/repositories/work-orders";
import { tenantScope } from "@/lib/server/repositories/shared";

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<WorkOrderFilters>;
}) {
  const filters = await searchParams;
  const session = await requireDemoSession();
  const data = await listWorkOrders(tenantScope(session), filters);
  const view = typeof filters.view === "string" ? filters.view : "attention";
  const viewLinks = [
    {
      key: "attention",
      label: "Requieren atención",
      count: data.counts.attention,
      icon: AlertCircle,
    },
    {
      key: "today",
      label: "Hoy",
      count: data.counts.today,
      icon: CalendarDays,
    },
    {
      key: "backlog",
      label: "Backlog",
      count: data.counts.backlog,
      icon: TimerReset,
    },
    { key: "all", label: "Todas", count: data.counts.all, icon: ClipboardList },
  ];

  return (
    <div className="page-stack work-orders-page">
      <PageHeader
        description="Prioriza, planifica y sigue cada intervención con contexto industrial."
        eyebrow={`${session.siteCode} · Workbench`}
        title="Órdenes de trabajo"
        actions={
          <div className="entity-total">
            <Clock3 size={15} />
            <span>
              <strong>{data.counts.totalOpen}</strong> abiertas en planta
            </span>
          </div>
        }
      />

      <nav className="work-view-tabs" aria-label="Vistas de órdenes">
        {viewLinks.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              className={view === item.key ? "active" : ""}
              href={{ pathname: "/work-orders", query: { view: item.key } }}
              key={item.key}
            >
              <Icon size={15} />
              <span>{item.label}</span>
              <strong>{item.count}</strong>
            </Link>
          );
        })}
      </nav>

      <section className="toolbar-panel">
        <form className="filter-form work-filter-form" method="get">
          <label className="search-field">
            <Search size={16} />
            <input
              defaultValue={data.query}
              name="q"
              placeholder="Número, título, activo o ubicación"
            />
          </label>
          <select
            aria-label="Filtrar por estado"
            defaultValue={
              typeof filters.status === "string" ? filters.status : ""
            }
            name="status"
          >
            <option value="">Todos los estados</option>
            {[
              "REQUESTED",
              "TRIAGE",
              "APPROVED",
              "PLANNED",
              "SCHEDULED",
              "ASSIGNED",
              "IN_PROGRESS",
              "PAUSED",
              "WAITING_PART",
              "WAITING_VENDOR",
              "COMPLETED",
              "CLOSED",
              "CANCELLED",
            ].map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por prioridad"
            defaultValue={
              typeof filters.priority === "string" ? filters.priority : ""
            }
            name="priority"
          >
            <option value="">Toda prioridad</option>
            {Object.entries(priorityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por tipo"
            defaultValue={typeof filters.type === "string" ? filters.type : ""}
            name="type"
          >
            <option value="">Todos los tipos</option>
            {Object.entries(typeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input name="view" type="hidden" value={view} />
          <button className="filter-submit" type="submit">
            <SlidersHorizontal size={15} /> Aplicar
          </button>
        </form>
      </section>

      <section className="data-panel table-panel">
        {data.items.length ? (
          <div className="table-scroll">
            <table className="data-table work-order-table">
              <thead>
                <tr>
                  <th>Orden / intervención</th>
                  <th>Activo y ubicación</th>
                  <th>Prioridad</th>
                  <th>Estado</th>
                  <th>Responsable</th>
                  <th>Planificada</th>
                  <th>Compromiso</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((order) => {
                  const due = dueLabel(order.dueAt);
                  return (
                    <tr
                      className={[
                        "work-order-row",
                        `priority-${order.priority.toLowerCase()}`,
                        due.overdue ? "is-overdue" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={order.id}
                    >
                      <td data-label="Orden">
                        <Link
                          className="work-order-identity"
                          href={`/work-orders/${encodeURIComponent(order.number)}`}
                        >
                          <small>
                            {order.number} · {typeLabels[order.type]}
                          </small>
                          <strong>{order.title}</strong>
                        </Link>
                      </td>
                      <td data-label="Activo">
                        <Link
                          className="stacked-cell entity-link"
                          href={`/assets/${encodeURIComponent(order.assetCode)}`}
                        >
                          <strong>
                            {order.assetCode} · {order.assetName}
                          </strong>
                          <small>{order.locationName}</small>
                        </Link>
                      </td>
                      <td data-label="Prioridad">
                        <StatusBadge kind="priority" value={order.priority} />
                      </td>
                      <td data-label="Estado">
                        <StatusBadge value={order.status} />
                      </td>
                      <td data-label="Responsable">
                        <span className="assignee-cell">
                          <i>{order.assigneeInitials ?? "—"}</i>
                          <span>{order.assigneeName ?? "Sin asignar"}</span>
                        </span>
                      </td>
                      <td data-label="Planificada">
                        <span className="stacked-cell">
                          <strong>{formatDateTime(order.plannedStart)}</strong>
                          <small>
                            {formatDuration(order.estimatedMinutes)}
                          </small>
                        </span>
                      </td>
                      <td data-label="Compromiso">
                        <span
                          className={
                            due.overdue ? "due-cell overdue" : "due-cell"
                          }
                        >
                          <strong>{due.text}</strong>
                          <small>{formatDateTime(order.dueAt)}</small>
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
              <Link className="secondary-button" href="/work-orders?view=all">
                Ver todas las órdenes
              </Link>
            }
            description="No hay órdenes que coincidan con esta vista y los filtros actuales."
            title="Sin trabajo en esta vista"
          />
        )}
        <Pagination
          basePath="/work-orders"
          page={data.page}
          searchParams={filters}
          totalPages={data.totalPages}
        />
      </section>
    </div>
  );
}
