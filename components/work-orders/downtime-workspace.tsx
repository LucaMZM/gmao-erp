"use client";

import { AlertTriangle, Play, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import {
  formatDateTime,
  formatDuration,
  productionImpactLabels,
} from "@/lib/presentation";
import type { DowntimeEntry } from "@/lib/server/repositories/work-orders";

export function DowntimeWorkspace({
  number,
  entries,
  canManage,
}: {
  number: string;
  entries: DowntimeEntry[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = entries.find((entry) => !entry.endedAt);
  const mutate = async (body: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/work-orders/${encodeURIComponent(number)}/downtime`,
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
          payload.error?.message ?? "No se ha podido registrar el downtime.",
        );
        return;
      }
      router.refresh();
    } catch {
      setError("El servicio no está disponible. Reinténtalo.");
    } finally {
      setLoading(false);
    }
  };
  const start = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void mutate({
      action: "START",
      kind: data.get("kind"),
      productionImpact: data.get("productionImpact"),
      cause: data.get("cause") || null,
    });
  };
  return (
    <>
      {canManage && !active ? (
        <form className="downtime-start-bar" onSubmit={start}>
          <select
            aria-label="Tipo de parada"
            defaultValue="UNPLANNED"
            name="kind"
          >
            <option value="UNPLANNED">No planificada</option>
            <option value="PLANNED">Planificada</option>
          </select>
          <select
            aria-label="Impacto productivo"
            defaultValue="FULL_STOP"
            name="productionImpact"
          >
            <option value="FULL_STOP">Parada total</option>
            <option value="REDUCED_SPEED">Producción degradada</option>
            <option value="MICROSTOP">Microparada</option>
            <option value="NO_IMPACT">Sin impacto</option>
          </select>
          <input name="cause" placeholder="Causa inicial, si se conoce" />
          <button className="secondary-button" disabled={loading} type="submit">
            <Play size={14} /> Iniciar downtime
          </button>
        </form>
      ) : null}
      <div className="downtime-list">
        {entries.map((entry) => (
          <div
            className={
              entry.endedAt ? "downtime-record" : "downtime-record active"
            }
            key={entry.id}
          >
            <span className="downtime-duration">
              {entry.endedAt
                ? formatDuration(entry.durationMinutes)
                : "En curso"}
            </span>
            <span>
              <strong>
                {entry.kind === "UNPLANNED"
                  ? "Parada no planificada"
                  : "Parada planificada"}
              </strong>
              <small>
                {formatDateTime(entry.startedAt)} →{" "}
                {formatDateTime(entry.endedAt)}
              </small>
            </span>
            <span>
              <small>Impacto</small>
              <strong>
                {productionImpactLabels[entry.productionImpact] ??
                  entry.productionImpact}
              </strong>
            </span>
            <span>
              <small>Causa</small>
              <strong>{entry.cause ?? "Pendiente"}</strong>
            </span>
            {canManage && !entry.endedAt ? (
              <button
                className="secondary-button"
                disabled={loading}
                onClick={() =>
                  void mutate({ action: "END", downtimeId: entry.id })
                }
                type="button"
              >
                <Square size={13} /> Finalizar
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {!entries.length ? (
        <div className="compact-empty-material">
          La intervención no tiene parada productiva asociada.
        </div>
      ) : null}
      {error ? (
        <p className="operation-feedback error">
          <AlertTriangle size={14} /> {error}
        </p>
      ) : null}
    </>
  );
}
