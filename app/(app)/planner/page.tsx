import { tenantScope } from "@/lib/server/repositories/shared";
import { env } from "cloudflare:workers";
import {
  ArrowLeft,
  ArrowRight,
  CalendarRange,
  Clock3,
  Radio,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PlannerBoard } from "@/components/planner/planner-board";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/domain/permissions";
import { hasPermission } from "@/lib/domain/governance";
import { requireDemoSession } from "@/lib/server/auth";
import { getPlannerData } from "@/lib/server/repositories/planner";
import { getActiveFieldTechnicians } from "@/lib/server/repositories/field";

function shiftWeek(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string | string[] }>;
}) {
  const params = await searchParams;
  const requestedWeek =
    typeof params.week === "string" ? params.week : undefined;
  const session = await requireDemoSession();
  if (!hasPermission(session.permissionCodes, "planning.manage"))
    redirect("/overview");
  const scope = tenantScope(session);
  const [data, activeField] = await Promise.all([
    getPlannerData(scope, session.userId, requestedWeek, env.MAZMI_TEST_NOW),
    getActiveFieldTechnicians(scope),
  ]);
  const plannedMinutes = data.capacity.reduce(
    (total, item) => total + item.plannedMinutes,
    0,
  );
  const conflicts = data.workOrders.reduce(
    (total, item) => total + item.conflicts.length,
    0,
  );

  return (
    <div className="page-stack planner-page">
      <PageHeader
        actions={
          <div className="planner-week-control">
            <Link
              aria-label="Semana anterior"
              href={{
                pathname: "/planner",
                query: { week: shiftWeek(data.weekStart, -7) },
              }}
            >
              <ArrowLeft size={15} />
            </Link>
            <span>
              <small>Semana</small>
              <strong>
                {data.weekStart} — {shiftWeek(data.weekEnd, -1)}
              </strong>
            </span>
            <Link
              aria-label="Semana siguiente"
              href={{
                pathname: "/planner",
                query: { week: shiftWeek(data.weekStart, 7) },
              }}
            >
              <ArrowRight size={15} />
            </Link>
          </div>
        }
        description="Capacidad, skills y trabajo preventivo en una única vista operacional persistente."
        eyebrow={`${session.siteCode} · Workforce`}
        title="Planner de mantenimiento"
      />
      <section className="planner-summary-strip">
        <div>
          <CalendarRange size={16} />
          <span>
            <strong>{data.workOrders.length}</strong>
            <small>trabajos en semana</small>
          </span>
        </div>
        <div>
          <UsersRound size={16} />
          <span>
            <strong>{data.technicians.length}</strong>
            <small>técnicos disponibles</small>
          </span>
        </div>
        <div>
          <Clock3 size={16} />
          <span>
            <strong>{(plannedMinutes / 60).toFixed(1)} h</strong>
            <small>carga planificada</small>
          </span>
        </div>
        <div className={conflicts ? "attention" : ""}>
          <span className="summary-signal" />
          <span>
            <strong>{conflicts}</strong>
            <small>conflictos detectados</small>
          </span>
        </div>
      </section>
      {activeField.length ? (
        <section className="planner-field-strip">
          <header>
            <Radio size={15} />
            <span>
              <strong>Trabajo activo en planta</strong>
              <small>Sesiones confirmadas ahora</small>
            </span>
          </header>
          <div>
            {activeField.map((item) => {
              const progress = item.requiredTasks
                ? Math.round((item.completedTasks / item.requiredTasks) * 100)
                : 0;
              return (
                <Link
                  href={`/work-orders/${encodeURIComponent(item.workOrderNumber)}`}
                  key={`${item.userId}-${item.workOrderNumber}`}
                >
                  <span className="labor-avatar">{item.initials}</span>
                  <span>
                    <strong>{item.fullName}</strong>
                    <small>
                      {item.workOrderNumber} · {item.workOrderTitle}
                    </small>
                  </span>
                  <span>
                    <i>
                      <b style={{ width: `${progress}%` }} />
                    </i>
                    <small>
                      {item.completedTasks}/{item.requiredTasks} pasos
                    </small>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
      <PlannerBoard canManage={can(session, "PLANNER_MANAGE")} data={data} />
    </div>
  );
}
