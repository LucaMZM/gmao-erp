import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Handshake,
  Hourglass,
  MapPin,
  Play,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { FieldQuickActions } from "@/components/field/field-quick-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatDateTime,
  formatDuration,
  statusLabels,
} from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import { getMyWork, type MyWorkItem } from "@/lib/server/repositories/field";
import { getIncidentOptions } from "@/lib/server/repositories/incidents";
import { tenantScope } from "@/lib/server/repositories/shared";

function WorkCard({
  item,
  tone,
}: {
  item: MyWorkItem;
  tone?: "urgent" | "current";
}) {
  const progress = item.requiredTasks
    ? Math.round((item.completedTasks / item.requiredTasks) * 100)
    : 0;
  return (
    <Link
      className={`field-work-card ${tone ?? ""}`}
      href={`/my-work/${encodeURIComponent(item.number)}`}
    >
      <span className="field-work-card-head">
        <span>
          <small>
            {item.number} ·{" "}
            {item.type === "PREVENTIVE" ? "Preventivo" : "Correctivo"}
          </small>
          <strong>{item.title}</strong>
        </span>
        <StatusBadge kind="priority" value={item.priority} />
      </span>
      <span className="field-work-context">
        <Wrench size={14} />
        <strong>{item.assetCode}</strong>
        <span>{item.assetName}</span>
      </span>
      <span className="field-work-context">
        <MapPin size={14} />
        <span>{item.locationName}</span>
      </span>
      <span className="field-work-meta">
        <span>
          <Clock3 size={13} /> {formatDateTime(item.plannedStart ?? item.dueAt)}
        </span>
        <span>{formatDuration(item.estimatedMinutes)}</span>
        {item.safetyLevel !== "STANDARD" ? (
          <span className="field-safety-mini">
            <ShieldCheck size={13} />{" "}
            {item.safetyLevel === "CRITICAL"
              ? "Seguridad crítica"
              : "Precauciones"}
          </span>
        ) : null}
      </span>
      {item.requiredTasks ? (
        <span className="field-task-progress">
          <i>
            <b style={{ width: `${progress}%` }} />
          </i>
          <small>
            {item.completedTasks}/{item.requiredTasks} pasos
          </small>
        </span>
      ) : null}
      <span className="field-work-card-foot">
        <span>{statusLabels[item.status] ?? item.status}</span>
        <ArrowRight size={15} />
      </span>
    </Link>
  );
}

function WorkSection({
  eyebrow,
  title,
  items,
  icon,
}: {
  eyebrow: string;
  title: string;
  items: MyWorkItem[];
  icon: ReactNode;
}) {
  if (!items.length) return null;
  return (
    <section className="field-work-section">
      <header>
        <span>{icon}</span>
        <div>
          <p className="overline">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <strong>{items.length}</strong>
      </header>
      <div className="field-work-list">
        {items.map((item) => (
          <WorkCard item={item} key={item.id} />
        ))}
      </div>
    </section>
  );
}

export default async function MyWorkPage() {
  const session = await requireDemoSession();
  const scope = tenantScope(session);
  const [data, options] = await Promise.all([
    getMyWork(scope, session.userId),
    getIncidentOptions(scope),
  ]);
  const related = [...data.today, ...data.waiting]
    .filter(
      (item, index, all) =>
        all.findIndex((entry) => entry.id === item.id) === index,
    )
    .map((item) => ({ number: item.number, title: item.title }));

  return (
    <div className="page-stack field-home-page">
      <header className="field-home-hero">
        <div>
          <p className="overline">{session.siteCode} · Ejecución de campo</p>
          <h1>Buenos días, {session.fullName.split(" ")[0]}</h1>
          <p>
            {data.profile
              ? `Turno ${data.profile.shiftCode} · ${data.profile.shiftStart}–${data.profile.shiftEnd}`
              : session.roleName}{" "}
            · {data.today.length} trabajos en tu agenda
          </p>
        </div>
        <span className="field-shift-state">
          <i />
          {data.profile?.availabilityStatus === "AVAILABLE"
            ? "Disponible"
            : (data.profile?.availabilityStatus ?? "En planta")}
        </span>
      </header>

      <FieldQuickActions
        assets={options.assets}
        locations={options.locations}
        shiftCode={data.profile?.shiftCode ?? "M1"}
        workOrders={related}
      />

      {data.current ? (
        <section className="field-current-work">
          <header>
            <span>
              <Play size={16} /> Trabajo actual
            </span>
            <strong>Sesión activa</strong>
          </header>
          <WorkCard item={data.current} tone="current" />
        </section>
      ) : null}

      {data.urgent.length ? (
        <section className="field-urgent-strip">
          <header>
            <AlertCircle size={16} />
            <span>
              <strong>Atención prioritaria</strong>
              <small>Trabajos P1/P2 dentro de tu scope</small>
            </span>
          </header>
          <div>
            {data.urgent.slice(0, 2).map((item) => (
              <WorkCard item={item} key={item.id} tone="urgent" />
            ))}
          </div>
        </section>
      ) : null}

      <div className="field-home-grid">
        <div className="field-home-primary">
          <WorkSection
            eyebrow="Agenda operativa"
            icon={<CalendarDays size={17} />}
            items={data.today}
            title="Hoy"
          />
          <WorkSection
            eyebrow="Siguiente ventana"
            icon={<Clock3 size={17} />}
            items={data.upcoming}
            title="Próximos trabajos"
          />
          <WorkSection
            eyebrow="Bloqueos"
            icon={<Hourglass size={17} />}
            items={data.waiting}
            title="En espera"
          />
          <WorkSection
            eyebrow="Trazabilidad"
            icon={<CheckCircle2 size={17} />}
            items={data.recent}
            title="Finalizados recientemente"
          />
        </div>
        <aside className="field-handover-feed">
          <header>
            <Handshake size={17} />
            <div>
              <p className="overline">Continuidad</p>
              <h2>Relevo recibido</h2>
            </div>
          </header>
          {data.handovers.length ? (
            data.handovers.map((item) => (
              <article key={item.id}>
                <span>
                  <strong>
                    {item.fromShift} → {item.toShift}
                  </strong>
                  <small>{formatDateTime(item.createdAt)}</small>
                </span>
                <p>{item.summary}</p>
                {item.risks ? (
                  <em>
                    <AlertCircle size={13} /> {item.risks}
                  </em>
                ) : null}
                {item.partsPending ? (
                  <small>Material: {item.partsPending}</small>
                ) : null}
                {item.workOrders ? <small>OT: {item.workOrders}</small> : null}
                <footer>{item.authorName}</footer>
              </article>
            ))
          ) : (
            <p className="field-empty-copy">
              No hay mensajes pendientes del turno anterior.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
