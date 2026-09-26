import { tenantScope } from "@/lib/server/repositories/shared";
import { env } from "cloudflare:workers";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Clock3,
  Gauge,
  SearchCheck,
  ShieldAlert,
  TimerOff,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RcaCreateDialog } from "@/components/reliability/rca-create-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { can } from "@/lib/domain/permissions";
import { hasPermission } from "@/lib/domain/governance";
import {
  formatCurrency,
  formatDate,
  formatDuration,
  reliabilityPatternLabels,
} from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import {
  getReliabilityCenter,
  type ReliabilityBadActor,
} from "@/lib/server/repositories/reliability";

const sortLabels: Record<string, string> = {
  impact: "Impacto",
  downtime: "Downtime",
  failures: "Frecuencia",
  cost: "Coste",
  mttr: "MTTR",
  health: "Health",
};

const paretoLabels: Record<string, string> = {
  asset: "Activo",
  area: "Área",
  mode: "Modo de fallo",
  cost: "Coste MRO",
  mro: "Consumo MRO",
};

function metric(value: number | null, unit: "duration" | "percent") {
  if (value === null) return "Datos insuficientes";
  return unit === "duration" ? formatDuration(value) : `${value.toFixed(1)}%`;
}

function sortedActors(items: ReliabilityBadActor[], sort: string) {
  return [...items].sort((left, right) => {
    if (sort === "downtime")
      return right.downtimeMinutes - left.downtimeMinutes;
    if (sort === "failures") return right.failureCount - left.failureCount;
    if (sort === "cost") return right.maintenanceCost - left.maintenanceCost;
    if (sort === "mttr")
      return (right.mttrMinutes ?? -1) - (left.mttrMinutes ?? -1);
    if (sort === "health") return left.healthScore - right.healthScore;
    return right.impactScore - left.impactScore;
  });
}

