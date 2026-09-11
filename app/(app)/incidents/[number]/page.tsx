import type { Metadata } from "next";
import {
  ArrowLeft,
  Boxes,
  FileClock,
  MapPin,
  Siren,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/lib/domain/governance";
import { IncidentTriageActions } from "@/components/incidents/incident-triage-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { can } from "@/lib/domain/permissions";
import {
  formatDateTime,
  incidentImpactLabels,
  incidentOriginLabels,
  priorityLabels,
  typeLabels,
} from "@/lib/presentation";
import { getCurrentSession, requireDemoSession } from "@/lib/server/auth";
import { getIncidentDetail } from "@/lib/server/repositories/incidents";
import { tenantScope } from "@/lib/server/repositories/shared";

type Params = Promise<{ number: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const session = await getCurrentSession();
  const { number } = await params;
  const data =
    session && hasPermission(session.permissionCodes, "incident.report")
      ? await getIncidentDetail(
          tenantScope(session),
          decodeURIComponent(number),
        )
      : null;
  return {
    title: data
      ? `${data.incident.number} · ${data.incident.title}`
      : `Incidencia ${number}`,
  };
}

export default async function IncidentDetailPage({
  params,
}: {
  params: Params;
}) {
  const session = await requireDemoSession();
  if (!hasPermission(session.permissionCodes, "incident.report"))
    redirect("/overview");
  const { number } = await params;
  const data = await getIncidentDetail(
    tenantScope(session),
    decodeURIComponent(number),
  );
  if (!data) notFound();
  const incident = data.incident;

  return (
    <div className="page-stack detail-page incident-detail-page">
      <nav aria-label="Ruta de la incidencia" className="breadcrumbs">
        <Link href="/incidents">
          <ArrowLeft size={14} /> Incidencias
        </Link>
        <span>/</span>
        <strong>{incident.number}</strong>
      </nav>
      <header className="entity-detail-header incident-detail-header">
        <div className="detail-identity">
          <span className="large-asset-token incident-token">INC</span>
          <div>
            <p className="overline">
              {incident.number} · {incidentOriginLabels[incident.origin]}
            </p>
            <h1>{incident.title}</h1>
            <p>{incident.description}</p>
          </div>
        </div>
        <div className="detail-status-cluster">
          <span
            className={`incident-severity ${incident.severity.toLowerCase()}`}
          >
            {incident.severity}
          </span>
          <StatusBadge value={incident.status} />
        </div>
      </header>

      <div className="detail-layout incident-detail-layout">
        <div className="detail-main-column">
          <section className="data-panel incident-context-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Contexto operativo</p>
                <h2>Qué se ha detectado</h2>
              </div>
              <Siren size={17} />
            </div>
            <div className="incident-context-grid">
              <div>
                <span>
                  <MapPin size={14} /> Ubicación
                </span>
                <strong>{incident.locationName}</strong>
                <small>{incident.locationCode}</small>
              </div>
              <div>
                <span>
                  <Boxes size={14} /> Activo
                </span>
                <strong>
                  {incident.assetName ?? "Pendiente de identificar"}
                </strong>
                <small>{incident.assetCode ?? "Sin activo"}</small>
              </div>
              <div>
                <span>Impacto inicial</span>
                <strong>
                  {incidentImpactLabels[incident.initialImpact] ??
                    incident.initialImpact}
                </strong>
              </div>
              <div>
                <span>Reportado por</span>
                <strong>{incident.reporterName}</strong>
                <small>{formatDateTime(incident.reportedAt)}</small>
              </div>
            </div>
          </section>

          {incident.workOrderNumber ? (
            <section className="operation-action-card accepted linked-work-order">
              <span>
                <FileClock size={16} />
              </span>
              <div>
                <strong>Trabajo trazable creado</strong>
                <small>
                  La incidencia permanece vinculada a la orden durante todo su
                  lifecycle.
                </small>
              </div>
              <Link
                className="primary-button"
                href={`/work-orders/${incident.workOrderNumber}`}
              >
                Abrir {incident.workOrderNumber}
              </Link>
            </section>
          ) : (
            <section className="data-panel triage-workspace">
              <div className="panel-title-row">
                <div>
                  <p className="overline">Decisión operativa</p>
                  <h2>Triage</h2>
                  <p>
                    Clasifica solo la información necesaria para orientar el
                    trabajo.
                  </p>
                </div>
              </div>
              <IncidentTriageActions
                assetId={incident.assetId}
                assets={data.assets}
                canTriage={can(session, "INCIDENT_TRIAGE")}
                classification={incident.classification}
                incidentId={incident.id}
                priority={incident.triagePriority}
                status={incident.status}
              />
            </section>
          )}
        </div>

        <aside className="detail-rail">
          <section className="data-panel detail-facts">
            <div className="panel-title-row">
              <div>
                <p className="overline">Clasificación</p>
                <h2>Estado de decisión</h2>
              </div>
              <UserRound size={16} />
            </div>
            <dl>
              <div>
                <dt>Estado</dt>
                <dd>
                  <StatusBadge value={incident.status} />
                </dd>
              </div>
              <div>
                <dt>Prioridad</dt>
                <dd>
                  {incident.triagePriority
                    ? priorityLabels[incident.triagePriority]
                    : "Pendiente"}
                </dd>
              </div>
              <div>
                <dt>Tipo de trabajo</dt>
                <dd>
                  {incident.classification
                    ? typeLabels[incident.classification]
                    : "Pendiente"}
                </dd>
              </div>
              <div>
                <dt>Triage</dt>
                <dd>{formatDateTime(incident.triagedAt)}</dd>
              </div>
              <div>
                <dt>Resolución</dt>
                <dd>{formatDateTime(incident.resolvedAt)}</dd>
              </div>
            </dl>
          </section>
          <section className="data-panel event-timeline-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Trazabilidad</p>
                <h2>Historial</h2>
              </div>
              <FileClock size={16} />
            </div>
            <div className="event-timeline">
              {data.timeline.map((item) => (
                <div key={item.id}>
                  <i />
                  <span>
                    <strong>
                      {item.eventType === "INCIDENT_REPORTED"
                        ? "Incidencia creada"
                        : item.eventType === "INFORMATION_REQUESTED"
                          ? "Información solicitada"
                          : item.eventType ===
                              "INCIDENT_CONVERTED_TO_WORK_ORDER"
                            ? "Convertida en OT"
                            : item.kind === "NOTE"
                              ? "Nota de triage"
                              : "Triage actualizado"}
                    </strong>
                    <small>{item.note}</small>
                    <em>
                      {item.actorName} · {formatDateTime(item.createdAt)}
                    </em>
                  </span>
                  {item.toStatus ? <StatusBadge value={item.toStatus} /> : null}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
