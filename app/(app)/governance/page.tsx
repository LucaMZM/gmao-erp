import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { hasPermission, integrityStatus } from "@/lib/domain/governance";
import { formatDuration } from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import { getGovernanceData } from "@/lib/server/repositories/governance";

function time(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export default async function GovernancePage() {
  const session = await requireDemoSession();
  if (!hasPermission(session.permissionCodes, "governance.read"))
    redirect("/overview");
  const data = await getGovernanceData(session);
  const status = integrityStatus(data.integrity);
  return (
    <div className="page-stack governance-page">
      <PageHeader
        description="Calendario productivo, turnos, acceso e integridad sin reparación silenciosa."
        eyebrow={`${session.siteCode} · Enterprise control`}
        title="Gobierno operativo"
      />
      <section className={`governance-health ${status.state.toLowerCase()}`}>
        <span>
          {status.state === "HEALTHY" ? (
            <CheckCircle2 size={24} />
          ) : (
            <AlertTriangle size={24} />
          )}
        </span>
        <div>
          <p className="overline">Diagnóstico de integridad</p>
          <h2>
            {status.state === "HEALTHY"
              ? "Todos los invariantes están limpios"
              : "La planta requiere revisión"}
          </h2>
          <p>
            {status.critical} hallazgos críticos · {status.warning}{" "}
            advertencias. Este panel nunca modifica datos automáticamente.
          </p>
        </div>
      </section>
      <section className="governance-grid">
        <article className="data-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Exposición productiva</p>
              <h2>
                <CalendarDays size={18} /> Calendarios
              </h2>
            </div>
          </div>
          {data.calendars.map((calendar) => (
            <div className="governance-row" key={calendar.id}>
              <span>
                <strong>{calendar.name}</strong>
                <small>{calendar.exceptions} excepciones registradas</small>
              </span>
              <b>{formatDuration(calendar.weeklyMinutes)} / semana</b>
            </div>
          ))}
        </article>
        <article className="data-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Capacidad formal</p>
              <h2>
                <UsersRound size={18} /> Turnos
              </h2>
            </div>
          </div>
          {data.shifts.map((shift) => (
            <div className="governance-row" key={shift.code}>
              <span>
                <strong>
                  {shift.code} · {shift.team}
                </strong>
                <small>
                  {time(shift.startMinute)}–{time(shift.endMinute)} ·{" "}
                  {shift.assigned} personas
                </small>
              </span>
              <b>{formatDuration(shift.capacityMinutes)}</b>
            </div>
          ))}
        </article>
      </section>
      <section className="data-panel">
        <div className="panel-title-row">
          <div>
            <p className="overline">Checks internos</p>
            <h2>Invariantes por centro</h2>
          </div>
          <span className="governance-seal">
            <ShieldCheck size={15} /> Diagnóstico
          </span>
        </div>
        <div className="integrity-grid">
          {data.integrity.map((finding) => (
            <article
              className={finding.count ? "finding active" : "finding"}
              key={finding.code}
            >
              <span>
                {finding.count ? (
                  <AlertTriangle size={16} />
                ) : (
                  <CheckCircle2 size={16} />
                )}
              </span>
              <div>
                <strong>{finding.title}</strong>
                <small>
                  {finding.count ? finding.guidance : "Sin hallazgos"}
                </small>
              </div>
              <b>{finding.count}</b>
            </article>
          ))}
        </div>
      </section>
      <section className="data-panel">
        <div className="panel-title-row">
          <div>
            <p className="overline">Least privilege</p>
            <h2>Scopes efectivos en {session.siteShortName}</h2>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Perfil</th>
                <th>Áreas</th>
                <th>Almacenes</th>
              </tr>
            </thead>
            <tbody>
              {data.scopes.map((scope) => (
                <tr key={`${scope.userName}-${scope.roleName}`}>
                  <td>
                    <strong>{scope.userName}</strong>
                  </td>
                  <td>{scope.roleName}</td>
                  <td>
                    {scope.fullAreaAccess ? "Toda la planta" : scope.areas}
                  </td>
                  <td>
                    {scope.fullWarehouseAccess ? "Todos" : scope.warehouses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
