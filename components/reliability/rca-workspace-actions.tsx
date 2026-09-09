"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  Microscope,
  Plus,
  Save,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { rcaActionTypeLabels } from "@/lib/presentation";
import type { RootCauseAnalysisDetail } from "@/lib/server/repositories/reliability";

function localDate(days = 14): string {
  const value = new Date(Date.now() + days * 86_400_000);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

const nextStatuses: Record<string, string[]> = {
  DRAFT: [],
  INVESTIGATING: ["CANCELLED"],
  ACTIONS_DEFINED: ["VERIFICATION", "INVESTIGATING", "CANCELLED"],
  VERIFICATION: ["CLOSED", "ACTIONS_DEFINED"],
};

export function RcaWorkspaceActions({
  rca,
  canManage,
}: {
  rca: RootCauseAnalysisDetail;
  canManage: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const endpoint = `/api/reliability/rca/${encodeURIComponent(rca.number)}/actions`;

  const mutate = async (body: unknown, key: string) => {
    setLoading(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        data?: { workOrderNumber?: string };
        error?: { message: string };
      };
      if (!response.ok) {
        setError(
          payload.error?.message ?? "No se ha podido aplicar la acción.",
        );
        return false;
      }
      setNotice(
        payload.data?.workOrderNumber
          ? `Acción creada · ${payload.data.workOrderNumber}`
          : "Cambio guardado y trazado.",
      );
      router.refresh();
      return true;
    } catch {
      setError("El servicio no está disponible. Reinténtalo.");
      return false;
    } finally {
      setLoading(null);
    }
  };

  if (!canManage) return null;

  const saveInvestigation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const whys = Array.from({ length: 5 }, (_, index) => ({
      question: String(form.get(`why-question-${index}`) ?? "").trim(),
      answer: String(form.get(`why-answer-${index}`) ?? "").trim(),
    })).filter((item) => item.question && item.answer);
    await mutate(
      {
        action: "SAVE_INVESTIGATION",
        immediateCause: form.get("immediateCause"),
        rootCause: form.get("rootCause"),
        whys,
        version: rca.version,
      },
      "investigation",
    );
  };

  const createAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const succeeded = await mutate(
      {
        action: "CREATE_ACTION",
        title: form.get("title"),
        description: form.get("description"),
        actionType: form.get("actionType"),
        ownerId: form.get("ownerId"),
        targetAt: new Date(String(form.get("targetAt"))).toISOString(),
        maintenancePlanId: form.get("maintenancePlanId") || null,
        version: rca.version,
      },
      "action",
    );
    if (succeeded) event.currentTarget.reset();
  };

  const addEvidence = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const succeeded = await mutate(
      {
        action: "ADD_EVIDENCE",
        kind: form.get("kind"),
        description: form.get("description"),
        sourceReference: form.get("sourceReference") || null,
      },
      "evidence",
    );
    if (succeeded) event.currentTarget.reset();
  };

  return (
    <section className="rca-action-console">
      <header>
        <div>
          <p className="overline">Workspace</p>
          <h2>Continuar investigación</h2>
        </div>
        <span>{rca.number}</span>
      </header>

      {!["CLOSED", "CANCELLED"].includes(rca.status) ? (
        <div className="rca-action-sections">
          {rca.actions.some((item) =>
            ["OPEN", "IN_PROGRESS"].includes(item.status),
          ) ? (
            <div className="rca-open-action-controls">
              <small>Acciones pendientes de verificación</small>
              {rca.actions
                .filter((item) => ["OPEN", "IN_PROGRESS"].includes(item.status))
                .map((item) => (
                  <button
                    disabled={loading !== null}
                    key={item.id}
                    onClick={() =>
                      mutate(
                        { action: "COMPLETE_ACTION", actionId: item.id },
                        `complete-${item.id}`,
                      )
                    }
                    type="button"
                  >
                    <span>{item.title}</span>
                    <CheckCircle2 size={14} />
                  </button>
                ))}
            </div>
          ) : null}
          <details open={rca.status === "DRAFT"}>
            <summary>
              <Microscope size={15} /> Causa y 5 Whys
            </summary>
            <form onSubmit={saveInvestigation}>
              <label>
                <span>Causa inmediata</span>
                <textarea
                  defaultValue={rca.immediateCause ?? ""}
                  maxLength={2000}
                  name="immediateCause"
                  rows={2}
                />
              </label>
              <label>
                <span>Causa raíz</span>
                <textarea
                  defaultValue={rca.rootCause ?? ""}
                  maxLength={2000}
                  name="rootCause"
                  rows={3}
                />
              </label>
              <div className="rca-whys-form">
                {Array.from({ length: 5 }, (_, index) => {
                  const why = rca.whys[index];
                  return (
                    <div key={index}>
                      <em>{index + 1}</em>
                      <input
                        defaultValue={
                          why?.question ??
                          `¿Por qué ${index ? "ocurrió la causa anterior" : "ocurrió el problema"}?`
                        }
                        maxLength={500}
                        name={`why-question-${index}`}
                        placeholder="Pregunta"
                      />
                      <input
                        defaultValue={why?.answer ?? ""}
                        maxLength={1000}
                        name={`why-answer-${index}`}
                        placeholder="Respuesta basada en evidencia"
                      />
                    </div>
                  );
                })}
              </div>
              <button
                className="primary-button"
                disabled={loading !== null}
                type="submit"
              >
                <Save size={14} />{" "}
                {loading === "investigation"
                  ? "Guardando…"
                  : "Guardar investigación"}
              </button>
            </form>
          </details>

          <details>
            <summary>
              <FilePlus2 size={15} /> Añadir evidencia
            </summary>
            <form className="rca-compact-form" onSubmit={addEvidence}>
              <label>
                <span>Tipo</span>
                <select defaultValue="OBSERVATION" name="kind">
                  <option value="OBSERVATION">Observación</option>
                  <option value="MEASUREMENT">Medición</option>
                  <option value="DOCUMENT">Documento</option>
                  <option value="PHOTO">Fotografía</option>
                  <option value="WORK_ORDER">Orden de trabajo</option>
                </select>
              </label>
              <label className="wide-field">
                <span>Evidencia</span>
                <textarea
                  maxLength={2000}
                  minLength={5}
                  name="description"
                  required
                  rows={2}
                />
              </label>
              <label className="wide-field">
                <span>Referencia opcional</span>
                <input
                  maxLength={500}
                  name="sourceReference"
                  placeholder="OT, documento, lectura…"
                />
              </label>
              <button
                className="secondary-button"
                disabled={loading !== null}
                type="submit"
              >
                <Plus size={14} />{" "}
                {loading === "evidence" ? "Añadiendo…" : "Añadir evidencia"}
              </button>
            </form>
          </details>

          {rca.rootCause &&
          ["INVESTIGATING", "ACTIONS_DEFINED"].includes(rca.status) ? (
            <details>
              <summary>
                <Plus size={15} /> Crear acción correctiva
              </summary>
              <form className="rca-compact-form" onSubmit={createAction}>
                <label>
                  <span>Tipo de acción</span>
                  <select defaultValue="CREATE_WORK_ORDER" name="actionType">
                    {Object.entries(rcaActionTypeLabels).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  <span>Responsable</span>
                  <select defaultValue={rca.ownerId} name="ownerId">
                    {rca.catalogs.owners.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="wide-field">
                  <span>Título</span>
                  <input maxLength={180} minLength={5} name="title" required />
                </label>
                <label className="wide-field">
                  <span>Descripción</span>
                  <textarea
                    maxLength={2000}
                    minLength={5}
                    name="description"
                    required
                    rows={2}
                  />
                </label>
                <label>
                  <span>Fecha objetivo</span>
                  <input
                    defaultValue={localDate()}
                    name="targetAt"
                    required
                    type="datetime-local"
                  />
                </label>
                <label>
                  <span>Plan relacionado, si aplica</span>
                  <select defaultValue="" name="maintenancePlanId">
                    <option value="">Sin plan</option>
                    {rca.catalogs.maintenancePlans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.code} · {plan.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary-button"
                  disabled={loading !== null}
                  type="submit"
                >
                  <Plus size={14} />{" "}
                  {loading === "action" ? "Creando…" : "Crear acción"}
                </button>
              </form>
            </details>
          ) : null}

          {nextStatuses[rca.status]?.length ? (
            <div className="rca-status-actions">
              <span>Siguiente decisión</span>
              {nextStatuses[rca.status].map((status) => (
                <button
                  className={
                    status === "CLOSED" ? "primary-button" : "secondary-button"
                  }
                  disabled={loading !== null}
                  key={status}
                  onClick={() =>
                    mutate(
                      { action: "CHANGE_STATUS", status, version: rca.version },
                      `status-${status}`,
                    )
                  }
                  type="button"
                >
                  {status === "CLOSED" ? <CheckCircle2 size={14} /> : null}
                  {status === "VERIFICATION"
                    ? "Pasar a verificación"
                    : status === "INVESTIGATING"
                      ? "Reabrir investigación"
                      : status === "ACTIONS_DEFINED"
                        ? "Volver a acciones"
                        : status === "CLOSED"
                          ? "Cerrar RCA"
                          : "Cancelar"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {notice ? <p className="operation-success">{notice}</p> : null}
      {error ? (
        <p className="operation-error" role="alert">
          <AlertTriangle size={14} /> {error}
        </p>
      ) : null}
    </section>
  );
}
