"use client";

import { AlertTriangle, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { IncidentFormOption } from "@/lib/server/repositories/incidents";

export function IncidentCreateDialog({
  locations,
  assets,
}: {
  locations: IncidentFormOption[];
  assets: IncidentFormOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/incidents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
          severity: form.get("severity"),
          initialImpact: form.get("initialImpact"),
          origin: form.get("origin"),
          functionalLocationId: form.get("functionalLocationId"),
          assetId: form.get("assetId") || null,
        }),
      });
      const payload = (await response.json()) as {
        data?: { href: string };
        error?: { message: string };
      };
      if (!response.ok || !payload.data) {
        setError(
          payload.error?.message ?? "No se ha podido registrar la incidencia.",
        );
        return;
      }
      router.push(payload.data.href);
      router.refresh();
    } catch {
      setError("El servicio no está disponible. Reinténtalo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        className="primary-button"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Plus size={15} /> Reportar incidencia
      </button>
      {open ? (
        <div
          className="dialog-backdrop incident-dialog-backdrop"
          onMouseDown={() => setOpen(false)}
        >
          <section
            aria-label="Reportar incidencia"
            aria-modal="true"
            className="incident-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <div>
                <p className="overline">Aviso de planta</p>
                <h2>¿Qué está ocurriendo?</h2>
                <p>
                  Registra lo esencial. Planta, usuario y hora se completan
                  automáticamente.
                </p>
              </div>
              <button
                aria-label="Cerrar"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X size={17} />
              </button>
            </header>
            <form className="operation-form" onSubmit={submit}>
              <label className="wide-field">
                <span>Título</span>
                <input
                  autoFocus
                  maxLength={140}
                  minLength={5}
                  name="title"
                  placeholder="Ej. Vibración anómala en rodillo aplicador"
                  required
                />
              </label>
              <label className="wide-field">
                <span>Descripción breve</span>
                <textarea
                  maxLength={2000}
                  minLength={10}
                  name="description"
                  placeholder="Qué observas, desde cuándo y en qué condición aparece"
                  required
                  rows={3}
                />
              </label>
              <label>
                <span>Área / ubicación</span>
                <select
                  defaultValue={locations[0]?.id}
                  name="functionalLocationId"
                  required
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} · {location.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Activo, si se conoce</span>
                <select defaultValue="" name="assetId">
                  <option value="">Sin identificar todavía</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.code} · {asset.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Severidad inicial</span>
                <select defaultValue="MEDIUM" name="severity">
                  <option value="CRITICAL">Crítica</option>
                  <option value="HIGH">Alta</option>
                  <option value="MEDIUM">Media</option>
                  <option value="LOW">Baja</option>
                </select>
              </label>
              <label>
                <span>Impacto observado</span>
                <select defaultValue="UNKNOWN" name="initialImpact">
                  <option value="FULL_STOP">Producción detenida</option>
                  <option value="REDUCED_SPEED">Producción degradada</option>
                  <option value="QUALITY_RISK">Riesgo de calidad</option>
                  <option value="SAFETY_RISK">Riesgo de seguridad</option>
                  <option value="NO_IMPACT">Sin impacto productivo</option>
                  <option value="UNKNOWN">Por confirmar</option>
                </select>
              </label>
              <input name="origin" type="hidden" value="OPERATOR" />
              {error ? (
                <p className="operation-error" role="alert">
                  <AlertTriangle size={14} /> {error}
                </p>
              ) : null}
              <footer>
                <button
                  className="secondary-button"
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  Cancelar
                </button>
                <button
                  className="primary-button"
                  disabled={loading}
                  type="submit"
                >
                  {loading ? "Registrando…" : "Registrar incidencia"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
