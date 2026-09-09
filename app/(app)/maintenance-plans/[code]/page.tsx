import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  PackageSearch,
  ShieldCheck,
  UserRoundCog,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MaintenancePlanActions } from "@/components/preventive/maintenance-plan-actions";
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
import { getMaintenancePlanDetail } from "@/lib/server/repositories/preventive";

export default async function MaintenancePlanDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const session = await requireDemoSession();
  if (!hasPermission(session.permissionCodes, "preventive.manage"))
    redirect("/overview");
  const code = decodeURIComponent((await params).code);
  const data = await getMaintenancePlanDetail(
    { organizationId: session.organizationId, siteId: session.siteId },
    code,
  );
  if (!data) notFound();
  const plan = data.plan;
  const now = new Date().toISOString();
  const meterDue =
    plan.meterValue !== null &&
    plan.meterThreshold !== null &&
    plan.meterValue >= plan.meterThreshold;
  const due =
    plan.status === "ACTIVE" &&
    (meterDue || (plan.nextDueAt !== null && plan.nextDueAt <= now));
  const calendarFrequency =
    plan.calendarInterval && plan.calendarUnit
      ? `Cada ${plan.calendarInterval} ${calendarUnitLabels[plan.calendarUnit]}`
      : null;

  return (
    <div className="page-stack maintenance-plan-detail-page">
      <Link className="back-link" href="/maintenance-plans">
        <ArrowLeft size={15} /> Volver a planes
      </Link>
      <PageHeader
        description={plan.description}
        eyebrow={`${plan.code} · ${session.siteCode}`}
        title={plan.title}
      />

      <section className={due ? "plan-command-bar is-due" : "plan-command-bar"}>
        <div className="plan-command-identity">
          <div className="plan-command-icon">
            <CalendarClock size={23} />
          </div>
          <div>
            <span className="plan-badge-line">
              <StatusBadge value={plan.status} />
              <StatusBadge kind="criticality" value={plan.criticality} />
              <StatusBadge kind="priority" value={plan.priority} />
            </span>
            <strong>
              {due ? "Intervención requerida" : "Estrategia bajo control"}
            </strong>
            <small>
              {due
                ? meterDue
                  ? "El contador ha alcanzado el umbral configurado."
                  : `Ventana vencida · ${formatDateTime(plan.nextDueAt)}`
                : `Próxima ejecución · ${formatDateTime(plan.nextDueAt)}`}
            </small>
          </div>
        </div>
        <MaintenancePlanActions
          canGenerate={can(session, "MAINTENANCE_PLAN_GENERATE")}
          canManage={can(session, "MAINTENANCE_PLAN_MANAGE")}
          canRecordMeter={can(session, "METER_RECORD")}
          code={plan.code}
          meter={
            plan.meterId && plan.meterCode && plan.meterUnit
              ? {
                  id: plan.meterId,
                  code: plan.meterCode,
                  unit: plan.meterUnit,
                  lastValue: plan.meterValue,
                }
              : null
          }
          status={plan.status}
          version={plan.version}
        />
      </section>

      <div className="plan-detail-layout">
        <main className="plan-detail-main">
          <section className="data-panel plan-checklist-panel">
            <header className="panel-heading">
              <div>
                <ClipboardCheck size={17} />
                <span>
                  <strong>Trabajo estándar</strong>
                  <small>{data.tasks.length} tareas heredables por OT</small>
                </span>
              </div>
              <strong>{formatDuration(plan.estimatedMinutes)}</strong>
            </header>
            <ol className="plan-task-list">
              {data.tasks.map((task) => (
                <li key={task.id}>
                  <span>{String(task.sequence).padStart(2, "0")}</span>
                  <div>
                    <strong>{task.title}</strong>
                    {task.description ? (
                      <small>{task.description}</small>
                    ) : null}
                  </div>
                  {task.required ? <em>Obligatoria</em> : <em>Opcional</em>}
                </li>
              ))}
            </ol>
          </section>

          <section className="data-panel plan-history-panel">
            <header className="panel-heading">
              <div>
                <Wrench size={17} />
                <span>
                  <strong>Órdenes generadas</strong>
                  <small>Trazabilidad por ventana preventiva</small>
                </span>
              </div>
              <span className="panel-count">{data.workOrders.length}</span>
            </header>
            <div className="plan-order-list">
              {data.workOrders.length ? (
                data.workOrders.map((order) => (
                  <Link
                    href={`/work-orders/${encodeURIComponent(order.number)}`}
                    key={order.id}
                  >
                    <span>
                      <small>{order.number}</small>
                      <strong>{formatDateTime(order.dueAt)}</strong>
                    </span>
                    <span>
                      <StatusBadge value={order.status} />
                      <small>{order.assigneeName ?? "Sin asignar"}</small>
                    </span>
                  </Link>
                ))
              ) : (
                <p className="inline-empty">
                  Todavía no se ha generado ninguna OT.
                </p>
              )}
            </div>
          </section>

          {plan.meterId ? (
            <section className="data-panel meter-history-panel">
              <header className="panel-heading">
                <div>
                  <Gauge size={17} />
                  <span>
                    <strong>Histórico de contador</strong>
                    <small>
                      {plan.meterCode} · {plan.meterUnit}
                    </small>
                  </span>
                </div>
                <strong>
                  {plan.meterValue ?? "—"} {plan.meterUnit}
                </strong>
              </header>
              <div className="meter-reading-list">
                {data.readings.map((reading) => (
                  <div key={reading.id}>
                    <span>
                      <strong>
                        {new Intl.NumberFormat("es-ES").format(reading.value)}{" "}
                        {plan.meterUnit}
                      </strong>
                      <small>{reading.note ?? reading.source}</small>
                    </span>
                    <span>
                      <strong>{formatDateTime(reading.recordedAt)}</strong>
                      <small>{reading.recordedBy}</small>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </main>

        <aside className="plan-detail-rail">
          <section className="data-panel plan-strategy-card">
            <header>
              <CalendarClock size={17} />
              <strong>Estrategia</strong>
            </header>
            <dl>
              <div>
                <dt>Disparador</dt>
                <dd>{preventiveTriggerLabels[plan.triggerMode]}</dd>
              </div>
              {calendarFrequency ? (
                <div>
                  <dt>Calendario</dt>
                  <dd>{calendarFrequency}</dd>
                </div>
              ) : null}
              {plan.meterThreshold !== null ? (
                <div>
                  <dt>Umbral</dt>
                  <dd>
                    {new Intl.NumberFormat("es-ES").format(plan.meterThreshold)}{" "}
                    {plan.meterUnit}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Antelación</dt>
                <dd>{plan.leadDays} días</dd>
              </div>
              <div>
                <dt>Prioridad</dt>
                <dd>{priorityLabels[plan.priority]}</dd>
              </div>
              <div>
                <dt>Última ejecución</dt>
                <dd>{formatDateTime(plan.lastExecutedAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="data-panel plan-context-card">
            <header>
              <ShieldCheck size={17} />
              <strong>Contexto industrial</strong>
            </header>
            <Link href={`/assets/${encodeURIComponent(plan.assetCode)}`}>
              <small>Activo</small>
              <strong>
                {plan.assetCode} · {plan.assetName}
              </strong>
              <span>{plan.locationName}</span>
            </Link>
            <div>
              <UserRoundCog size={15} />
              <span>
                <small>Responsable</small>
                <strong>{plan.ownerName}</strong>
              </span>
            </div>
          </section>

          <section className="data-panel plan-resource-card">
            <header>
              <PackageSearch size={17} />
              <strong>Recursos previstos</strong>
            </header>
            <div className="resource-chip-list">
              {data.skills.map((skill) => (
                <span key={skill.id}>
                  {skill.code} · nivel {skill.minimumLevel}
                </span>
              ))}
              {data.certifications.map((item) => (
                <span className="cert" key={item.id}>
                  {item.code}
                </span>
              ))}
            </div>
            <div className="plan-material-list">
              {data.materials.length ? (
                data.materials.map((material) => (
                  <div key={material.id}>
                    <span>
                      <strong>{material.sku}</strong>
                      <small>{material.name}</small>
                    </span>
                    <span>
                      <strong>
                        {material.quantity} {material.unit}
                      </strong>
                      <small>{material.available} disponibles</small>
                    </span>
                  </div>
                ))
              ) : (
                <small>Sin materiales estándar previstos.</small>
              )}
            </div>
          </section>

          <section className="plan-integrity-note">
            <CheckCircle2 size={15} />
            <span>
              <strong>Ventanas idempotentes</strong>
              <small>Un mismo vencimiento no puede generar dos OTs.</small>
            </span>
          </section>
        </aside>
      </div>
    </div>
  );
}
