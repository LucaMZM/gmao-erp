import type { Metadata } from "next";
import {
  Activity,
  ArrowLeft,
  CalendarClock,
  Camera,
  CircleDollarSign,
  FileClock,
  Gauge,
  MapPin,
  Network,
  PackageSearch,
  Repeat2,
  SearchCheck,
  ShieldCheck,
  Tag,
  TimerOff,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { AssetComponentTree } from "@/components/assets/asset-component-tree";
import { HealthIndicator } from "@/components/ui/health-indicator";
import { StatusBadge } from "@/components/ui/status-badge";
import { can } from "@/lib/domain/permissions";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDuration,
  preventiveTriggerLabels,
} from "@/lib/presentation";
import { getCurrentSession, requireDemoSession } from "@/lib/server/auth";
import { getAssetDetail } from "@/lib/server/repositories/assets";
import { tenantScope } from "@/lib/server/repositories/shared";

type Params = Promise<{ code: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { code } = await params;
  const session = await getCurrentSession();
  const detail = session
    ? await getAssetDetail(tenantScope(session), decodeURIComponent(code))
    : null;
  const title = detail
    ? `${detail.asset.code} · ${detail.asset.name}`
    : `Activo ${code}`;
  const description =
    detail?.asset.description ??
    "Detalle de activo industrial en Mazmi Factory GMAO.";
  return {
    title,
    description,
    openGraph: { title, description, images: [] },
    twitter: { card: "summary", title, description, images: [] },
  };
}

