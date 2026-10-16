"use client";

import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Pause,
  Play,
  UserPlus,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { FailureModeOption } from "@/lib/server/repositories/failure-modes";

type Technician = {
  id: string;
  fullName: string;
  initials: string;
  jobTitle: string;
};

export type WorkOrderActionPermissions = {
  assign: boolean;
  schedule: boolean;
  execute: boolean;
  complete: boolean;
  close: boolean;
  cancel: boolean;
  priority: boolean;
};

export function WorkOrderActions({
  number,
  status,
  priority,
  technicians,
  assignedUserIds,
  activeLabor,
  permissions,
  failureModes,
  workOrderType,
}: {
  number: string;
  status: string;
  priority: string;
  technicians: Technician[];
  assignedUserIds: string[];
  activeLabor: Array<{ id: string; userName: string }>;
  permissions: WorkOrderActionPermissions;
  failureModes: FailureModeOption[];
  workOrderType: string;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<
    "assign" | "schedule" | "complete" | "cancel" | null
  >(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const assigned = technicians.filter((item) =>
    assignedUserIds.includes(item.id),
  );
  const executable = [
    "ASSIGNED",
    "PAUSED",
    "WAITING_PART",
    "WAITING_VENDOR",
  ].includes(status);
  const final = ["CLOSED", "CANCELLED"].includes(status);

  const act = async (body: Record<string, unknown>) => {
    const action = String(body.action);
    setLoading(action);
    setError(null);
    try {
      const response = await fetch(
        `/api/work-orders/${encodeURIComponent(number)}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json()) as {
        error?: { message: string };
      };
      if (!response.ok) {
        setError(
          payload.error?.message ?? "No se ha podido aplicar la acción.",
        );
        return false;
      }
      setPanel(null);
      router.refresh();
      return true;
    } catch {
      setError("El servicio no está disponible. Reinténtalo.");
      return false;
    } finally {
      setLoading(null);
    }
  };

  const submitAssign = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void act({ action: "ASSIGN", technicianId: data.get("technicianId") });
  };
  const submitSchedule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const start = String(data.get("plannedStart"));
    const end = String(data.get("plannedEnd"));
    void act({
      action: "SCHEDULE",
      plannedStart: new Date(start).toISOString(),
      plannedEnd: new Date(end).toISOString(),
    });
  };
  const submitComplete = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void act({
      action: "COMPLETE",
      diagnosis: data.get("diagnosis"),
      solution: data.get("solution"),
      failureModeId: data.get("failureModeId") || null,
      failureCause: data.get("failureCause") || null,
    });
  };
  const submitCancel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void act({ action: "CANCEL", reason: data.get("reason") });
  };

  return (
    <section
      className="operation-command-bar"
      aria-label="Acciones de la orden"
    >
      <div className="operation-command-main">
        {permissions.assign && !final && !["COMPLETED"].includes(status) ? (
          <button
            onClick={() => setPanel(panel === "assign" ? null : "assign")}
            type="button"
          >
            <UserPlus size={15} /> Asignar
          </button>
        ) : null}
        {permissions.schedule &&
        !final &&
        !["IN_PROGRESS", "COMPLETED"].includes(status) ? (
          <button
            onClick={() => setPanel(panel === "schedule" ? null : "schedule")}
            type="button"
          >
            <CalendarClock size={15} /> Programar
          </button>
        ) : null}
        {permissions.execute && executable && assigned.length ? (
          <label className="inline-action-select">
            <select
              aria-label="Técnico que inicia"
              defaultValue={assigned[0]?.id}
              id="execution-technician"
            >
              {assigned.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.fullName}
                </option>
              ))}
            </select>
            <button
              className="primary-command"
              disabled={Boolean(loading)}
              onClick={() => {
                const select = document.getElementById(
                  "execution-technician",
                ) as HTMLSelectElement | null;
                void act({
                  action: status === "ASSIGNED" ? "START" : "RESUME",
                  technicianId: select?.value,
                });
              }}
              type="button"
            >
              <Play size={15} />{" "}
              {status === "ASSIGNED" ? "Empezar trabajo" : "Reanudar"}
            </button>
          </label>
        ) : null}
        {permissions.execute && status === "IN_PROGRESS" ? (
          <>
            <button
              disabled={Boolean(loading)}
              onClick={() => void act({ action: "PAUSE" })}
              type="button"
            >
              <Pause size={15} /> Pausar
            </button>
            {activeLabor.map((labor) => (
              <button
                disabled={Boolean(loading)}
                key={labor.id}
                onClick={() =>
                  void act({ action: "STOP_SESSION", laborSessionId: labor.id })
                }
                title={`Finalizar sesión de ${labor.userName}`}
                type="button"
              >
                <Clock3 size={15} /> Stop {labor.userName.split(" ")[0]}
              </button>
            ))}
            <button
              disabled={Boolean(loading)}
              onClick={() => void act({ action: "WAIT_PART" })}
              type="button"
            >
              Esperando recambio
            </button>
            <button
              disabled={Boolean(loading)}
              onClick={() => void act({ action: "WAIT_VENDOR" })}
              type="button"
            >
              Esperando proveedor
            </button>
          </>
        ) : null}
        {permissions.complete && status === "IN_PROGRESS" ? (
          <button
            className="success-command"
            onClick={() => setPanel(panel === "complete" ? null : "complete")}
            type="button"
          >
            <CheckCircle2 size={15} /> Completar
          </button>
        ) : null}
        {permissions.close && status === "COMPLETED" ? (
          <button
            className="success-command"
            disabled={Boolean(loading)}
            onClick={() => void act({ action: "CLOSE" })}
            type="button"
          >
            <CheckCircle2 size={15} /> Cerrar OT
          </button>
        ) : null}
      </div>
      <div className="operation-command-secondary">
        {permissions.priority && !final ? (
          <select
            aria-label="Cambiar prioridad"
            defaultValue={priority}
            disabled={Boolean(loading)}
            onChange={(event) =>
              void act({
                action: "CHANGE_PRIORITY",
                priority: event.target.value,
              })
            }
          >
            <option value="P1_EMERGENCY">P1</option>
            <option value="P2_URGENT">P2</option>
            <option value="P3_HIGH">P3</option>
            <option value="P4_NORMAL">P4</option>
            <option value="P5_LOW">P5</option>
          </select>
        ) : null}
        {permissions.cancel && !final && status !== "COMPLETED" ? (
          <button
            aria-label="Cancelar orden"
            className="danger-command"
            onClick={() => setPanel(panel === "cancel" ? null : "cancel")}
            type="button"
          >
            <XCircle size={15} />
          </button>
        ) : null}
      </div>

      {panel === "assign" ? (
        <form className="inline-operation-panel" onSubmit={submitAssign}>
          <label>
            <span>Técnico</span>
            <select name="technicianId" required>
              {technicians.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.fullName} · {item.jobTitle}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button"
            disabled={Boolean(loading)}
            type="submit"
          >
            Asignar
          </button>
        </form>
      ) : null}
      {panel === "schedule" ? (
        <form
          className="inline-operation-panel schedule-panel"
          onSubmit={submitSchedule}
        >
          <label>
            <span>Inicio</span>
            <input name="plannedStart" required type="datetime-local" />
          </label>
          <label>
            <span>Fin</span>
            <input name="plannedEnd" required type="datetime-local" />
          </label>
          <button
            className="primary-button"
            disabled={Boolean(loading)}
            type="submit"
          >
            <Clock3 size={14} /> Guardar ventana
          </button>
        </form>
      ) : null}
      {panel === "complete" ? (
        <form
          className="inline-operation-panel completion-panel"
          onSubmit={submitComplete}
        >
          <label>
            <span>Diagnóstico</span>
            <textarea
              name="diagnosis"
              placeholder="Qué se confirmó durante la intervención"
              required
              rows={3}
            />
          </label>
          <label>
            <span>Resolución</span>
            <textarea
              name="solution"
              placeholder="Qué se hizo y cómo se verificó"
              required
              rows={3}
            />
          </label>
          <label>
            <span>Modo de fallo</span>
            <select defaultValue="" name="failureModeId">
              <option value="">Sin clasificar</option>
              {failureModes.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.name} · {mode.code}
                </option>
              ))}
            </select>
            {workOrderType === "CORRECTIVE" ? (
              <small>Clasifica el fallo para recurrencia y Pareto.</small>
            ) : null}
          </label>
          <label>
            <span>Causa</span>
            <select defaultValue="" name="failureCause">
              <option value="">Pendiente de RCA</option>
              <option value="WEAR">Desgaste</option>
              <option value="CONTAMINATION">Contaminación</option>
              <option value="MISALIGNMENT">Desalineación</option>
              <option value="LOOSE_CONNECTION">Conexión floja</option>
            </select>
          </label>
          <button
            className="primary-button"
            disabled={Boolean(loading)}
            type="submit"
          >
            Completar intervención
          </button>
        </form>
      ) : null}
      {panel === "cancel" ? (
        <form
          className="inline-operation-panel cancel-panel"
          onSubmit={submitCancel}
        >
          <label>
            <span>Motivo de cancelación</span>
            <input
              minLength={5}
              name="reason"
              placeholder="Decisión y motivo trazable"
              required
            />
          </label>
          <button
            className="secondary-button danger"
            disabled={Boolean(loading)}
            type="submit"
          >
            Cancelar orden
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="operation-feedback error" role="alert">
          <AlertTriangle size={14} /> {error}
        </p>
      ) : null}
    </section>
  );
}
