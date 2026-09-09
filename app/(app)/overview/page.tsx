import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CircleDot,
  Clock3,
  Gauge,
  ShieldCheck,
  TimerReset,
  Truck,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { HealthIndicator } from "@/components/ui/health-indicator";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime, formatDuration } from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import { getOverview } from "@/lib/server/repositories/overview";

export default async function OverviewPage() {
  const session = await requireDemoSession();
  const data = await getOverview({
    organizationId: session.organizationId,
    siteId: session.siteId,
  });
  const kpis = [
    {
      label: "Disponibilidad",
      value: `${data.kpis.availability.toFixed(1).replace(".", ",")}%`,
      context: "Ventana 30 días",
      icon: Gauge,
      tone: data.kpis.availability >= 95 ? "good" : "warning",
      importance: "primary",
    },
    {
      label: "Activos en riesgo",
      value: String(data.kpis.riskAssets),
      context: `${data.kpis.criticalAssets} activos críticos`,
      icon: Activity,
      tone: data.kpis.riskAssets ? "critical" : "good",
      importance: "urgent",
    },
    {
      label: "Órdenes abiertas",
      value: String(data.kpis.openOrders),
      context: `${data.kpis.overdueOrders} vencidas · ${data.kpis.openIncidents} incidencias`,
      icon: Wrench,
      tone:
        data.kpis.overdueOrders || data.kpis.criticalIncidents
          ? "warning"
          : "good",
      importance: "attention",
    },
    {
      label: "Cumplimiento PM",
      value: `${data.kpis.pmCompliance.toFixed(1).replace(".", ",")}%`,
      context: `${data.kpis.pmOnTime}/${data.kpis.pmScheduled} a tiempo · ${data.kpis.pmOverdue} fuera de plazo`,
      icon: ShieldCheck,
      tone: data.kpis.pmCompliance >= 95 ? "good" : "warning",
      importance: "support",
    },
    {
      label: "Backlog",
      value: `${data.kpis.backlogHours.toFixed(1).replace(".", ",")} h`,
      context: "Carga estimada abierta",
      icon: CalendarClock,
      tone: data.kpis.backlogHours > 60 ? "warning" : "good",
      importance: "support",
    },
    {
      label: "MTTR",
      value: formatDuration(data.kpis.mttrMinutes),
      context: "Correctivos · 90 días",
      icon: TimerReset,
      tone: data.kpis.mttrMinutes <= 150 ? "good" : "warning",
      importance: "support",
    },
  ];

  return (
    <div className="page-stack overview-page">
      <PageHeader
        description="Lectura operativa de mantenimiento, fiabilidad y capacidad de respuesta."
        eyebrow={`${session.siteCode} · Turno mañana`}
        title="Centro de control"
        actions={
          <span className="freshness">
            <CircleDot size={13} /> Datos actualizados{" "}
            {formatDateTime(data.generatedAt, "Europe/Madrid")}
          </span>
        }
      />

      <section className="kpi-strip" aria-label="Indicadores clave">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <article
              className={`metric-cell metric-${kpi.importance} tone-${kpi.tone}`}
              key={kpi.label}
            >
              <div className="metric-label">
                <span>{kpi.label}</span>
                <Icon className={`metric-icon ${kpi.tone}`} size={15} />
              </div>
              <strong>{kpi.value}</strong>
              <small className={kpi.tone === "critical" ? "text-critical" : ""}>
                {kpi.context}
              </small>
            </article>
          );
        })}
      </section>

      <section className="overview-grid">
        <article className="data-panel area-status-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Estado operativo</p>
              <h2>Salud por área</h2>
              <p>¿Dónde concentra la planta el riesgo ahora?</p>
            </div>
            <Link className="text-action" href="/assets">
              Explorar activos <ArrowRight size={14} />
            </Link>
          </div>
          <div className="area-status-list">
            <div className="area-list-header">
              <span>Área / sistema</span>
              <span>Disponibilidad</span>
              <span>Salud</span>
              <span>Incidencias</span>
            </div>
            {data.areas.map((area) => {
              const areaTone =
                area.averageHealth < 75
                  ? "critical"
                  : area.averageHealth < 85
                    ? "warning"
                    : "good";
              return (
                <div
                  className={`area-status-row tone-${areaTone}`}
                  key={area.code}
                >
                  <span className="area-identity">
                    <i className={areaTone} />
                    <span>
                      <strong>{area.name}</strong>
                      <small>
                        {area.assetCount}{" "}
                        {area.assetCount === 1 ? "activo" : "activos"} ·{" "}
                        {area.code}
                      </small>
                    </span>
                  </span>
                  <strong className="tabular">
                    {Number(area.availability).toFixed(1).replace(".", ",")}%
                  </strong>
                  <HealthIndicator compact score={Number(area.averageHealth)} />
                  <span
                    className={
                      Number(area.openOrders)
                        ? "issue-count active"
                        : "issue-count"
                    }
                  >
                    {area.openOrders} OT
                  </span>
                </div>
              );
            })}
          </div>
        </article>

        <aside className="data-panel attention-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Atención ahora</p>
              <h2>Activos en riesgo</h2>
            </div>
            <span className="panel-count">{data.risks.length}</span>
          </div>
          <div className="attention-list">
            {data.risks.length ? (
              data.risks.map((risk) => (
                <Link
                  className="attention-item"
                  href={`/assets/${encodeURIComponent(risk.code)}`}
                  key={risk.id}
                >
                  <span className="asset-token">{risk.code.split("-")[0]}</span>
                  <span className="attention-copy">
                    <strong>{risk.name}</strong>
                    <small>
                      {risk.code} · {risk.locationName}
                    </small>
                    <em>
                      <span>Health {risk.healthScore}</span>
                      <span>{risk.openOrders} OT abiertas</span>
                    </em>
                  </span>
                  <AlertTriangle
                    className={risk.healthScore < 65 ? "critical" : "warning"}
                    size={16}
                  />
                </Link>
              ))
            ) : (
              <EmptyState
                description="No se detectan activos fuera de umbral."
                title="Operación estable"
              />
            )}
          </div>
        </aside>
      </section>

      {data.reliabilitySignals.length ? (
        <section className="overview-reliability-strip">
          <header>
            <div>
              <p className="overline">Señales ejecutivas</p>
              <h2>Fiabilidad que requiere decisión</h2>
            </div>
            <Link className="text-action" href="/reliability">
              Abrir Reliability Center <ArrowRight size={14} />
            </Link>
          </header>
          <div>
            {data.reliabilitySignals.map((signal) => (
              <Link
                href={`/assets/${encodeURIComponent(signal.assetCode)}#reliability`}
                key={signal.assetId}
              >
                <span
                  className={`overview-signal-mark signal-${signal.kind.toLowerCase()}`}
                >
                  <Activity size={15} />
                </span>
                <span>
                  <small>
                    {signal.kind === "DETERIORATING"
                      ? "Deterioro"
                      : signal.kind === "REPEAT_FAILURE"
                        ? "Fallo repetitivo"
                        : "Downtime crítico"}
                  </small>
                  <strong>
                    {signal.assetCode} · {signal.assetName}
                  </strong>
                  <p>{signal.explanation}</p>
                </span>
                <ArrowRight size={14} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {data.supply.criticalStockouts ||
      data.supply.delayedOrders ||
      data.supply.waitingPartOrders ? (
        <section className="overview-supply-strip">
          <span className="overview-supply-icon">
            <Truck size={17} />
          </span>
          <span>
            <small>Supply operativo</small>
            <strong>
              {data.supply.criticalStockouts} stockouts críticos ·{" "}
              {data.supply.delayedOrders} pedidos retrasados ·{" "}
              {data.supply.waitingPartOrders} OT esperando material
            </strong>
          </span>
          <Link className="text-action" href="/procurement">
            Resolver en Procurement <ArrowRight size={14} />
          </Link>
        </section>
      ) : null}

      <section className="overview-lower-grid">
        <article className="data-panel priority-orders-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Trabajo prioritario</p>
              <h2>Órdenes que requieren seguimiento</h2>
            </div>
            <Link className="text-action" href="/work-orders">
              Abrir workbench <ArrowRight size={14} />
            </Link>
          </div>
          {data.priorityOrders.length ? (
            <div className="compact-order-list">
              {data.priorityOrders.map((order) => (
                <Link
                  className="compact-order-row"
                  href={`/work-orders/${encodeURIComponent(order.number)}`}
                  key={order.id}
                >
                  <StatusBadge kind="priority" value={order.priority} />
                  <span className="order-main">
                    <small>{order.number}</small>
                    <strong>{order.title}</strong>
                  </span>
                  <span className="order-asset">
                    <small>Activo</small>
                    <strong>{order.assetCode}</strong>
                  </span>
                  <StatusBadge value={order.status} />
                  <span className="order-owner">
                    <span>
                      {order.assigneeName
                        ?.split(" ")
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("") ?? "—"}
                    </span>
                    <small>{order.assigneeName ?? "Sin asignar"}</small>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              description="No hay órdenes urgentes en este centro."
              title="Sin trabajo prioritario"
            />
          )}
        </article>

        <article className="data-panel today-plan-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Planificación</p>
              <h2>Plan de hoy</h2>
            </div>
            <Clock3 size={17} />
          </div>
          {data.todayPlan.length ? (
            <div className="timeline-plan">
              {data.todayPlan.map((item) => (
                <Link
                  href={`/work-orders/${encodeURIComponent(item.number)}`}
                  key={item.id}
                >
                  <time>
                    {new Intl.DateTimeFormat("es-ES", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(item.plannedStart))}
                  </time>
                  <i />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.assetCode} · {item.assigneeName ?? "Sin asignar"} ·{" "}
                      {formatDuration(item.estimatedMinutes)}
                    </small>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              description="No hay trabajos programados para la fecha operativa."
              title="Plan sin carga"
            />
          )}
        </article>
      </section>
    </div>
  );
}