export default async function AssetDetailPage({ params }: { params: Params }) {
  const session = await requireDemoSession();
  const { code } = await params;
  const data = await getAssetDetail(
    tenantScope(session),
    decodeURIComponent(code),
  );
  if (!data) notFound();
  const { asset } = data;
  const activeOrders = data.orders.filter(
    (order) => !["COMPLETED", "CLOSED", "CANCELLED"].includes(order.status),
  );

  return (
    <div className="page-stack detail-page">
      <nav className="breadcrumbs" aria-label="Ruta del activo">
        <Link href="/assets">
          <ArrowLeft size={14} /> Activos
        </Link>
        <span>/</span>
        <span>{asset.siteName}</span>
        <span>/</span>
        <span>{asset.areaName}</span>
        <span>/</span>
        <strong>{asset.code}</strong>
      </nav>

      {session.permissionCodes.includes("asset.manage") ? (
        <Link
          className="secondary-button"
          href={`/assets/manage?asset=${encodeURIComponent(asset.id)}`}
        >
          Editar activo
        </Link>
      ) : null}

      <header className="entity-detail-header">
        <div className="detail-identity">
          <span className="large-asset-token">{asset.code.split("-")[0]}</span>
          <div>
            <p className="overline">
              {asset.className} · {asset.code}
            </p>
            <h1>{asset.name}</h1>
            <p>{asset.description}</p>
          </div>
        </div>
        <div className="detail-status-cluster">
          <StatusBadge value={asset.status} />
          <StatusBadge kind="criticality" value={asset.criticality} />
          <div className="headline-health">
            <span>Health score</span>
            <strong>{asset.healthScore}</strong>
            <i>
              <b style={{ width: `${asset.healthScore}%` }} />
            </i>
          </div>
        </div>
      </header>

      <nav className="detail-tabs" aria-label="Secciones del activo">
        <a className="active" href="#summary">
          Resumen
        </a>
        <a href="#orders">
          Órdenes <span>{data.orders.length}</span>
        </a>
        <a href="#preventive">
          Preventivo <span>{data.maintenancePlans.length}</span>
        </a>
        <a href="#reliability">
          Fiabilidad <span>{data.reliability.signals.length}</span>
        </a>
        <a href="#history">
          Incidencias <span>{data.incidents.length}</span>
        </a>
        <a href="#components">
          Componentes <span>{data.children.length}</span>
        </a>
        <a href="#parts">
          Recambios <span>{data.compatibleParts.length}</span>
        </a>
        <a href="#history">Historial</a>
        <a href="#field-record">
          Campo{" "}
          <span>
            {data.fieldEvidence.length + data.fieldMeasurements.length}
          </span>
        </a>
      </nav>

      <div className="detail-layout" id="summary">
        <div className="detail-main-column">
          <section className="data-panel health-explanation-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Condición</p>
                <h2>Qué explica la salud del activo</h2>
                <p>
                  El score combina condición, trabajo vencido y recurrencia
                  correctiva.
                </p>
              </div>
              <HealthIndicator score={asset.healthScore} />
            </div>
            <div className="health-driver-grid">
              {data.healthDrivers.map((driver) => (
                <div key={driver.label}>
                  <i className={driver.tone} />
                  <span>
                    <small>{driver.label}</small>
                    <strong>{driver.value}</strong>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section
            className="data-panel asset-reliability-panel"
            id="reliability"
          >
            <div className="panel-title-row">
              <div>
                <p className="overline">Fiabilidad · 90 días</p>
                <h2>Comportamiento del activo</h2>
                <p>
                  Métricas derivadas de correctivos, tiempos reales y downtime
                  persistido.
                </p>
              </div>
              <Link className="text-action" href="/reliability">
                Abrir Reliability Center
              </Link>
              {can(session, "RCA_CREATE") ? (
                <Link
                  className="secondary-button"
                  href={{
                    pathname: "/reliability",
                    query: { asset: asset.id },
                  }}
                >
                  <SearchCheck size={14} /> Iniciar RCA
                </Link>
              ) : null}
            </div>
            <div className="asset-reliability-metrics">
              <article>
                <small>MTBF</small>
                <strong>
                  {data.reliability.metrics.mtbfMinutes === null
                    ? "Datos insuficientes"
                    : formatDuration(data.reliability.metrics.mtbfMinutes)}
                </strong>
                <span>{data.reliability.metrics.failureCount} fallos</span>
              </article>
              <article>
                <small>MTTR</small>
                <strong>
                  {data.reliability.metrics.mttrMinutes === null
                    ? "Datos insuficientes"
                    : formatDuration(data.reliability.metrics.mttrMinutes)}
                </strong>
                <span>Tiempo real de reparación</span>
              </article>
              <article>
                <small>Downtime</small>
                <strong>
                  {formatDuration(data.reliability.metrics.downtimeMinutes)}
                </strong>
                <span>
                  {data.reliability.metrics.availability.toFixed(2)}%
                  disponibilidad técnica
                </span>
              </article>
              <article>
                <small>Repetición</small>
                <strong>
                  {data.reliability.metrics.repeatFailureRate === null
                    ? "Datos insuficientes"
                    : `${data.reliability.metrics.repeatFailureRate.toFixed(0)}%`}
                </strong>
                <span>Ocurrencias repetidas</span>
              </article>
            </div>
            <div className="asset-health-breakdown">
              <h3>Por qué el health es {asset.healthScore}</h3>
              {data.reliability.metrics.healthBreakdown.map((driver) => (
                <div key={driver.key}>
                  <span className={`health-adjustment tone-${driver.tone}`}>
                    {driver.adjustment > 0 ? "+" : ""}
                    {driver.adjustment}
                  </span>
                  <span>
                    <strong>{driver.label}</strong>
                    <small>{driver.explanation}</small>
                  </span>
                </div>
              ))}
            </div>
            {data.reliability.signals.length ? (
              <div className="asset-failure-signals">
                <h3>
                  <Activity size={15} /> Patrones de fallo
                </h3>
                {data.reliability.signals.map((signal) => (
                  <article key={`${signal.assetId}-${signal.failureModeCode}`}>
                    <span>
                      {signal.pattern === "GROWING"
                        ? "Creciente"
                        : signal.pattern === "RECURRENT"
                          ? "Recurrente"
                          : signal.pattern === "STABLE"
                            ? "Estable"
                            : "Aislado"}
                    </span>
                    <div>
                      <strong>{signal.failureModeName}</strong>
                      <p>{signal.explanation}</p>
                    </div>
                    <em>{formatDuration(signal.downtimeMinutes)}</em>
                  </article>
                ))}
              </div>
            ) : null}
            {data.reliability.rcas.length ? (
              <div className="asset-rca-links">
                <h3>
                  <SearchCheck size={15} /> Investigaciones relacionadas
                </h3>
                {data.reliability.rcas.map((rca) => (
                  <Link
                    href={`/reliability/rca/${encodeURIComponent(rca.number)}`}
                    key={rca.id}
                  >
                    <span>
                      <small>{rca.number}</small>
                      <strong>{rca.problem}</strong>
                    </span>
                    <StatusBadge value={rca.status} />
                  </Link>
                ))}
              </div>
            ) : null}
          </section>

          {data.maintenancePlans.length ? (
            <section
              className="data-panel asset-preventive-panel"
              id="preventive"
            >
              <div className="panel-title-row">
                <div>
                  <p className="overline">Estrategia preventiva</p>
                  <h2>Planes vinculados</h2>
                  <p>Frecuencias, contadores y próximas ventanas del activo.</p>
                </div>
                <Repeat2 size={17} />
              </div>
              <div className="asset-plan-list">
                {data.maintenancePlans.map((plan) => (
                  <Link
                    href={`/maintenance-plans/${encodeURIComponent(plan.code)}`}
                    key={plan.id}
                  >
                    <span>
                      <small>
                        {plan.code} ·{" "}
                        {preventiveTriggerLabels[plan.triggerMode]}
                      </small>
                      <strong>{plan.title}</strong>
                    </span>
                    <span>
                      <strong>{formatDateTime(plan.nextDueAt)}</strong>
                      <small>
                        {plan.meterCode
                          ? `${plan.meterCode} · ${plan.meterValue ?? "—"} ${plan.meterUnit}`
                          : "Próxima ventana"}
                      </small>
                    </span>
                    <StatusBadge value={plan.status} />
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <section className="data-panel" id="orders">
            <div className="panel-title-row">
              <div>
                <p className="overline">Intervenciones</p>
                <h2>Órdenes abiertas</h2>
              </div>
              <Link
                className="text-action"
                href={`/work-orders?q=${encodeURIComponent(asset.code)}&view=all`}
              >
                Ver historial completo
              </Link>
            </div>
            {activeOrders.length ? (
              <div className="entity-row-list">
                {activeOrders.map((order) => (
                  <Link
                    href={`/work-orders/${encodeURIComponent(order.number)}`}
                    key={order.id}
                  >
                    <StatusBadge kind="priority" value={order.priority} />
                    <span>
                      <small>
                        {order.number} · {formatDate(order.requestedAt)}
                      </small>
                      <strong>{order.title}</strong>
                    </span>
                    <StatusBadge value={order.status} />
                    <em>{order.assigneeName ?? "Sin asignar"}</em>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                description="No hay intervenciones activas vinculadas a este activo."
                title="Sin órdenes abiertas"
              />
            )}
          </section>

          <section className="data-panel" id="components">
            <div className="panel-title-row">
              <div>
                <p className="overline">Jerarquía mantenible</p>
                <h2>Conjuntos y componentes</h2>
              </div>
              <Network size={17} />
            </div>
            {data.children.length ? (
              <AssetComponentTree items={data.children} parentId={asset.id} />
            ) : (
              <EmptyState
                description="Este elemento está modelado como componente final de la jerarquía."
                title="Sin activos hijos"
              />
            )}
          </section>

          {data.fieldEvidence.length || data.fieldMeasurements.length ? (
            <section
              className="data-panel asset-field-record"
              id="field-record"
            >
              <div className="panel-title-row">
                <div>
                  <p className="overline">Trazabilidad de campo</p>
                  <h2>Evidencias y condición registrada</h2>
                  <p>Datos capturados dentro de intervenciones reales.</p>
                </div>
                <Camera size={17} />
              </div>
              <div className="asset-field-record-grid">
                <div>
                  <h3>
                    <Gauge size={15} /> Mediciones
                  </h3>
                  {data.fieldMeasurements.map((item) => (
                    <Link
                      href={`/work-orders/${encodeURIComponent(item.workOrderNumber)}`}
                      key={item.id}
                    >
                      <span>
                        <small>
                          {item.workOrderNumber} ·{" "}
                          {formatDateTime(item.recordedAt)}
                        </small>
                        <strong>{item.label}</strong>
                      </span>
                      <em
                        className={
                          item.result === "OUT_OF_RANGE" ? "critical" : ""
                        }
                      >
                        {item.value} {item.unit}
                      </em>
                    </Link>
                  ))}
                </div>
                <div>
                  <h3>
                    <Camera size={15} /> Evidencias
                  </h3>
                  {data.fieldEvidence.map((item) => (
                    <article key={item.id}>
                      <span>
                        <small>
                          {item.workOrderNumber ?? "Activo"} ·{" "}
                          {formatDateTime(item.createdAt)}
                        </small>
                        <strong>{item.description}</strong>
                      </span>
                      <em>
                        {item.kind === "NOTE"
                          ? "Nota"
                          : item.kind === "PHOTO"
                            ? "Foto"
                            : "Documento"}
                      </em>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          <section className="data-panel" id="history">
            <div className="panel-title-row">
              <div>
                <p className="overline">Conocimiento técnico</p>
                <h2>Historial reciente</h2>
              </div>
              <FileClock size={17} />
            </div>
            <div className="asset-timeline">
              {data.history.map((item) => (
                <Link href={item.href ?? "#history"} key={item.id}>
                  <i className={item.tone} />
                  <time>{formatDateTime(item.occurredAt)}</time>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                  {item.status ? (
                    <StatusBadge value={item.status} />
                  ) : (
                    <small className="history-kind">{item.kind}</small>
                  )}
                </Link>
              ))}
            </div>
          </section>
        </div>

        <aside className="detail-rail">
          <section className="data-panel detail-facts">
            <div className="panel-title-row">
              <div>
                <p className="overline">Ficha técnica</p>
                <h2>Identidad y contexto</h2>
              </div>
              <Tag size={16} />
            </div>
            <dl>
              <div>
                <dt>
                  <MapPin size={14} /> Ubicación
                </dt>
                <dd>
                  {asset.locationName}
                  <small>{asset.locationCode}</small>
                </dd>
              </div>
              <div>
                <dt>
                  <Network size={14} /> Jerarquía
                </dt>
                <dd>
                  {asset.parentName ?? asset.areaName}
                  <small>{asset.parentCode ?? asset.areaCode}</small>
                </dd>
              </div>
              <div>
                <dt>Fabricante</dt>
                <dd>{asset.manufacturer ?? "No informado"}</dd>
              </div>
              <div>
                <dt>Modelo</dt>
                <dd>{asset.model ?? "No informado"}</dd>
              </div>
              <div>
                <dt>Nº de serie</dt>
                <dd className="mono">{asset.serialNumber ?? "—"}</dd>
              </div>
              <div>
                <dt>Proveedor</dt>
                <dd>{asset.vendorName ?? "Sin proveedor principal"}</dd>
              </div>
              <div>
                <dt>
                  <CalendarClock size={14} /> Próximo PM
                </dt>
                <dd>
                  {formatDateTime(
                    data.maintenancePlans.find(
                      (plan) => plan.status === "ACTIVE",
                    )?.nextDueAt ?? asset.nextPmAt,
                  )}
                </dd>
              </div>
              <div>
                <dt>
                  <ShieldCheck size={14} /> Garantía
                </dt>
                <dd>
                  {asset.warrantyUntil
                    ? `Hasta ${formatDate(asset.warrantyUntil)}`
                    : "Fuera de garantía"}
                </dd>
              </div>
            </dl>
          </section>

          <section className="detail-metrics">
            <div>
              <span>
                <TimerOff size={15} /> Downtime histórico
              </span>
              <strong>{formatDuration(data.downtimeMinutes)}</strong>
            </div>
            <div>
              <span>
                <CircleDollarSign size={15} /> Material registrado
              </span>
              <strong>{formatCurrency(data.maintenanceCost)}</strong>
            </div>
          </section>

          <section className="data-panel" id="parts">
            <div className="panel-title-row">
              <div>
                <p className="overline">MRO compatible</p>
                <h2>Recambios</h2>
              </div>
              <PackageSearch size={16} />
            </div>
            {data.compatibleParts.length ? (
              <div className="compatible-parts-list">
                {data.compatibleParts.map((part) => (
                  <Link href={`/inventory?part=${part.id}`} key={part.id}>
                    <span>
                      <small>{part.sku}</small>
                      <strong>{part.name}</strong>
                    </span>
                    <em className={part.available <= 0 ? "critical" : ""}>
                      {part.available} disp.
                    </em>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                description="No hay compatibilidades registradas todavía."
                title="Sin recambios vinculados"
              />
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
