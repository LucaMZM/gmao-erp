"use client";

import {
  AlertTriangle,
  ArrowRight,
  ClipboardPenLine,
  QrCode,
  Radio,
  Send,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import type { IncidentFormOption } from "@/lib/server/repositories/incidents";
import { OfflineQueueStatus } from "@/components/field/offline-queue-status";
import { postWithOfflineQueue } from "@/lib/client/offline-queue";

type Mode = "incident" | "handover" | null;

export function FieldQuickActions({
  assets,
  locations,
  shiftCode,
  workOrders,
}: {
  assets: IncidentFormOption[];
  locations: IncidentFormOption[];
  shiftCode: string;
  workOrders: Array<{ number: string; title: string }>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const submitIncident = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const result = await postWithOfflineQueue("/api/incidents", {
        title: form.get("title"),
        description: form.get("description"),
        severity: form.get("severity"),
        initialImpact: form.get("initialImpact"),
        origin: "MAINTENANCE",
        functionalLocationId: form.get("functionalLocationId"),
        assetId: form.get("assetId") || null,
      });
      if (result.queued) {
        setMode(null);
        return;
      }
      const response = result.response!;
      const payload = (await response.json()) as {
        data?: { href: string };
        error?: { message: string };
      };
      if (!response.ok || !payload.data) {
        setError(payload.error?.message ?? "No se ha podido registrar.");
        return;
      }
      router.push(payload.data.href);
      router.refresh();
    } catch {
      setError("Sin conexión. No se ha guardado ningún dato.");
    } finally {
      setLoading(false);
    }
  };

  const submitHandover = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const result = await postWithOfflineQueue("/api/field/handovers", {
        fromShift: shiftCode,
        toShift: form.get("toShift"),
        summary: form.get("summary"),
        risks: form.get("risks") || null,
        partsPending: form.get("partsPending") || null,
        workOrderNumbers: form.getAll("workOrderNumbers"),
      });
      if (result.queued) {
        setMode(null);
        return;
      }
      const response = result.response!;
      const payload = (await response.json()) as {
        error?: { message: string };
      };
      if (!response.ok) {
        setError(
          payload.error?.message ?? "No se ha podido guardar el relevo.",
        );
        return;
      }
      setMode(null);
      router.refresh();
    } catch {
      setError("Sin conexión. El relevo no se ha guardado.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="field-connectivity" data-online={online}>
        <Radio size={13} />
        {online
          ? "Conectado · cada acción se confirma en planta"
          : "Sin conexión · consulta disponible, acciones deshabilitadas"}
      </div>
      <OfflineQueueStatus />
      <div className="field-quick-actions">
        <Link className="field-quick-primary" href="/scan">
          <QrCode size={19} />
          <span>
            <strong>Identificar activo</strong>
            <small>Escanea o introduce su código</small>
          </span>
          <ArrowRight size={15} />
        </Link>
        <button onClick={() => setMode("incident")} type="button">
          <AlertTriangle size={18} />
          <span>
            <strong>Aviso rápido</strong>
            <small>Registra una anomalía</small>
          </span>
        </button>
        <button onClick={() => setMode("handover")} type="button">
          <ClipboardPenLine size={18} />
          <span>
            <strong>Entregar turno</strong>
            <small>Contexto para el relevo</small>
          </span>
        </button>
      </div>

      {mode ? (
        <div
          className="dialog-backdrop field-sheet-backdrop"
          onMouseDown={() => setMode(null)}
        >
          <section
            aria-label={
              mode === "incident" ? "Aviso rápido" : "Relevo de turno"
            }
            aria-modal="true"
            className="field-sheet"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <div>
                <p className="overline">Operación de campo</p>
                <h2>
                  {mode === "incident" ? "Reportar anomalía" : "Entregar turno"}
                </h2>
                <p>Solo la información que el siguiente paso necesita.</p>
              </div>
              <button
                aria-label="Cerrar"
                onClick={() => setMode(null)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            {mode === "incident" ? (
              <form className="field-form" onSubmit={submitIncident}>
                <label>
                  <span>¿Qué ocurre?</span>
                  <input
                    autoFocus
                    maxLength={140}
                    minLength={5}
                    name="title"
                    required
                  />
                </label>
                <label>
                  <span>Qué observas</span>
                  <textarea
                    maxLength={2000}
                    minLength={10}
                    name="description"
                    required
                    rows={3}
                  />
                </label>
                <div className="field-form-grid">
                  <label>
                    <span>Ubicación</span>
                    <select
                      defaultValue={locations[0]?.id}
                      name="functionalLocationId"
                      required
                    >
                      {locations.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.code} · {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Activo</span>
                    <select defaultValue="" name="assetId">
                      <option value="">Sin identificar</option>
                      {assets.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.code} · {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Severidad</span>
                    <select defaultValue="MEDIUM" name="severity">
                      <option value="CRITICAL">Crítica</option>
                      <option value="HIGH">Alta</option>
                      <option value="MEDIUM">Media</option>
                      <option value="LOW">Baja</option>
                    </select>
                  </label>
                  <label>
                    <span>Impacto</span>
                    <select defaultValue="UNKNOWN" name="initialImpact">
                      <option value="FULL_STOP">Producción detenida</option>
                      <option value="REDUCED_SPEED">
                        Producción degradada
                      </option>
                      <option value="QUALITY_RISK">Riesgo de calidad</option>
                      <option value="SAFETY_RISK">Riesgo de seguridad</option>
                      <option value="NO_IMPACT">Sin impacto</option>
                      <option value="UNKNOWN">Por confirmar</option>
                    </select>
                  </label>
                </div>
                {error ? (
                  <p className="operation-feedback error">
                    <AlertTriangle size={14} /> {error}
                  </p>
                ) : null}
                <button
                  className="primary-button"
                  disabled={loading}
                  type="submit"
                >
                  <Send size={15} />{" "}
                  {loading ? "Registrando…" : "Registrar aviso"}
                </button>
              </form>
            ) : (
              <form className="field-form" onSubmit={submitHandover}>
                <div className="field-shift-route">
                  <strong>{shiftCode}</strong>
                  <ArrowRight size={16} />
                  <label>
                    <span className="sr-only">Turno receptor</span>
                    <select
                      defaultValue={shiftCode === "M1" ? "T1" : "M1"}
                      name="toShift"
                    >
                      <option value="M1">M1 · Mañana</option>
                      <option value="T1">T1 · Tarde</option>
                      <option value="N1">N1 · Noche</option>
                    </select>
                  </label>
                </div>
                <label>
                  <span>Estado para el relevo</span>
                  <textarea
                    autoFocus
                    minLength={5}
                    name="summary"
                    required
                    rows={3}
                  />
                </label>
                <label>
                  <span>Riesgos o bloqueos</span>
                  <textarea name="risks" rows={2} />
                </label>
                <label>
                  <span>Recambios pendientes</span>
                  <input name="partsPending" />
                </label>
                {workOrders.length ? (
                  <fieldset>
                    <legend>Trabajos relacionados</legend>
                    {workOrders.map((item) => (
                      <label className="field-check-option" key={item.number}>
                        <input
                          name="workOrderNumbers"
                          type="checkbox"
                          value={item.number}
                        />
                        <span>
                          <strong>{item.number}</strong>
                          <small>{item.title}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                {error ? (
                  <p className="operation-feedback error">
                    <AlertTriangle size={14} /> {error}
                  </p>
                ) : null}
                <button
                  className="primary-button"
                  disabled={loading}
                  type="submit"
                >
                  <Send size={15} /> {loading ? "Guardando…" : "Entregar turno"}
                </button>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
