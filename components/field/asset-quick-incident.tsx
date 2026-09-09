"use client";

import { AlertTriangle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { postWithOfflineQueue } from "@/lib/client/offline-queue";

export function AssetQuickIncident({
  assetId,
  assetCode,
  locationId,
}: {
  assetId: string;
  assetCode: string;
  locationId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
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
        functionalLocationId: locationId,
        assetId,
      });
      if (result.queued) {
        setError(
          "Guardado en este dispositivo; se enviará al recuperar conexión.",
        );
        return;
      }
      const response = result.response!;
      const payload = (await response.json()) as {
        data?: { href: string };
        error?: { message: string };
      };
      if (!response.ok || !payload.data) {
        setError(
          payload.error?.message ?? "No se ha podido registrar el aviso.",
        );
        return;
      }
      router.push(payload.data.href);
      router.refresh();
    } catch {
      setError("Sin conexión. No se ha guardado el aviso.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <form className="asset-quick-incident" onSubmit={submit}>
      <header>
        <AlertTriangle size={18} />
        <div>
          <p className="overline">Aviso contextual</p>
          <h2>Reportar en {assetCode}</h2>
        </div>
      </header>
      <label>
        <span>¿Qué ocurre?</span>
        <input
          maxLength={140}
          minLength={5}
          name="title"
          placeholder="Describe la anomalía"
          required
        />
      </label>
      <label>
        <span>Observación</span>
        <textarea
          maxLength={2000}
          minLength={10}
          name="description"
          required
          rows={2}
        />
      </label>
      <div className="field-form-grid">
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
            <option value="REDUCED_SPEED">Producción degradada</option>
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
      <button className="primary-button" disabled={loading} type="submit">
        <Send size={15} /> {loading ? "Registrando…" : "Registrar aviso"}
      </button>
    </form>
  );
}
