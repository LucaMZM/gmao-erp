import type { Metadata } from "next";
import {
  Activity,
  ArrowLeft,
  Boxes,
  CalendarClock,
  Camera,
  ClipboardCheck,
  Clock3,
  CircleDollarSign,
  FileText,
  Gauge,
  MapPin,
  MessageSquareText,
  PackageCheck,
  Repeat2,
  ShieldAlert,
  Stethoscope,
  TimerOff,
  UserRound,
  UsersRound,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DowntimeWorkspace } from "@/components/work-orders/downtime-workspace";
import { MaterialWorkspace } from "@/components/work-orders/material-workspace";
import { WorkOrderActions } from "@/components/work-orders/work-order-actions";
import { WorkOrderCostForm } from "@/components/work-orders/work-order-cost-form";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  failureCauseLabels,
  failureModeLabels,
  formatCurrency,
  formatDateTime,
  formatDuration,
  statusLabels,
  typeLabels,
  workOrderEventLabels,
} from "@/lib/presentation";
import { can } from "@/lib/domain/permissions";
import { getCurrentSession, requireDemoSession } from "@/lib/server/auth";
import { getFieldWorkOrder } from "@/lib/server/repositories/field";
import { getWorkOrderDetail } from "@/lib/server/repositories/work-orders";
import { tenantScope } from "@/lib/server/repositories/shared";
import { getFailureModeOptions } from "@/lib/server/repositories/failure-modes";

