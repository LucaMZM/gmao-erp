"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  MessageCircleQuestion,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { IncidentFormOption } from "@/lib/server/repositories/incidents";

export function IncidentTriageActions({
  incidentId,
  status,
  assetId,
  priority,
  classification,
  assets,
  canTriage,
}: {
  incidentId: string;
  status: string;
  assetId: string | null;
  priority: string | null;
  classification: string | null;
  assets: IncidentFormOption[];
  canTriage: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutate = async (action: string, body: Record<string, unknown> = {}) => {
    setLoading(action);
    setError(null);
    try {
      const response = await fetch(`/api/incidents/${incidentId}/triage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const payload = (await response.json()) as {
        error?: { message: string };
      };
      if (!response.ok) {
        setError(
          payload.error?.message ?? "No se ha podido actualizar el triage.",
        );
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement;
    const form = new FormData(event.currentTarget);
    await mutate(submitter.value, {
      assetId: form.get("assetId") || null,
      priority: form.get("priority"),
      classification: form.get("classification"),
      note: form.get("note"),
    });
  };

  const convert = async () => {
    setLoading("CONVERT");
    setError(null);
    try {
      const response = await fetch(`/api/incidents/${incidentId}/convert`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        data?: { href: string };
        error?: { message: string };
      };
      if (!response.ok || !payload.data) {
        setError(payload.error?.message ?? "No se ha podido crear la OT.");
        return;
      }
      router.push(payload.data.href);
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  if (!canTriage) return null;
  if (status === "NEW") {
    return (
      <div className="operation-action-card">
        <span>
          <MessageCircleQuestion size={16} />
        </span>
        <div>
          <strong>Incidencia pendiente de triage</strong>
          <small>Confirma el contexto antes de decidir la intervención.</small>
        </div>
        <button
          className="primary-button"
          disabled={Boolean(loading)}
          onClick={() => mutate("START_TRIAGE")}
          type="button"
        >
          Iniciar triage
        </button>
        {error ? <p className="operation-error">{error}</p> : null}
      </div>
    );
  }
  if (status === "ACCEPTED") {
    return (
      <div className="operation-action-card accepted">
        <span>
          <Check size={16} />
        </span>
        <div>
          <strong>Clasificada y aceptada</strong>
          <small>La OT heredará activo, prioridad, tipo y trazabilidad.</small>
        </div>
        <button
          className="primary-button"
          disabled={Boolean(loading)}
          onClick={convert}
          type="button"
        >
          {loading === "CONVERT" ? "Creando OT…" : "Convertir en OT"}{" "}
          <ArrowRight size={14} />
        </button>
        {error ? <p className="operation-error">{error}</p> : null}
      </div>
    );
  }
  if (status !== "IN_TRIAGE") return null;

  return (
    <form className="operation-form triage-form" onSubmit={submit}>
      <label className="wide-field">
        <span>Activo afectado</span>
        <select defaultValue={assetId ?? ""} name="assetId" required>
          <option disabled value="">
            Seleccionar activo
          </option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.code} · {asset.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Prioridad</span>
        <select defaultValue={priority ?? "P3_HIGH"} name="priority">
          <option value="P1_EMERGENCY">P1 · Emergencia</option>
          <option value="P2_URGENT">P2 · Urgente</option>
          <option value="P3_HIGH">P3 · Alta</option>
          <option value="P4_NORMAL">P4 · Normal</option>
          <option value="P5_LOW">P5 · Baja</option>
        </select>
      </label>
      <label>
        <span>Tipo de trabajo</span>
        <select
          defaultValue={classification ?? "CORRECTIVE"}
          name="classification"
        >
          <option value="CORRECTIVE">Correctivo</option>
          <option value="INSPECTION">Inspección</option>
          <option value="PREVENTIVE">Preventivo</option>
          <option value="PREDICTIVE">Predictivo</option>
          <option value="CALIBRATION">Calibración</option>
          <option value="IMPROVEMENT">Mejora</option>
        </select>
      </label>
      <label className="wide-field">
        <span>Nota de decisión / información requerida</span>
        <textarea
          name="note"
          placeholder="Solo lo necesario para orientar la intervención"
          rows={3}
        />
      </label>
      {error ? (
        <p className="operation-error" role="alert">
          <AlertTriangle size={14} /> {error}
        </p>
      ) : null}
      <footer className="triage-actions">
        <button
          className="secondary-button"
          disabled={Boolean(loading)}
          name="action"
          type="submit"
          value="REQUEST_INFO"
        >
          <MessageCircleQuestion size={14} /> Pedir información
        </button>
        <button
          className="secondary-button danger"
          disabled={Boolean(loading)}
          name="action"
          type="submit"
          value="REJECT"
        >
          <XCircle size={14} /> Rechazar
        </button>
        <button
          className="primary-button"
          disabled={Boolean(loading)}
          name="action"
          type="submit"
          value="ACCEPT"
        >
          <Check size={14} /> Aceptar y clasificar
        </button>
      </footer>
    </form>
  );
}