export default async function ReliabilityPage({
  searchParams,
}: {
  searchParams: Promise<{
    sort?: string | string[];
    pareto?: string | string[];
    asset?: string | string[];
    mode?: string | string[];
    source?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const sort =
    typeof params.sort === "string" && sortLabels[params.sort]
      ? params.sort
      : "impact";
  const pareto =
    typeof params.pareto === "string" && paretoLabels[params.pareto]
      ? params.pareto
      : "asset";
  const session = await requireDemoSession();
  if (!hasPermission(session.permissionCodes, "reliability.rca.manage"))
    redirect("/overview");
  const data = await getReliabilityCenter(
    tenantScope(session),
    env.MAZMI_TEST_NOW,
  );
  const actors = sortedActors(data.badActors, sort).slice(0, 10);
  const paretoRows =
    pareto === "area"
      ? data.pareto.downtimeByArea
      : pareto === "mode"
        ? data.pareto.failuresByMode
        : pareto === "cost"
          ? data.pareto.costByAsset
          : pareto === "mro"
            ? data.pareto.mroByAsset
            : data.pareto.downtimeByAsset;
  const paretoUnit =
    pareto === "cost"
      ? "€"
      : pareto === "mro" || pareto === "mode"
        ? ""
        : "min";
  const attentionSignals = data.signals.filter((signal) =>
    ["GROWING", "RECURRENT"].includes(signal.pattern),
  );

  return (
    <div className="page-stack reliability-page">
      <PageHeader
        actions={
          <RcaCreateDialog
            assets={data.catalogs.assets}
            autoOpen={typeof params.asset === "string"}
            canCreate={can(session, "RCA_CREATE")}
            defaultAssetId={
              typeof params.asset === "string" ? params.asset : undefined
            }
            defaultFailureModeId={
              typeof params.mode === "string" ? params.mode : undefined
            }
            failureModes={data.catalogs.failureModes}
            owners={data.catalogs.owners}
            sourceWorkOrderId={
              typeof params.source === "string" ? params.source : undefined
            }
          />
        }
        description="Señales explicables de fallo, downtime y eficacia preventiva para decidir dónde intervenir."
        eyebrow={`${session.siteCode} · Ingeniería de fiabilidad`}
        title="Reliability Center"
      />

      <section
        className="reliability-command-deck"
        aria-label="Estado de fiabilidad"
      >
        <article className="reliability-primary-metric">
          <span className="metric-icon critical">
            <TimerOff size={18} />
          </span>
          <div>
            <small>Downtime · 90 días</small>
            <strong>{formatDuration(data.summary.downtimeMinutes)}</strong>
            <p>{data.summary.failureCount} fallos correctivos cerrados</p>
          </div>
          <i>
            <b
              style={{
                width: `${Math.min(100, data.summary.downtimeMinutes / 25)}%`,
              }}
            />
          </i>
        </article>
        <article className="reliability-primary-metric">
          <span className="metric-icon accent">
            <Gauge size={18} />
          </span>
          <div>
            <small>Disponibilidad técnica</small>
            <strong>{data.summary.availability.toFixed(2)}%</strong>
            <p>Exposición calendario agregada por activo</p>
          </div>
          <i>
            <b style={{ width: `${data.summary.availability}%` }} />
          </i>
        </article>
        <div className="reliability-secondary-metrics">
          <article>
            <small>MTBF</small>
            <strong>{metric(data.summary.mtbfMinutes, "duration")}</strong>
            <span>90 días · calendario</span>
          </article>
          <article>
            <small>MTTR</small>
            <strong>{metric(data.summary.mttrMinutes, "duration")}</strong>
            <span>{data.summary.failureCount} intervenciones</span>
          </article>
          <article className="attention">
            <small>Repetición</small>
            <strong>{metric(data.summary.repeatFailureRate, "percent")}</strong>
            <span>{attentionSignals.length} patrones a revisar</span>
          </article>
          <article>
            <small>Coste MRO</small>
            <strong>{formatCurrency(data.summary.maintenanceCost)}</strong>
            <span>Snapshot histórico · sin mano de obra</span>
          </article>
        </div>
      </section>

      <div className="reliability-context-note">
        <Clock3 size={14} />
        <span>
          Ventana {formatDate(data.window.startsAt)} —{" "}
          {formatDate(data.window.endsAt)}. {data.window.basis}
        </span>
      </div>

      <section className="reliability-signal-grid">
        {attentionSignals.slice(0, 3).map((signal) => (
          <Link
            className={`reliability-signal signal-${signal.pattern.toLowerCase()}`}
            href={{
              pathname: "/reliability",
              query: {
                asset: signal.assetId,
                ...(signal.failureModeId ? { mode: signal.failureModeId } : {}),
              },
            }}
            key={`${signal.assetId}-${signal.failureModeCode}`}
          >
            <span>
              <ShieldAlert size={16} />
              {reliabilityPatternLabels[signal.pattern]}
            </span>
            <strong>
              {signal.assetCode} · {signal.failureModeName}
            </strong>
            <p>{signal.explanation}</p>
            <small>
              {formatDuration(signal.downtimeMinutes)} de impacto · iniciar RCA{" "}
              <ArrowRight size={12} />
            </small>
          </Link>
        ))}
      </section>

      <section className="data-panel reliability-actor-panel">
        <div className="panel-title-row reliability-panel-heading">
          <div>
            <p className="overline">Prioridad de investigación</p>
            <h2>Bad actors</h2>
            <p>
              Ranking determinista: impacto, recurrencia, condición y trabajo
              pendiente.
            </p>
          </div>
          <nav
            aria-label="Ordenar activos problemáticos"
            className="reliability-segmented"
          >
            {Object.entries(sortLabels).map(([key, label]) => (
              <Link
                className={sort === key ? "active" : ""}
                href={{
                  pathname: "/reliability",
                  query: { sort: key, pareto },
                }}
                key={key}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        {actors.length ? (
          <div className="reliability-actor-table">
            <div className="reliability-actor-head">
              <span>Activo / contexto</span>
              <span>Health</span>
              <span>Fallos</span>
              <span>Downtime</span>
              <span>MTTR</span>
              <span>Coste</span>
            </div>
            {actors.map((actor, index) => (
              <Link
                href={`/assets/${encodeURIComponent(actor.code)}#reliability`}
                key={actor.id}
              >
                <div className="actor-identity">
                  <em>{String(index + 1).padStart(2, "0")}</em>
                  <span>
                    <small>
                      {actor.code} · {actor.areaName}
                    </small>
                    <strong>{actor.name}</strong>
                  </span>
                  <StatusBadge kind="criticality" value={actor.criticality} />
                </div>
                <div
                  className={`actor-health health-${actor.healthScore < 60 ? "critical" : actor.healthScore < 80 ? "warning" : "good"}`}
                >
                  <strong>{actor.healthScore}</strong>
                  <i>
                    <b style={{ width: `${actor.healthScore}%` }} />
                  </i>
                </div>
                <strong>{actor.failureCount}</strong>
                <strong>{formatDuration(actor.downtimeMinutes)}</strong>
                <span>
                  {actor.mttrMinutes === null
                    ? "Insuficiente"
                    : formatDuration(actor.mttrMinutes)}
                </span>
                <span>{formatCurrency(actor.maintenanceCost)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Sin activos problemáticos"
            description="No hay datos de fallo suficientes en la ventana actual."
          />
        )}
      </section>

      <div className="reliability-analysis-grid">
        <section className="data-panel pareto-panel">
          <div className="panel-title-row reliability-panel-heading">
            <div>
              <p className="overline">Concentración de impacto</p>
              <h2>Pareto operacional</h2>
              <p>
                Qué pocos elementos explican la mayor parte del impacto
                registrado.
              </p>
            </div>
            <BarChart3 size={18} />
          </div>
          <nav className="pareto-tabs" aria-label="Dimensión Pareto">
            {Object.entries(paretoLabels).map(([key, label]) => (
              <Link
                className={pareto === key ? "active" : ""}
                href={{
                  pathname: "/reliability",
                  query: { sort, pareto: key },
                }}
                key={key}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="pareto-list">
            {paretoRows.length ? (
              paretoRows.slice(0, 7).map((row, index) => (
                <div key={`${row.id}-${index}`}>
                  <span>
                    <em>{index + 1}</em>
                    <strong>{row.label}</strong>
                    <small>
                      {pareto === "cost"
                        ? formatCurrency(row.value)
                        : `${row.value.toFixed(pareto === "mro" ? 1 : 0)} ${paretoUnit}`}
                    </small>
                  </span>
                  <i>
                    <b style={{ width: `${row.cumulativeShare}%` }} />
                  </i>
                  <small>
                    {row.share.toFixed(1)}% · acumulado{" "}
                    {row.cumulativeShare.toFixed(1)}%
                  </small>
                </div>
              ))
            ) : (
              <p className="inline-empty">
                Datos insuficientes para esta dimensión.
              </p>
            )}
          </div>
        </section>

        <section className="data-panel reliability-trend-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Señal temporal</p>
              <h2>30 días vs anteriores</h2>
              <p>Tendencias descriptivas, no predicción.</p>
            </div>
            <Activity size={18} />
          </div>
          <div className="reliability-trends">
            {data.trends.map((trend) => {
              const Icon =
                trend.direction === "INCREASING"
                  ? ArrowUpRight
                  : trend.direction === "DECREASING"
                    ? ArrowDownRight
                    : Activity;
              return (
                <article
                  className={`trend-${trend.direction.toLowerCase()}`}
                  key={trend.key}
                >
                  <span>
                    <Icon size={16} />
                    <small>{trend.label}</small>
                  </span>
                  <strong>
                    {trend.direction === "INSUFFICIENT"
                      ? "Datos insuficientes"
                      : `${Math.round(trend.current)} ${trend.unit}`}
                  </strong>
                  <p>
                    {trend.changePercent === null
                      ? "Sin base comparable"
                      : `${trend.changePercent > 0 ? "+" : ""}${trend.changePercent.toFixed(0)}% vs periodo anterior`}
                  </p>
                </article>
              );
            })}
          </div>
          <div className="downtime-mix">
            <h3>Downtime por impacto</h3>
            {data.downtime.map((item) => (
              <div key={item.key}>
                <span>
                  <strong>{item.label}</strong>
                  <small>
                    {item.events} eventos · {formatDuration(item.minutes)}
                  </small>
                </span>
                <i>
                  <b style={{ width: `${item.share}%` }} />
                </i>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="reliability-analysis-grid lower">
        <section className="data-panel preventive-effectiveness-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Preventivo + correctivo</p>
              <h2>Eficacia observada</h2>
              <p>
                Correlaciones operativas; no se atribuye causalidad automática.
              </p>
            </div>
            <Wrench size={18} />
          </div>
          <div className="effectiveness-list">
            {data.preventiveEffectiveness.slice(0, 6).map((item) => (
              <Link
                href={`/maintenance-plans/${encodeURIComponent(item.planCode)}`}
                key={item.planId}
              >
                <span
                  className={`effectiveness-mark mark-${item.indicator.toLowerCase()}`}
                />
                <span>
                  <small>
                    {item.planCode} · {item.assetCode}
                  </small>
                  <strong>{item.planTitle}</strong>
                  <em>{item.explanation}</em>
                </span>
                <strong>
                  {item.compliance === null
                    ? "—"
                    : `${item.compliance.toFixed(0)}% PM`}
                </strong>
              </Link>
            ))}
          </div>
        </section>

        <section className="data-panel rca-list-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Decisión y seguimiento</p>
              <h2>Análisis de causa raíz</h2>
              <p>Investigaciones trazables con acciones operativas reales.</p>
            </div>
            <SearchCheck size={18} />
          </div>
          <div className="rca-list">
            {data.rcas.map((rca) => (
              <Link
                href={`/reliability/rca/${encodeURIComponent(rca.number)}`}
                key={rca.id}
              >
                <span>
                  <small>
                    {rca.number} · {rca.assetCode}
                  </small>
                  <strong>{rca.problem}</strong>
                  <em>
                    {rca.ownerName} · {rca.openActions} acciones abiertas
                  </em>
                </span>
                <StatusBadge value={rca.status} />
              </Link>
            ))}
          </div>
        </section>
      </div>

      {data.summary.insufficient.length ? (
        <section className="reliability-data-boundary">
          <ShieldAlert size={15} />
          <div>
            <strong>Límites del cálculo</strong>
            {data.summary.insufficient.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
