import type { Metadata } from "next";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  FileSearch,
  GitBranch,
  Link2,
  ListChecks,
  SearchCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RcaWorkspaceActions } from "@/components/reliability/rca-workspace-actions";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { can } from "@/lib/domain/permissions";
import {
  formatDate,
  formatDateTime,
  rcaActionTypeLabels,
} from "@/lib/presentation";
import { getCurrentSession, requireDemoSession } from "@/lib/server/auth";
import { getRootCauseAnalysis } from "@/lib/server/repositories/reliability";

type Params = Promise<{ number: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { number } = await params;
  const session = await getCurrentSession();
  const data = session
    ? await getRootCauseAnalysis(
        { organizationId: session.organizationId, siteId: session.siteId },
        decodeURIComponent(number),
      )
    : null;
  return {
    title: data ? `${data.number} · ${data.assetCode}` : `RCA ${number}`,
    description: data?.problem ?? "Análisis de causa raíz industrial.",
  };
}

export default async function RootCauseAnalysisPage({
  params,
}: {
  params: Params;
}) {
  const session = await requireDemoSession();
  const { number } = await params;
  const data = await getRootCauseAnalysis(
    { organizationId: session.organizationId, siteId: session.siteId },
    decodeURIComponent(number),
  );
  if (!data) notFound();

  return (
    <div className="page-stack rca-detail-page">
      <nav className="breadcrumbs" aria-label="Ruta de investigación">
        <Link href="/reliability">
          <ArrowLeft size={14} /> Reliability Center
        </Link>
        <span>/</span>
        <strong>{data.number}</strong>
      </nav>

      <header className="rca-detail-header">
        <div className="rca-detail-identity">
          <span>
            <SearchCheck size={21} />
          </span>
          <div>
            <p className="overline">
              {data.number} · {data.failureModeName ?? "Modo por formalizar"}
            </p>
            <h1>{data.problem}</h1>
            <p>{data.impact}</p>
          </div>
        </div>
        <div className="rca-detail-status">
          <StatusBadge value={data.status} />
          <Link
            href={`/assets/${encodeURIComponent(data.assetCode)}#reliability`}
          >
            <small>Activo investigado</small>
            <strong>
              {data.assetCode} · {data.assetName}
            </strong>
          </Link>
        </div>
      </header>

      <div className="rca-workspace-layout">
        <div className="rca-main-column">
          <section className="data-panel rca-cause-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Cadena causal</p>
                <h2>De síntoma a causa raíz</h2>
              </div>
              <GitBranch size={18} />
            </div>
            <div className="rca-cause-flow">
              <article>
                <small>Problema</small>
                <p>{data.problem}</p>
              </article>
              <i />
              <article>
                <small>Causa inmediata</small>
                <p>{data.immediateCause ?? "Pendiente de investigación"}</p>
              </article>
              <i />
              <article className={data.rootCause ? "root-confirmed" : ""}>
                <small>Causa raíz</small>
                <p>{data.rootCause ?? "Pendiente de evidencia suficiente"}</p>
              </article>
            </div>
            {data.whys.length ? (
              <ol className="rca-why-list">
                {data.whys.map((why) => (
                  <li key={why.id}>
                    <em>{why.sequence}</em>
                    <span>
                      <strong>{why.question}</strong>
                      <p>{why.answer}</p>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="inline-empty">
                La cadena de porqués se construirá durante la investigación.
              </p>
            )}
          </section>

          <section className="data-panel rca-action-list-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Contramedidas</p>
                <h2>Acciones correctivas</h2>
                <p>Trabajo y cambios trazados hasta su verificación.</p>
              </div>
              <ListChecks size={18} />
            </div>
            {data.actions.length ? (
              <div className="rca-detail-actions">
                {data.actions.map((action) => (
                  <article key={action.id}>
                    <span
                      className={`rca-action-state state-${action.status.toLowerCase()}`}
                    >
                      {action.status === "DONE" ? (
                        <CheckCircle2 size={15} />
                      ) : (
                        <CalendarClock size={15} />
                      )}
                    </span>
                    <span>
                      <small>
                        {rcaActionTypeLabels[action.actionType] ??
                          action.actionType}{" "}
                        · {action.ownerName}
                      </small>
                      <strong>{action.title}</strong>
                      <p>{action.description}</p>
                      <em>Objetivo {formatDate(action.targetAt)}</em>
                    </span>
                    <span className="rca-action-links">
                      <StatusBadge value={action.status} />
                      {action.linkedWorkOrderNumber ? (
                        <Link
                          href={`/work-orders/${encodeURIComponent(action.linkedWorkOrderNumber)}`}
                        >
                          {action.linkedWorkOrderNumber} <Link2 size={12} />
                        </Link>
                      ) : null}
                      {action.linkedMaintenancePlanCode ? (
                        <Link
                          href={`/maintenance-plans/${encodeURIComponent(action.linkedMaintenancePlanCode)}`}
                        >
                          {action.linkedMaintenancePlanCode} <Link2 size={12} />
                        </Link>
                      ) : null}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Sin acciones definidas"
                description="La causa debe formalizarse antes de convertir decisiones en trabajo real."
              />
            )}
          </section>

          <section className="data-panel rca-evidence-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Base técnica</p>
                <h2>Evidencias</h2>
              </div>
              <FileSearch size={18} />
            </div>
            <div className="rca-evidence-list">
              {data.evidence.map((item) => (
                <article key={item.id}>
                  <span>{item.kind.slice(0, 2)}</span>
                  <div>
                    <small>
                      {item.kind} · {formatDateTime(item.createdAt)}
                    </small>
                    <p>{item.description}</p>
                    {item.sourceReference ? (
                      <em>{item.sourceReference}</em>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="data-panel rca-timeline-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Trazabilidad</p>
                <h2>Historial de investigación</h2>
              </div>
            </div>
            <div className="compact-timeline">
              {data.events.map((event) => (
                <div key={event.id}>
                  <time>{formatDateTime(event.createdAt)}</time>
                  <i />
                  <span>
                    <strong>{event.eventType.replaceAll("_", " ")}</strong>
                    <p>{event.note}</p>
                    <small>{event.actorName}</small>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="rca-side-column">
          <section className="data-panel rca-facts-panel">
            <p className="overline">Control</p>
            <dl>
              <div>
                <dt>
                  <UserRound size={14} /> Responsable
                </dt>
                <dd>{data.ownerName}</dd>
              </div>
              <div>
                <dt>
                  <CalendarClock size={14} /> Fecha objetivo
                </dt>
                <dd>{formatDate(data.targetAt)}</dd>
              </div>
              <div>
                <dt>Creada por</dt>
                <dd>{data.createdByName}</dd>
              </div>
              <div>
                <dt>Inicio</dt>
                <dd>{formatDate(data.createdAt)}</dd>
              </div>
              <div>
                <dt>Modo de fallo</dt>
                <dd>{data.failureModeName ?? "Por formalizar"}</dd>
              </div>
            </dl>
            {data.sourceWorkOrderNumber ? (
              <Link
                className="secondary-button"
                href={`/work-orders/${encodeURIComponent(data.sourceWorkOrderNumber)}`}
              >
                Abrir {data.sourceWorkOrderNumber}
              </Link>
            ) : null}
          </section>
          <RcaWorkspaceActions
            canManage={can(session, "RCA_MANAGE")}
            rca={data}
          />
        </aside>
      </div>
    </div>
  );
}