type Params = Promise<{ number: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { number } = await params;
  const session = await getCurrentSession();
  const detail = session
    ? await getWorkOrderDetail(tenantScope(session), decodeURIComponent(number))
    : null;
  const title = detail
    ? `${detail.order.number} · ${detail.order.title}`
    : `Orden ${number}`;
  const description =
    detail?.order.description ??
    "Detalle de orden de trabajo en Mazmi Factory GMAO.";
  return {
    title,
    description,
    openGraph: { title, description, images: [] },
    twitter: { card: "summary", title, description, images: [] },
  };
}

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Params;
}) {
  const session = await requireDemoSession();
  const { number } = await params;
  const data = await getFieldWorkOrder(
    tenantScope(session),
    session.userId,
    session.roleKey,
    decodeURIComponent(number),
  );
  if (!data) notFound();
  const { order } = data;
  const failureModes = await getFailureModeOptions(tenantScope(session));
  const materialOperationsAllowed = !["CLOSED", "CANCELLED"].includes(
    order.status,
  );
  const downtimeOperationsAllowed = ![
    "COMPLETED",
    "CLOSED",
    "CANCELLED",
  ].includes(order.status);

  return (
    <div className="page-stack detail-page work-order-detail-page">
      <nav className="breadcrumbs" aria-label="Ruta de la orden">
        <Link href="/work-orders">
          <ArrowLeft size={14} /> Órdenes de trabajo
        </Link>
        <span>/</span>
        <strong>{order.number}</strong>
      </nav>

      <header className="entity-detail-header work-detail-header">
        <div className="detail-identity">
          <span className="large-asset-token order-token">OT</span>
          <div>
            <p className="overline">
              {order.number} · {typeLabels[order.type]}
            </p>
            <h1>{order.title}</h1>
            <p>{order.description}</p>
          </div>
        </div>
        <div className="detail-status-cluster">
          <StatusBadge kind="priority" value={order.priority} />
          <StatusBadge value={order.status} />
          <Link
            className="primary-button"
            href={`/assets/${encodeURIComponent(order.assetCode)}`}
          >
            <Boxes size={15} /> Abrir activo
          </Link>
          {can(session, "RCA_CREATE") ? (
            <Link
              className="secondary-button"
              href={{
                pathname: "/reliability",
                query: {
                  asset: order.assetId,
                  source: order.id,
                  ...(order.failureModeId ? { mode: order.failureModeId } : {}),
                },
              }}
            >
              <Stethoscope size={15} /> Iniciar RCA
            </Link>
          ) : null}
        </div>
      </header>

      <div className="work-order-summary-strip">
        <div>
          <span>
            <Wrench size={14} /> Tipo
          </span>
          <strong>{typeLabels[order.type]}</strong>
        </div>
        <div>
          <span>
            <CalendarClock size={14} /> Compromiso
          </span>
          <strong>{formatDateTime(order.dueAt)}</strong>
        </div>
        <div>
          <span>
            <Clock3 size={14} /> Duración estimada
          </span>
          <strong>{formatDuration(order.estimatedMinutes)}</strong>
        </div>
        <div>
          <span>
            <TimerOff size={14} /> Downtime
          </span>
          <strong>{formatDuration(order.downtimeMinutes)}</strong>
        </div>
        <div>
          <span>
            <CircleDollarSign size={14} /> Coste consolidado
          </span>
          <strong>{formatCurrency(data.costs.total)}</strong>
        </div>
      </div>

      <WorkOrderActions
        failureModes={failureModes}
        workOrderType={order.type}
        activeLabor={data.labor
          .filter((entry) => !entry.endedAt)
          .map((entry) => ({ id: entry.id, userName: entry.userName }))}
        assignedUserIds={data.assignments.map(
          (assignment) => assignment.userId,
        )}
        number={order.number}
        permissions={{
          assign: can(session, "WORK_ORDER_ASSIGN"),
          schedule: can(session, "WORK_ORDER_SCHEDULE"),
          execute: can(session, "WORK_ORDER_EXECUTE"),
          complete: can(session, "WORK_ORDER_COMPLETE"),
          close: can(session, "WORK_ORDER_CLOSE"),
          cancel: can(session, "WORK_ORDER_CANCEL"),
          priority: can(session, "INCIDENT_TRIAGE"),
        }}
        priority={order.priority}
        status={order.status}
        technicians={data.technicians}
      />

      <div className="detail-layout">
        <div className="detail-main-column">
          {data.tasks.length ? (
            <section className="data-panel work-order-checklist-panel">
              <div className="panel-title-row">
                <div>
                  <p className="overline">Estándar preventivo</p>
                  <h2>Checklist de ejecución</h2>
                  <p>
                    {order.maintenancePlanCode
                      ? `Heredada de ${order.maintenancePlanCode}`
                      : "Tareas de la intervención"}
                  </p>
                </div>
                <ClipboardCheck size={17} />
              </div>
              <ol className="plan-task-list work-order-task-list">
                {data.tasks.map((task) => (
                  <li
                    className={task.completedAt ? "completed" : ""}
                    key={task.id}
                  >
                    <span>
                      {task.completedAt
                        ? "✓"
                        : String(task.sequence).padStart(2, "0")}
                    </span>
                    <div>
                      <strong>{task.title}</strong>
                      <small>
                        {task.completedAt
                          ? `Completada ${formatDateTime(task.completedAt)}${task.completedBy ? ` · ${task.completedBy}` : ""}`
                          : (task.description ?? "Pendiente de ejecución")}
                      </small>
                    </div>
                    <em>{task.required ? "Obligatoria" : "Opcional"}</em>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section className="data-panel diagnosis-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Conocimiento de la intervención</p>
                <h2>Diagnóstico y solución</h2>
              </div>
              <Stethoscope size={17} />
            </div>
            <div className="knowledge-grid">
              <div>
                <span>
                  <Activity size={15} /> Diagnóstico
                </span>
                <p>
                  {order.diagnosis ??
                    "Pendiente de confirmar durante la ejecución."}
                </p>
              </div>
              <div>
                <span>
                  <Wrench size={15} /> Solución documentada
                </span>
                <p>
                  {order.solution ??
                    "La solución se documentará antes de completar la intervención."}
                </p>
              </div>
              <div>
                <span>Modo de fallo</span>
                <strong>
                  {order.failureModeName ??
                    (order.failureMode
                      ? (failureModeLabels[order.failureMode] ??
                        order.failureMode)
                      : "Sin clasificar")}
                </strong>
              </div>
              <div>
                <span>Causa</span>
                <strong>
                  {order.failureCause
                    ? (failureCauseLabels[order.failureCause] ??
                      order.failureCause)
                    : "Pendiente de RCA"}
                </strong>
              </div>
            </div>
          </section>

          <section className="data-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Ejecución</p>
                <h2>Registro de trabajo</h2>
              </div>
              <UsersRound size={17} />
            </div>
            {data.labor.length ? (
              <div className="labor-list">
                {data.labor.map((entry) => (
                  <div key={entry.id}>
                    <span className="labor-avatar">
                      {entry.userName
                        .split(" ")
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <span>
                      <strong>{entry.userName}</strong>
                      <small>{entry.note ?? "Intervención registrada"}</small>
                    </span>
                    <span>
                      <strong>{formatDuration(entry.minutes)}</strong>
                      <small>
                        {formatDateTime(entry.startedAt)} →{" "}
                        {formatDateTime(entry.endedAt)}
                      </small>
                    </span>
                  </div>
                ))}
                <footer>
                  <span>
                    Mano de obra registrada ·{" "}
                    {formatDuration(data.laborMinutes)}
                  </span>
                  <strong>{formatCurrency(data.costs.labor)}</strong>
                </footer>
              </div>
            ) : (
              <EmptyState
                description="Todavía no hay sesiones de trabajo imputadas."
                title="Sin mano de obra registrada"
              />
            )}
          </section>

          {data.measurements.length || data.evidence.length ? (
            <section className="data-panel field-trace-panel">
              <div className="panel-title-row">
                <div>
                  <p className="overline">Ejecución de campo</p>
                  <h2>Mediciones y evidencias</h2>
                </div>
                <Camera size={17} />
              </div>
              {data.measurements.length ? (
                <div className="desktop-measurement-grid">
                  {data.measurements.map((item) => (
                    <article key={item.id}>
                      <Gauge size={15} />
                      <span>
                        <small>{item.label}</small>
                        <strong>
                          {item.value} {item.unit}
                        </strong>
                      </span>
                      <em
                        className={
                          item.result === "OUT_OF_RANGE" ? "critical" : ""
                        }
                      >
                        {item.result === "IN_RANGE"
                          ? "En rango"
                          : item.result === "OUT_OF_RANGE"
                            ? "Fuera de rango"
                            : "Informativa"}
                      </em>
                    </article>
                  ))}
                </div>
              ) : null}
              {data.evidence.length ? (
                <div className="desktop-evidence-list">
                  {data.evidence.map((item) => (
                    <article key={item.id}>
                      <Camera size={15} />
                      <span>
                        <strong>{item.description}</strong>
                        <small>
                          {item.stage} · {item.authorName} ·{" "}
                          {formatDateTime(item.createdAt)}
                        </small>
                      </span>
                      {item.contentHref ? (
                        <a href={item.contentHref}>Abrir {item.fileName}</a>
                      ) : (
                        <em>Nota de campo</em>
                      )}
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="data-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Materiales</p>
                <h2>Materiales de la intervención</h2>
              </div>
              <PackageCheck size={17} />
            </div>
            <MaterialWorkspace
              canConsume={
                materialOperationsAllowed && can(session, "MATERIAL_CONSUME")
              }
              canPlan={
                materialOperationsAllowed && can(session, "MATERIAL_PLAN")
              }
              canReserve={
                materialOperationsAllowed && can(session, "MATERIAL_RESERVE")
              }
              canRequest={
                materialOperationsAllowed &&
                can(session, "PURCHASE_REQUISITION_CREATE")
              }
              number={order.number}
              options={data.materialOptions}
              plans={data.materialPlans}
            />
            {data.procurementLinks.length ? (
              <div className="wo-procurement-links">
                {data.procurementLinks.map((item) => (
                  <Link
                    href={
                      item.purchaseOrderNumber
                        ? `/procurement/purchase-orders/${encodeURIComponent(item.purchaseOrderNumber)}`
                        : `/procurement/requisitions/${encodeURIComponent(item.requisitionNumber)}`
                    }
                    key={item.id}
                  >
                    <span>
                      <small>
                        {item.requisitionNumber} · {item.requisitionStatus}
                      </small>
                      <strong>{item.partSummary}</strong>
                    </span>
                    <em>
                      {item.purchaseOrderNumber
                        ? `${item.purchaseOrderNumber} · ${item.purchaseOrderStatus}`
                        : "Pendiente de pedido"}
                    </em>
                  </Link>
                ))}
              </div>
            ) : null}
            {data.materials.length ? (
              <div className="material-list">
                {data.materials.map((material) => (
                  <div key={material.id}>
                    <span>
                      <small>
                        {material.usageType === "RETURN"
                          ? "Devolución"
                          : "Consumo"}{" "}
                        · {material.sku}
                      </small>
                      <strong>{material.partName}</strong>
                    </span>
                    <span>
                      <small>Movimiento</small>
                      <strong className="mono">{material.movementId}</strong>
                    </span>
                    <span>
                      <strong>
                        {material.usageType === "RETURN" ? "−" : ""}
                        {material.quantity} {material.unit}
                      </strong>
                      <small>
                        {formatCurrency(material.unitCost)} / {material.unit}
                      </small>
                    </span>
                    <strong>{formatCurrency(material.totalCost)}</strong>
                  </div>
                ))}
                <footer>
                  <span>Coste histórico de material</span>
                  <strong>{formatCurrency(data.materialCost)}</strong>
                </footer>
              </div>
            ) : (
              <EmptyState
                description="Ninguna pieza ha salido de almacén para esta orden."
                title="Sin consumos de material"
              />
            )}
          </section>

          <section className="data-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Impacto productivo</p>
                <h2>Downtime vinculado</h2>
              </div>
              <TimerOff size={17} />
            </div>
            <DowntimeWorkspace
              canManage={
                downtimeOperationsAllowed && can(session, "DOWNTIME_MANAGE")
              }
              entries={data.downtime}
              number={order.number}
            />
          </section>
        </div>

        <aside className="detail-rail">
          <section className="data-panel detail-facts">
            <div className="panel-title-row">
              <div>
                <p className="overline">Coste histórico</p>
                <h2>Coste de intervención</h2>
              </div>
              <CircleDollarSign size={16} />
            </div>
            <dl>
              <div>
                <dt>Mano de obra</dt>
                <dd>{formatCurrency(data.costs.labor)}</dd>
              </div>
              <div>
                <dt>MRO consumido</dt>
                <dd>{formatCurrency(data.costs.material)}</dd>
              </div>
              <div>
                <dt>Proveedor / otros</dt>
                <dd>{formatCurrency(data.costs.explicit)}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>
                  <strong>{formatCurrency(data.costs.total)}</strong>
                </dd>
              </div>
            </dl>
            {data.costItems.length ? (
              <div className="work-cost-history">
                {data.costItems.map((item) => (
                  <div key={item.id}>
                    <span>
                      <strong>{item.description}</strong>
                      <small>
                        {item.vendorName ?? item.kind} ·{" "}
                        {formatDateTime(item.recordedAt)}
                      </small>
                    </span>
                    <b>{formatCurrency(item.amountCents / 100)}</b>
                  </div>
                ))}
              </div>
            ) : null}
            {session.permissionCodes.includes("workorder.close") &&
            !["CLOSED", "CANCELLED"].includes(order.status) ? (
              <WorkOrderCostForm
                number={order.number}
                vendors={data.costVendors}
              />
            ) : null}
          </section>
          {order.safetyLevel !== "STANDARD" ? (
            <section className="data-panel desktop-safety-card">
              <div className="panel-title-row">
                <div>
                  <p className="overline">Seguridad de campo</p>
                  <h2>
                    {order.safetyLevel === "CRITICAL"
                      ? "Intervención crítica"
                      : "Con precauciones"}
                  </h2>
                </div>
                <ShieldAlert size={17} />
              </div>
              <p>{order.safetySummary}</p>
              <dl>
                <div>
                  <dt>EPI</dt>
                  <dd>{order.ppeRequired ?? "Estándar"}</dd>
                </div>
                <div>
                  <dt>Aislamiento</dt>
                  <dd>
                    {order.isolationRequired ? "Obligatorio" : "No requerido"}
                  </dd>
                </div>
              </dl>
              <span
                className={data.safetyAcknowledged ? "confirmed" : "pending"}
              >
                {data.safetyAcknowledged
                  ? "Confirmada por el usuario actual"
                  : "Pendiente de confirmación"}
              </span>
            </section>
          ) : null}
          <section className="data-panel detail-facts">
            <div className="panel-title-row">
              <div>
                <p className="overline">Contexto</p>
                <h2>Orden y responsables</h2>
              </div>
              <FileText size={16} />
            </div>
            <dl>
              <div>
                <dt>
                  <Boxes size={14} /> Activo
                </dt>
                <dd>
                  <Link href={`/assets/${encodeURIComponent(order.assetCode)}`}>
                    {order.assetCode} · {order.assetName}
                  </Link>
                  <small>
                    Health {order.assetHealthScore} ·{" "}
                    {statusLabels[order.assetStatus] ?? order.assetStatus}
                  </small>
                </dd>
              </div>
              <div>
                <dt>
                  <MapPin size={14} /> Ubicación
                </dt>
                <dd>
                  {order.locationName}
                  <small>{order.locationCode}</small>
                </dd>
              </div>
              <div>
                <dt>
                  <UserRound size={14} /> Responsable
                </dt>
                <dd>
                  {data.assignments.length
                    ? data.assignments.map((item) => item.userName).join(", ")
                    : "Sin asignar"}
                  <small>
                    {data.assignments.length} técnico
                    {data.assignments.length === 1 ? "" : "s"} asignado
                    {data.assignments.length === 1 ? "" : "s"}
                  </small>
                </dd>
              </div>
              {order.incidentNumber ? (
                <div>
                  <dt>Incidencia origen</dt>
                  <dd>
                    <Link href={`/incidents/${order.incidentNumber}`}>
                      {order.incidentNumber}
                    </Link>
                  </dd>
                </div>
              ) : null}
              {order.maintenancePlanCode ? (
                <div>
                  <dt>
                    <Repeat2 size={14} /> Plan preventivo
                  </dt>
                  <dd>
                    <Link
                      href={`/maintenance-plans/${encodeURIComponent(order.maintenancePlanCode)}`}
                    >
                      {order.maintenancePlanCode}
                    </Link>
                    <small>{order.maintenancePlanTitle}</small>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Solicitante</dt>
                <dd>{order.requesterName}</dd>
              </div>
              <div>
                <dt>Solicitada</dt>
                <dd>{formatDateTime(order.requestedAt)}</dd>
              </div>
              <div>
                <dt>Planificada</dt>
                <dd>
                  {formatDateTime(order.plannedStart)}
                  <small>hasta {formatDateTime(order.plannedEnd)}</small>
                </dd>
              </div>
              <div>
                <dt>Inicio real</dt>
                <dd>{formatDateTime(order.actualStart)}</dd>
              </div>
              <div>
                <dt>Fin real</dt>
                <dd>{formatDateTime(order.actualEnd)}</dd>
              </div>
            </dl>
          </section>

          {data.skillRequirements.length ||
          data.certificationRequirements.length ? (
            <section className="data-panel work-requirements-card">
              <div className="panel-title-row">
                <div>
                  <p className="overline">Competencia</p>
                  <h2>Requisitos de ejecución</h2>
                </div>
                <UsersRound size={16} />
              </div>
              <div className="resource-chip-list">
                {data.skillRequirements.map((skill) => (
                  <span key={skill.id}>
                    {skill.code} · nivel {skill.minimumLevel}
                  </span>
                ))}
                {data.certificationRequirements.map((item) => (
                  <span className="cert" key={item.id}>
                    {item.code}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          <section className="data-panel event-timeline-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Trazabilidad</p>
                <h2>Timeline</h2>
              </div>
              <MessageSquareText size={16} />
            </div>
            <div className="event-timeline">
              {data.events.map((event) => (
                <div key={event.id}>
                  <i />
                  <span>
                    <strong>
                      {workOrderEventLabels[event.eventType] ??
                        "Actividad registrada"}
                    </strong>
                    <small>{event.note}</small>
                    <em>
                      {event.actorName} · {formatDateTime(event.createdAt)}
                    </em>
                  </span>
                  {event.toStatus ? (
                    <StatusBadge value={event.toStatus} />
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
