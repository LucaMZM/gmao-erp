"use client";

import {
  AlertTriangle,
  CalendarDays,
  GripVertical,
  MoreHorizontal,
  MoveRight,
  RotateCcw,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  formatDateTime,
  formatDuration,
  statusLabels,
} from "@/lib/presentation";
import type {
  PlannerData,
  PlannerWorkOrder,
} from "@/lib/server/repositories/planner";

const bucketLabels = {
  UNPLANNED: "Sin planificar",
  PLANNED: "Planificadas",
  SCHEDULED: "Programadas",
  OVERDUE: "Vencidas",
} as const;

export function PlannerBoard({
  data,
  canManage,
}: {
  data: PlannerData;
  canManage: boolean;
}) {
  const router = useRouter();
  const [bucket, setBucket] = useState<keyof typeof bucketLabels>("OVERDUE");
  const [dragged, setDragged] = useState<string | null>(null);
  const [overTarget, setOverTarget] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editOrder, setEditOrder] = useState<PlannerWorkOrder | null>(null);
  const [editDate, setEditDate] = useState(data.days[0]?.date ?? "");
  const [editTechnician, setEditTechnician] = useState("");
  const allOrders = useMemo(() => {
    const map = new Map<string, PlannerWorkOrder>();
    for (const order of [...data.workOrders, ...data.backlog])
      map.set(order.number, order);
    return map;
  }, [data.backlog, data.workOrders]);
  const visibleBacklog = data.backlog.filter(
    (order) => order.backlogBucket === bucket,
  );

  const move = async (
    order: PlannerWorkOrder,
    technicianId: string | null,
    date: string | null,
  ) => {
    if (!canManage || pending) return;
    setPending(order.number);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/planner/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          number: order.number,
          expectedVersion: order.version,
          technicianId,
          date,
        }),
      });
      const payload = (await response.json()) as {
        data?: { conflicts: Array<{ message: string }> };
        error?: { message: string };
      };
      if (!response.ok) {
        setError(payload.error?.message ?? "No se ha podido mover la orden.");
        return;
      }
      const warnings =
        payload.data?.conflicts.map((item) => item.message) ?? [];
      setNotice(
        warnings.length
          ? `Cambio guardado con aviso: ${warnings.join(" ")}`
          : "Planificación actualizada y persistida.",
      );
      setEditOrder(null);
      router.refresh();
    } catch {
      setError("El servicio de planificación no está disponible.");
    } finally {
      setPending(null);
      setDragged(null);
      setOverTarget(null);
    }
  };

  const drop = (
    event: React.DragEvent,
    technicianId: string | null,
    date: string | null,
  ) => {
    event.preventDefault();
    const number = event.dataTransfer.getData("text/plain") || dragged;
    const order = number ? allOrders.get(number) : null;
    if (order) void move(order, technicianId, date);
  };

  const renderCard = (order: PlannerWorkOrder, compact = false) => (
    <article
      className={[
        "planner-work-card",
        compact ? "compact" : "",
        dragged === order.number ? "is-dragging" : "",
        order.conflicts.length ? "has-conflict" : "",
        pending === order.number ? "is-pending" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      draggable={
        canManage &&
        ["APPROVED", "PLANNED", "SCHEDULED", "ASSIGNED"].includes(order.status)
      }
      key={order.id}
      onDragEnd={() => {
        setDragged(null);
        setOverTarget(null);
      }}
      onDragStart={(event) => {
        setDragged(order.number);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", order.number);
      }}
    >
      <div className="planner-card-topline">
        <span className={`planner-priority ${order.priority.toLowerCase()}`}>
          {order.priority.split("_")[0]}
        </span>
        {order.maintenancePlanCode ? (
          <span className="pm-origin">PM</span>
        ) : null}
        {order.conflicts.length ? (
          <span
            className="planner-conflict"
            title={order.conflicts.map((item) => item.message).join(" ")}
          >
            <AlertTriangle size={12} /> {order.conflicts.length}
          </span>
        ) : null}
        {canManage ? <GripVertical className="planner-grip" size={14} /> : null}
      </div>
      <Link href={`/work-orders/${encodeURIComponent(order.number)}`}>
        <small>
          {order.number} · {order.assetCode}
        </small>
        <strong>{order.title}</strong>
      </Link>
      <div className="planner-card-meta">
        <span>{formatDuration(order.estimatedMinutes)}</span>
        <span>{statusLabels[order.status]}</span>
      </div>
      {canManage ? (
        <button
          aria-label={`Replanificar ${order.number}`}
          className="planner-card-menu"
          onClick={() => {
            setEditOrder(order);
            setEditDate(
              order.plannedStart?.slice(0, 10) ?? data.days[0]?.date ?? "",
            );
            setEditTechnician(order.technicianId ?? "");
          }}
          type="button"
        >
          <MoreHorizontal size={14} />
        </button>
      ) : null}
    </article>
  );

  const mobileAgenda = data.personalAgenda.length
    ? data.personalAgenda
    : data.workOrders.slice(0, 12);

  return (
    <>
      <section className="planner-mobile-agenda">
        <header>
          <div>
            <CalendarDays size={18} />
            <span>
              <strong>
                {data.personalAgenda.length ? "Mi agenda" : "Agenda del centro"}
              </strong>
              <small>Hoy y próximos trabajos</small>
            </span>
          </div>
          <span>{mobileAgenda.length}</span>
        </header>
        <div>
          {mobileAgenda.map((order) => (
            <Link
              href={`/work-orders/${encodeURIComponent(order.number)}`}
              key={order.id}
            >
              <span
                className={`planner-priority ${order.priority.toLowerCase()}`}
              >
                {order.priority.split("_")[0]}
              </span>
              <span>
                <small>
                  {formatDateTime(order.plannedStart)} · {order.assetCode}
                </small>
                <strong>{order.title}</strong>
                <em>
                  {formatDuration(order.estimatedMinutes)} ·{" "}
                  {statusLabels[order.status]}
                </em>
              </span>
              <MoveRight size={15} />
            </Link>
          ))}
        </div>
      </section>

      <section className="planner-desktop-shell">
        <aside className="planner-backlog">
          <header>
            <div>
              <RotateCcw size={16} />
              <span>
                <strong>Backlog</strong>
                <small>Arrastra al plan semanal</small>
              </span>
            </div>
            <span>{data.backlog.length}</span>
          </header>
          <nav aria-label="Segmentos de backlog">
            {(
              Object.keys(bucketLabels) as Array<keyof typeof bucketLabels>
            ).map((key) => {
              const count =
                data.backlogCounts[
                  key.toLowerCase() as keyof typeof data.backlogCounts
                ];
              return (
                <button
                  className={bucket === key ? "active" : ""}
                  key={key}
                  onClick={() => setBucket(key)}
                  type="button"
                >
                  <span>{bucketLabels[key]}</span>
                  <strong>{count}</strong>
                </button>
              );
            })}
          </nav>
          <div className="planner-backlog-list">
            {visibleBacklog.length ? (
              visibleBacklog.map((order) => renderCard(order, true))
            ) : (
              <p>No hay trabajos en este segmento.</p>
            )}
          </div>
          <div
            className={
              overTarget === "backlog"
                ? "planner-backlog-drop active"
                : "planner-backlog-drop"
            }
            onDragEnter={() => setOverTarget("backlog")}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => drop(event, null, null)}
          >
            <RotateCcw size={14} /> Devolver a backlog
          </div>
        </aside>

        <div className="planner-board-wrap">
          {error ? (
            <p className="planner-feedback error" role="alert">
              <AlertTriangle size={14} /> {error}
            </p>
          ) : null}
          {notice ? <p className="planner-feedback success">{notice}</p> : null}
          <div
            className="planner-grid"
            style={{
              gridTemplateColumns: `210px repeat(${data.days.length}, minmax(150px, 1fr))`,
            }}
          >
            <div className="planner-grid-corner">
              <strong>Equipo</strong>
              <small>Capacidad planificada</small>
            </div>
            {data.days.map((day) => (
              <div
                className={
                  day.isToday ? "planner-day-head today" : "planner-day-head"
                }
                key={day.date}
              >
                <small>{day.label.split(" ")[0]}</small>
                <strong>{day.shortLabel}</strong>
                {day.isToday ? <span>Hoy</span> : null}
              </div>
            ))}

            <div className="planner-unassigned-label">
              <UserRound size={15} />
              <span>
                <strong>Sin asignar</strong>
                <small>Ventana ya definida</small>
              </span>
            </div>
            {data.days.map((day) => {
              const key = `unassigned:${day.date}`;
              const works = data.workOrders.filter(
                (order) =>
                  !order.technicianId &&
                  order.plannedStart?.slice(0, 10) === day.date,
              );
              return (
                <div
                  className={
                    overTarget === key
                      ? "planner-cell unassigned active"
                      : "planner-cell unassigned"
                  }
                  key={key}
                  onDragEnter={() => setOverTarget(key)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => drop(event, null, day.date)}
                >
                  {works.map((order) => renderCard(order))}
                </div>
              );
            })}

            {data.technicians.flatMap((technician) => {
              const rowHead = (
                <div
                  className="planner-tech-head"
                  key={`head:${technician.id}`}
                >
                  <span className={`avatar avatar-${technician.avatarColor}`}>
                    {technician.initials}
                  </span>
                  <span>
                    <strong>{technician.name}</strong>
                    <small>
                      {technician.shiftCode} · {technician.shiftStart}–
                      {technician.shiftEnd}
                    </small>
                    <em>
                      {technician.skills
                        .map((skill) => skill.code)
                        .slice(0, 3)
                        .join(" · ")}
                    </em>
                  </span>
                </div>
              );
              const cells = data.days.map((day) => {
                const key = `${technician.id}:${day.date}`;
                const works = data.workOrders.filter(
                  (order) =>
                    order.technicianId === technician.id &&
                    order.plannedStart?.slice(0, 10) === day.date,
                );
                const capacity = data.capacity.find(
                  (item) =>
                    item.technicianId === technician.id &&
                    item.date === day.date,
                )!;
                const absent = technician.unavailableIntervals.some(
                  (item) =>
                    item.startsAt.slice(0, 10) <= day.date &&
                    item.endsAt.slice(0, 10) >= day.date,
                );
                return (
                  <div
                    className={[
                      "planner-cell",
                      day.isToday ? "today" : "",
                      absent ? "unavailable" : "",
                      overTarget === key ? "active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={key}
                    onDragEnter={() => setOverTarget(key)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => drop(event, technician.id, day.date)}
                  >
                    {absent ? (
                      <span className="availability-flag">No disponible</span>
                    ) : null}
                    {works.map((order) => renderCard(order))}
                    <div
                      className={
                        capacity.overloaded
                          ? "capacity-meter overloaded"
                          : "capacity-meter"
                      }
                      title={`${formatDuration(capacity.plannedMinutes)} de ${formatDuration(capacity.capacityMinutes)}`}
                    >
                      <i
                        style={{
                          width: `${Math.min(100, capacity.utilization)}%`,
                        }}
                      />
                      <span>
                        {(capacity.plannedMinutes / 60).toFixed(1)}h /{" "}
                        {(capacity.capacityMinutes / 60).toFixed(0)}h
                      </span>
                    </div>
                  </div>
                );
              });
              return [rowHead, ...cells];
            })}
          </div>
        </div>
      </section>

      {editOrder ? (
        <div
          className="planner-move-backdrop"
          onMouseDown={() => setEditOrder(null)}
        >
          <section
            aria-label={`Replanificar ${editOrder.number}`}
            aria-modal="true"
            className="planner-move-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <div>
                <small>{editOrder.number}</small>
                <strong>Replanificar trabajo</strong>
              </div>
              <button
                aria-label="Cerrar"
                onClick={() => setEditOrder(null)}
                type="button"
              >
                ×
              </button>
            </header>
            <p>{editOrder.title}</p>
            <label>
              <span>Día</span>
              <select
                onChange={(event) => setEditDate(event.target.value)}
                value={editDate}
              >
                {data.days.map((day) => (
                  <option key={day.date} value={day.date}>
                    {day.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Técnico</span>
              <select
                onChange={(event) => setEditTechnician(event.target.value)}
                value={editTechnician}
              >
                <option value="">Sin técnico asignado</option>
                {data.technicians.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.shiftCode}
                  </option>
                ))}
              </select>
            </label>
            <footer>
              <button
                className="secondary-button"
                onClick={() => move(editOrder, null, null)}
                type="button"
              >
                <RotateCcw size={14} /> Backlog
              </button>
              <button
                className="primary-button"
                onClick={() =>
                  move(editOrder, editTechnician || null, editDate)
                }
                type="button"
              >
                Guardar cambio
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
