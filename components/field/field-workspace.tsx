"use client";

import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FilePlus2,
  Gauge,
  HardHat,
  MessageSquarePlus,
  PackageCheck,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  Square,
  TimerOff,
  Upload,
  Wrench,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { DowntimeWorkspace } from "@/components/work-orders/downtime-workspace";
import { MaterialWorkspace } from "@/components/work-orders/material-workspace";
import { OfflineQueueStatus } from "@/components/field/offline-queue-status";
import { postWithOfflineQueue } from "@/lib/client/offline-queue";
import {
  formatDateTime,
  formatDuration,
  statusLabels,
} from "@/lib/presentation";
import type { FieldWorkOrderData } from "@/lib/server/repositories/field";
import type { FailureModeOption } from "@/lib/server/repositories/failure-modes";

type OperationFeedback = { tone: "error" | "success"; text: string } | null;

export function FieldWorkspace({
  data,
  userId,
  failureModes,
}: {
  data: FieldWorkOrderData;
  userId: string;
  failureModes: FailureModeOption[];
}) {
  const router = useRouter();
  const { order } = data;
  const [loading, setLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<OperationFeedback>(null);
  const [online, setOnline] = useState(true);
  const [completionOpen, setCompletionOpen] = useState(false);
  const activeLabor = data.labor.find(
    (entry) => entry.userId === userId && !entry.endedAt,
  );
  const requiredPending = data.tasks.filter(
    (task) =>
      task.required && !["COMPLETED", "PASS"].includes(task.responseStatus),
  ).length;
  const safetyRequired =
    order.safetyLevel === "CRITICAL" || Boolean(order.isolationRequired);

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

  const post = async (
    path: string,
    body?: Record<string, unknown>,
    queueable = false,
  ) => {
    if (!navigator.onLine && !queueable) {
      setFeedback({
        tone: "error",
        text: "Sin conexión: la acción no se ha enviado ni se ha marcado como guardada.",
      });
      return false;
    }
    setLoading(path);
    setFeedback(null);
    try {
      const queuedResult =
        queueable && body
          ? await postWithOfflineQueue(path, body)
          : {
              queued: false,
              response: await fetch(path, {
                method: "POST",
                headers: body
                  ? { "content-type": "application/json" }
                  : undefined,
                body: body ? JSON.stringify(body) : undefined,
              }),
            };
      if (queuedResult.queued) {
        setFeedback({
          tone: "success",
          text: "Guardado en este dispositivo. Se sincronizará al recuperar conexión.",
        });
        return true;
      }
      const response = queuedResult.response!;
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setFeedback({
          tone: "error",
          text: payload.error?.message ?? "La operación no se ha confirmado.",
        });
        return false;
      }
      setFeedback({
        tone: "success",
        text: "Guardado y confirmado en planta.",
      });
      router.refresh();
      return true;
    } catch {
      setFeedback({
        tone: "error",
        text: "No hay comunicación con el servidor. No se ha guardado ningún cambio.",
      });
      return false;
    } finally {
      setLoading(null);
    }
  };

  const workAction = (action: string, extra?: Record<string, unknown>) =>
    post(`/api/work-orders/${encodeURIComponent(order.number)}/actions`, {
      action,
      ...extra,
    });

  const answerTask = async (
    event: FormEvent<HTMLFormElement>,
    task: FieldWorkOrderData["tasks"][number],
  ) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = form.get("value");
    const value =
      task.responseType === "CHECKBOX" || task.responseType === "CONFIRMATION"
        ? raw === "true"
        : task.responseType === "NUMBER" || task.responseType === "READING"
          ? Number(raw)
          : String(raw ?? "");
    if (task.responseType === "NUMBER" || task.responseType === "READING") {
      await post(
        `/api/field/work-orders/${encodeURIComponent(order.number)}/measurements`,
        {
          taskId: task.id,
          meterId: task.meterId,
          label: task.title,
          unit: task.unit ?? "valor",
          value,
          minimumValue: task.minimumValue,
          maximumValue: task.maximumValue,
        },
        true,
      );
      return;
    }
    await post(
      `/api/field/work-orders/${encodeURIComponent(order.number)}/checklist`,
      {
        taskId: task.id,
        value,
      },
      true,
    );
  };

  const addEvidence = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const kind = String(form.get("kind"));
    const file = form.get("file") as File | null;
    const payload: Record<string, unknown> = {
      kind,
      stage: form.get("stage"),
      description: form.get("description"),
    };
    if (kind !== "NOTE") {
      if (!file?.size) {
        setFeedback({
          tone: "error",
          text: "Selecciona un archivo antes de añadir la evidencia.",
        });
        return;
      }
      payload.fileName = file.name;
      payload.contentType = file.type || "application/octet-stream";
      payload.dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
    }
    if (
      await post(
        `/api/field/work-orders/${encodeURIComponent(order.number)}/evidence`,
        payload,
        kind === "NOTE",
      )
    ) {
      formElement.reset();
    }
  };

  const complete = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (
      await workAction("COMPLETE", {
        diagnosis: form.get("diagnosis"),
        solution: form.get("solution"),
        failureModeId: form.get("failureModeId") || null,
        failureCause: form.get("failureCause") || null,
      })
    )
      setCompletionOpen(false);
  };

  const canStart = [
    "ASSIGNED",
    "PAUSED",
    "WAITING_PART",
    "WAITING_VENDOR",
  ].includes(order.status);
  const canEdit = !["COMPLETED", "CLOSED", "CANCELLED"].includes(order.status);

  return (
    <div className="field-workspace">
      <div className="field-workspace-status" data-online={online}>
        <span>
          <i />
          {online ? "Conectado" : "Sin conexión"}
        </span>
        <span>
          Actualizado {formatDateTime(order.actualStart ?? order.requestedAt)}
        </span>
      </div>
      <OfflineQueueStatus />

      {safetyRequired ? (
        <section
          className={`field-safety-card ${data.safetyAcknowledged ? "acknowledged" : "required"}`}
        >
          <header>
            <span>
              <ShieldAlert size={20} />
            </span>
            <div>
              <p className="overline">
                Contexto de seguridad · {order.safetyLevel}
              </p>
              <h2>
                {data.safetyAcknowledged
                  ? "Seguridad confirmada"
                  : "Confirma antes de intervenir"}
              </h2>
            </div>
            {data.safetyAcknowledged ? <CheckCircle2 size={19} /> : null}
          </header>
          <p>{order.safetySummary}</p>
          <div>
            <span>
              <HardHat size={15} />
              <strong>EPI</strong>
              {order.ppeRequired ?? "EPI estándar de planta"}
            </span>
            <span>
              <Wrench size={15} />
              <strong>Precaución</strong>
              {order.precautions ?? "Aplicar procedimiento seguro"}
            </span>
          </div>
          {order.isolationRequired ? (
            <em>
              <ShieldAlert size={14} /> Consignación / aislamiento obligatorio
            </em>
          ) : null}
          {!data.safetyAcknowledged && canEdit ? (
            <button
              className="primary-button"
              disabled={Boolean(loading) || !online}
              onClick={() =>
                void post(
                  `/api/field/work-orders/${encodeURIComponent(order.number)}/safety`,
                )
              }
              type="button"
            >
              <Check size={15} /> He revisado EPI, riesgos y aislamiento
            </button>
          ) : null}
        </section>
      ) : null}

      <nav
        className="field-section-nav"
        aria-label="Secciones de la intervención"
      >
        <a href="#checklist">
          <ClipboardCheck size={14} /> Checklist
        </a>
        <a href="#materials">
          <PackageCheck size={14} /> Materiales
        </a>
        <a href="#downtime">
          <TimerOff size={14} /> Downtime
        </a>
        <a href="#evidence">
          <Camera size={14} /> Evidencias
        </a>
      </nav>

      <section className="field-execution-panel" id="checklist">
        <header>
          <div>
            <p className="overline">Ejecución guiada</p>
            <h2>Checklist de trabajo</h2>
            <p>
              {
                data.tasks.filter((task) =>
                  ["COMPLETED", "PASS"].includes(task.responseStatus),
                ).length
              }{" "}
              de {data.tasks.length} pasos conformes
            </p>
          </div>
          <span className={requiredPending ? "pending" : "complete"}>
            {requiredPending ? `${requiredPending} obligatorios` : "Completo"}
          </span>
        </header>
        <div className="field-checklist">
          {data.tasks.map((task) => (
            <form
              className={`field-checklist-item status-${task.responseStatus.toLowerCase()}`}
              key={task.id}
              onSubmit={(event) => void answerTask(event, task)}
            >
              <span className="field-step-number">
                {["COMPLETED", "PASS"].includes(task.responseStatus) ? (
                  <Check size={16} />
                ) : (
                  String(task.sequence).padStart(2, "0")
                )}
              </span>
              <div className="field-step-copy">
                <span>
                  <strong>{task.title}</strong>
                  {task.required ? <em>Obligatorio</em> : null}
                </span>
                {task.description ? <p>{task.description}</p> : null}
                {task.unit ? (
                  <small>
                    Unidad: {task.unit}
                    {task.minimumValue != null || task.maximumValue != null
                      ? ` · rango ${task.minimumValue ?? "−∞"}–${task.maximumValue ?? "+∞"}`
                      : ""}
                  </small>
                ) : null}
              </div>
              <div className="field-step-input">
                {task.responseType === "CHECKBOX" ||
                task.responseType === "CONFIRMATION" ? (
                  <label className="field-confirm-control">
                    <input
                      defaultChecked={task.responseValue === "true"}
                      name="value"
                      type="checkbox"
                      value="true"
                    />
                    <span>Confirmado</span>
                  </label>
                ) : task.responseType === "PASS_FAIL" ? (
                  <select
                    defaultValue={task.responseValue ?? "PASS"}
                    name="value"
                  >
                    <option value="PASS">Conforme</option>
                    <option value="FAIL">No conforme</option>
                  </select>
                ) : task.responseType === "TEXT" ? (
                  <textarea
                    defaultValue={task.responseValue ?? ""}
                    name="value"
                    placeholder="Observación técnica"
                    required
                    rows={2}
                  />
                ) : (
                  <label className="field-number-control">
                    <Gauge size={15} />
                    <input
                      defaultValue={task.responseValue ?? ""}
                      name="value"
                      required
                      step="any"
                      type="number"
                    />
                    <span>{task.unit}</span>
                  </label>
                )}
                <button
                  disabled={!canEdit || Boolean(loading) || !online}
                  type="submit"
                >
                  {task.responseStatus === "PENDING" ? "Guardar" : "Actualizar"}
                </button>
              </div>
              {task.responseStatus === "FAIL" ? (
                <p className="field-nonconformity">
                  <AlertTriangle size={13} /> Resultado fuera de criterio.
                  Documenta la condición antes de completar.
                </p>
              ) : null}
            </form>
          ))}
        </div>
      </section>

      <section className="data-panel field-mobile-panel" id="materials">
        <header className="field-panel-heading">
          <PackageCheck size={18} />
          <div>
            <p className="overline">MRO en la intervención</p>
            <h2>Materiales</h2>
          </div>
        </header>
        <MaterialWorkspace
          canConsume={canEdit}
          canPlan={false}
          canRequest={canEdit}
          canReserve={false}
          number={order.number}
          options={data.materialOptions}
          plans={data.materialPlans}
        />
      </section>

      <section className="data-panel field-mobile-panel" id="downtime">
        <header className="field-panel-heading">
          <TimerOff size={18} />
          <div>
            <p className="overline">Impacto productivo</p>
            <h2>Downtime</h2>
          </div>
        </header>
        <DowntimeWorkspace
          canManage={canEdit}
          entries={data.downtime}
          number={order.number}
        />
      </section>

      <section className="data-panel field-mobile-panel" id="evidence">
        <header className="field-panel-heading">
          <Camera size={18} />
          <div>
            <p className="overline">Conocimiento capturado</p>
            <h2>Evidencias y notas</h2>
          </div>
        </header>
        {canEdit ? (
          <form className="field-evidence-form" onSubmit={addEvidence}>
            <div className="field-form-grid">
              <label>
                <span>Tipo</span>
                <select defaultValue="NOTE" name="kind">
                  <option value="NOTE">Nota</option>
                  <option value="PHOTO">Foto</option>
                  <option value="DOCUMENT">Documento</option>
                </select>
              </label>
              <label>
                <span>Momento</span>
                <select defaultValue="DURING" name="stage">
                  <option value="BEFORE">Antes</option>
                  <option value="DURING">Durante</option>
                  <option value="AFTER">Después</option>
                  <option value="GENERAL">General</option>
                </select>
              </label>
            </div>
            <label>
              <span>Descripción</span>
              <textarea name="description" required rows={2} />
            </label>
            <label className="field-file-input">
              <Upload size={16} />
              <span>Foto o documento (solo si el tipo lo requiere)</span>
              <input
                accept="image/*,application/pdf,text/plain"
                capture="environment"
                name="file"
                type="file"
              />
            </label>
            <button
              className="secondary-button"
              disabled={!online || Boolean(loading)}
              type="submit"
            >
              <FilePlus2 size={15} /> Añadir evidencia
            </button>
          </form>
        ) : null}
        <div className="field-evidence-list">
          {data.evidence.map((item) => (
            <article key={item.id}>
              <span>
                {item.kind === "PHOTO" ? (
                  <Camera size={16} />
                ) : item.kind === "NOTE" ? (
                  <MessageSquarePlus size={16} />
                ) : (
                  <FilePlus2 size={16} />
                )}
              </span>
              <div>
                <strong>{item.description}</strong>
                <small>
                  {item.stage} · {item.authorName} ·{" "}
                  {formatDateTime(item.createdAt)}
                </small>
                {item.fileName ? (
                  <a href={item.contentHref ?? undefined}>{item.fileName}</a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="data-panel field-mobile-panel">
        <header className="field-panel-heading">
          <Gauge size={18} />
          <div>
            <p className="overline">Lecturas persistidas</p>
            <h2>Mediciones</h2>
          </div>
        </header>
        <div className="field-measurement-list">
          {data.measurements.map((item) => (
            <article key={item.id}>
              <span className={item.result === "OUT_OF_RANGE" ? "out" : "in"}>
                {item.value}
                <small>{item.unit}</small>
              </span>
              <div>
                <strong>{item.label}</strong>
                <small>
                  {item.result === "IN_RANGE"
                    ? "Dentro de rango"
                    : item.result === "OUT_OF_RANGE"
                      ? "Fuera de rango"
                      : "Informativa"}{" "}
                  · {item.recordedBy}
                </small>
              </div>
              <time>{formatDateTime(item.recordedAt)}</time>
            </article>
          ))}
        </div>
      </section>

      <section className="field-time-summary">
        <span>
          <Clock3 size={16} />
          <small>Tiempo previsto</small>
          <strong>{formatDuration(order.estimatedMinutes)}</strong>
        </span>
        <span>
          <RefreshCw size={16} />
          <small>Tiempo registrado</small>
          <strong>{formatDuration(data.laborMinutes)}</strong>
        </span>
      </section>

      {completionOpen ? (
        <form className="field-completion-form" onSubmit={complete}>
          <header>
            <div>
              <p className="overline">Cerrar intervención de campo</p>
              <h2>Diagnóstico y resolución</h2>
            </div>
            <button
              aria-label="Cerrar formulario"
              onClick={() => setCompletionOpen(false)}
              type="button"
            >
              <Square size={16} />
            </button>
          </header>
          <label>
            <span>Diagnóstico</span>
            <textarea minLength={5} name="diagnosis" required rows={3} />
          </label>
          <label>
            <span>Resolución aplicada</span>
            <textarea minLength={5} name="solution" required rows={3} />
          </label>
          <div className="field-form-grid">
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
            </label>
            <label>
              <span>Causa</span>
              <select defaultValue="" name="failureCause">
                <option value="">Pendiente</option>
                <option value="WEAR">Desgaste</option>
                <option value="CONTAMINATION">Contaminación</option>
                <option value="MISALIGNMENT">Desalineación</option>
                <option value="LOOSE_CONNECTION">Conexión floja</option>
              </select>
            </label>
          </div>
          {requiredPending ? (
            <p className="operation-feedback error">
              <AlertTriangle size={14} /> Quedan {requiredPending} pasos
              obligatorios no conformes o pendientes.
            </p>
          ) : null}
          <button
            className="primary-button"
            disabled={requiredPending > 0 || Boolean(loading)}
            type="submit"
          >
            <CheckCircle2 size={15} /> Completar intervención
          </button>
        </form>
      ) : null}

      {feedback ? (
        <div
          className={`field-operation-toast ${feedback.tone}`}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          {feedback.tone === "error" ? (
            <AlertTriangle size={15} />
          ) : (
            <CheckCircle2 size={15} />
          )}
          {feedback.text}
        </div>
      ) : null}

      <footer className="field-sticky-actions">
        <span>
          <strong>{statusLabels[order.status] ?? order.status}</strong>
          <small>
            {activeLabor
              ? `Sesión desde ${formatDateTime(activeLabor.startedAt)}`
              : `${data.laborMinutes} min registrados`}
          </small>
        </span>
        {canStart ? (
          <button
            className="primary-button"
            disabled={
              !online ||
              Boolean(loading) ||
              (safetyRequired && !data.safetyAcknowledged)
            }
            onClick={() =>
              void workAction(
                order.status === "ASSIGNED" ? "START" : "RESUME",
                { technicianId: userId },
              )
            }
            type="button"
          >
            <Play size={17} />{" "}
            {order.status === "ASSIGNED" ? "Empezar" : "Reanudar"}
          </button>
        ) : null}
        {order.status === "IN_PROGRESS" ? (
          <>
            <button
              disabled={!online || Boolean(loading)}
              onClick={() => void workAction("PAUSE")}
              type="button"
            >
              <Pause size={16} /> Pausar
            </button>
            {activeLabor ? (
              <button
                disabled={!online || Boolean(loading)}
                onClick={() =>
                  void workAction("STOP_SESSION", {
                    laborSessionId: activeLabor.id,
                  })
                }
                type="button"
              >
                <Square size={16} /> Parar sesión
              </button>
            ) : null}
            <button
              className="success-command"
              disabled={!online || Boolean(loading)}
              onClick={() => setCompletionOpen(true)}
              type="button"
            >
              <CheckCircle2 size={16} /> Completar
            </button>
          </>
        ) : null}
      </footer>
    </div>
  );
}
