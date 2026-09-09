"use client";

import {
  AlertTriangle,
  Gauge,
  PauseCircle,
  PlayCircle,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

function currentLocalDateTime(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function MaintenancePlanActions({
  code,
  status,
  version,
  meter,
  canManage,
  canGenerate,
  canRecordMeter,
}: {
  code: string;
  status: string;
  version: number;
  meter: {
    id: string;
    code: string;
    unit: string;
    lastValue: number | null;
  } | null;
  canManage: boolean;
  canGenerate: boolean;
  canRecordMeter: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readingOpen, setReadingOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const action = async (body: unknown) => {
    setLoading("action");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/maintenance-plans/${encodeURIComponent(code)}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json()) as {
        data?: { number?: string; created?: boolean };
        error?: { message: string };
      };
      if (!response.ok) {
        setError(
          payload.error?.message ?? "No se ha podido aplicar la acción.",
        );
        return;
      }
      if (payload.data?.number) {
        router.push(`/work-orders/${encodeURIComponent(payload.data.number)}`);
      } else {
        router.refresh();
      }
    } catch {
      setError("El servicio no está disponible. Reinténtalo.");
    } finally {
      setLoading(null);
    }
  };

  const recordReading = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!meter) return;
    setLoading("reading");
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        `/api/meters/${encodeURIComponent(meter.id)}/readings`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            value: Number(form.get("value")),
            recordedAt: new Date(String(form.get("recordedAt"))).toISOString(),
            note: form.get("note") || null,
          }),
        },
      );
      const payload = (await response.json()) as {
        data?: { duePlanCodes: string[] };
        error?: { message: string };
      };
      if (!response.ok) {
        setError(
          payload.error?.message ?? "No se ha podido guardar la lectura.",
        );
        return;
      }
      setNotice(
        payload.data?.duePlanCodes.includes(code)
          ? "Lectura registrada · el plan ha alcanzado su umbral."
          : "Lectura registrada correctamente.",
      );
      setReadingOpen(false);
      router.refresh();
    } catch {
      setError("El servicio no está disponible. Reinténtalo.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="plan-action-stack">
      <div className="plan-primary-actions">
        {meter && canRecordMeter ? (
          <button
            className="secondary-button"
            onClick={() => setReadingOpen((open) => !open)}
            type="button"
          >
            <Gauge size={15} /> Registrar lectura
          </button>
        ) : null}
        {canManage ? (
          <button
            className="secondary-button"
            disabled={loading !== null}
            onClick={() =>
              action({
                action: "SET_STATUS",
                status: status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                expectedVersion: version,
              })
            }
            type="button"
          >
            {status === "ACTIVE" ? (
              <PauseCircle size={15} />
            ) : (
              <PlayCircle size={15} />
            )}
            {status === "ACTIVE" ? "Pausar plan" : "Activar plan"}
          </button>
        ) : null}
        {canGenerate && status === "ACTIVE" ? (
          <button
            className="primary-button"
            disabled={loading !== null}
            onClick={() => action({ action: "GENERATE" })}
            type="button"
          >
            <Sparkles size={15} />{" "}
            {loading === "action" ? "Generando…" : "Generar OT"}
          </button>
        ) : null}
      </div>
      {readingOpen && meter ? (
        <form className="meter-inline-form" onSubmit={recordReading}>
          <div>
            <strong>{meter.code}</strong>
            <small>
              Última: {meter.lastValue ?? "—"} {meter.unit}
            </small>
          </div>
          <label>
            <span>Nueva lectura ({meter.unit})</span>
            <input
              defaultValue={meter.lastValue ?? 0}
              min={0}
              name="value"
              required
              step="any"
              type="number"
            />
          </label>
          <label>
            <span>Fecha y hora</span>
            <input
              defaultValue={currentLocalDateTime()}
              name="recordedAt"
              required
              type="datetime-local"
            />
          </label>
          <label className="wide-field">
            <span>Nota opcional</span>
            <input
              maxLength={500}
              name="note"
              placeholder="Contexto de la lectura"
            />
          </label>
          <button
            className="primary-button"
            disabled={loading !== null}
            type="submit"
          >
            {loading === "reading" ? "Guardando…" : "Guardar lectura"}
          </button>
        </form>
      ) : null}
      {notice ? <p className="operation-success">{notice}</p> : null}
      {error ? (
        <p className="operation-error" role="alert">
          <AlertTriangle size={14} /> {error}
        </p>
      ) : null}
    </div>
  );
}
