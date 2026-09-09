"use client";

import { AlertTriangle, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import type { PreventiveCatalog } from "@/lib/server/repositories/preventive";

function initialDueValue(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(8, 0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function MaintenancePlanCreateDialog({
  catalog,
}: {
  catalog: PreventiveCatalog;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetId, setAssetId] = useState(catalog.assets[0]?.id ?? "");
  const [triggerMode, setTriggerMode] = useState<
    "CALENDAR" | "METER" | "WHICHEVER_FIRST"
  >("CALENDAR");
  const assetMeters = useMemo(
    () => catalog.meters.filter((meter) => meter.assetId === assetId),
    [assetId, catalog.meters],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const firstDue = String(form.get("firstDueAt") ?? "");
    const skillId = String(form.get("skillId") ?? "");
    const certificationId = String(form.get("certificationId") ?? "");
    const partId = String(form.get("partId") ?? "");
    const tasks = String(form.get("tasks") ?? "")
      .split("\n")
      .map((title) => title.trim())
      .filter(Boolean)
      .map((title) => ({ title, required: true }));
    const calendarEnabled = triggerMode !== "METER";
    const meterEnabled = triggerMode !== "CALENDAR";
    try {
      const response = await fetch("/api/maintenance-plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetId,
          ownerId: form.get("ownerId"),
          title: form.get("title"),
          description: form.get("description"),
          criticality: form.get("criticality"),
          priority: form.get("priority"),
          estimatedMinutes: Number(form.get("estimatedMinutes")),
          triggerMode,
          calendarUnit: calendarEnabled ? form.get("calendarUnit") : null,
          calendarInterval: calendarEnabled
            ? Number(form.get("calendarInterval"))
            : null,
          firstDueAt: calendarEnabled ? new Date(firstDue).toISOString() : null,
          meterId: meterEnabled ? form.get("meterId") || null : null,
          meterInterval: meterEnabled
            ? Number(form.get("meterInterval"))
            : null,
          meterThreshold: meterEnabled
            ? Number(form.get("meterThreshold"))
            : null,
          leadDays: Number(form.get("leadDays")),
          tasks,
          skills: skillId
            ? [
                {
                  skillId,
                  minimumLevel: Number(form.get("minimumLevel")),
                },
              ]
            : [],
          certificationIds: certificationId ? [certificationId] : [],
          materials: partId
            ? [{ partId, quantity: Number(form.get("materialQuantity")) }]
            : [],
        }),
      });
      const payload = (await response.json()) as {
        data?: { code: string };
        error?: { message: string };
      };
      if (!response.ok || !payload.data) {
        setError(payload.error?.message ?? "No se ha podido crear el plan.");
        return;
      }
      setOpen(false);
      router.push(
        `/maintenance-plans/${encodeURIComponent(payload.data.code)}`,
      );
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
        <Plus size={15} /> Nuevo plan
      </button>
      {open ? (
        <div className="dialog-backdrop" onMouseDown={() => setOpen(false)}>
          <section
            aria-label="Crear plan preventivo"
            aria-modal="true"
            className="incident-dialog maintenance-plan-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <div>
                <p className="overline">Preventivo · nueva estrategia</p>
                <h2>Crear plan de mantenimiento</h2>
                <p>
                  Define el trabajo y el disparador. Planta y ubicación se
                  heredan del activo.
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
            <form className="operation-form plan-create-form" onSubmit={submit}>
              <label className="wide-field">
                <span>Título del plan</span>
                <input
                  autoFocus
                  maxLength={180}
                  minLength={5}
                  name="title"
                  placeholder="Ej. Inspección mensual del accionamiento LM-01"
                  required
                />
              </label>
              <label className="wide-field">
                <span>Objetivo y alcance</span>
                <textarea
                  maxLength={2000}
                  minLength={10}
                  name="description"
                  placeholder="Qué se inspecciona, por qué y qué resultado se espera"
                  required
                  rows={2}
                />
              </label>
              <label>
                <span>Activo</span>
                <select
                  name="assetId"
                  onChange={(event) => setAssetId(event.target.value)}
                  required
                  value={assetId}
                >
                  {catalog.assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.code} · {asset.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Responsable</span>
                <select
                  defaultValue={catalog.owners[0]?.id}
                  name="ownerId"
                  required
                >
                  {catalog.owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name} · {owner.jobTitle}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Disparador</span>
                <select
                  name="triggerMode"
                  onChange={(event) =>
                    setTriggerMode(
                      event.target.value as
                        "CALENDAR" | "METER" | "WHICHEVER_FIRST",
                    )
                  }
                  value={triggerMode}
                >
                  <option value="CALENDAR">Calendario</option>
                  <option value="METER">Contador</option>
                  <option value="WHICHEVER_FIRST">Lo que ocurra primero</option>
                </select>
              </label>
              <label>
                <span>Duración estimada</span>
                <input
                  defaultValue={60}
                  min={1}
                  name="estimatedMinutes"
                  required
                  type="number"
                />
              </label>
              {triggerMode !== "METER" ? (
                <div className="plan-trigger-grid wide-field">
                  <label>
                    <span>Cada</span>
                    <input
                      defaultValue={1}
                      min={1}
                      name="calendarInterval"
                      required
                      type="number"
                    />
                  </label>
                  <label>
                    <span>Unidad</span>
                    <select defaultValue="MONTH" name="calendarUnit">
                      <option value="DAY">Días</option>
                      <option value="WEEK">Semanas</option>
                      <option value="MONTH">Meses</option>
                    </select>
                  </label>
                  <label>
                    <span>Primera ejecución</span>
                    <input
                      defaultValue={initialDueValue()}
                      name="firstDueAt"
                      required
                      type="datetime-local"
                    />
                  </label>
                </div>
              ) : null}
              {triggerMode !== "CALENDAR" ? (
                <div className="plan-trigger-grid wide-field">
                  <label>
                    <span>Contador</span>
                    <select
                      defaultValue={assetMeters[0]?.id ?? ""}
                      name="meterId"
                      required
                    >
                      <option disabled value="">
                        {assetMeters.length
                          ? "Seleccionar"
                          : "El activo no tiene contador"}
                      </option>
                      {assetMeters.map((meter) => (
                        <option key={meter.id} value={meter.id}>
                          {meter.code} · {meter.name} ({meter.lastValue ?? "—"}{" "}
                          {meter.unit})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Intervalo</span>
                    <input
                      defaultValue={500}
                      min={0.01}
                      name="meterInterval"
                      required
                      step="any"
                      type="number"
                    />
                  </label>
                  <label>
                    <span>Primer umbral</span>
                    <input
                      defaultValue={1000}
                      min={0}
                      name="meterThreshold"
                      required
                      step="any"
                      type="number"
                    />
                  </label>
                </div>
              ) : null}
              <label className="wide-field">
                <span>Checklist · una tarea por línea</span>
                <textarea
                  defaultValue={
                    "Aplicar consignación y comprobar seguridad\nRealizar inspección planificada\nRegistrar resultado y liberar equipo"
                  }
                  minLength={3}
                  name="tasks"
                  required
                  rows={4}
                />
              </label>
              <details className="plan-advanced-fields wide-field">
                <summary>Recursos, prioridad y anticipación</summary>
                <div className="plan-advanced-grid">
                  <label>
                    <span>Skill principal</span>
                    <select defaultValue="" name="skillId">
                      <option value="">Sin requisito</option>
                      {catalog.skills.map((skill) => (
                        <option key={skill.id} value={skill.id}>
                          {skill.code} · {skill.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Nivel mínimo</span>
                    <select defaultValue="2" name="minimumLevel">
                      {[1, 2, 3, 4, 5].map((level) => (
                        <option key={level} value={level}>
                          Nivel {level}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Certificación</span>
                    <select defaultValue="" name="certificationId">
                      <option value="">No requerida</option>
                      {catalog.certifications.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.code} · {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Material previsto</span>
                    <select defaultValue="" name="partId">
                      <option value="">Sin material previsto</option>
                      {catalog.parts.map((part) => (
                        <option key={part.id} value={part.id}>
                          {part.sku} · {part.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Cantidad</span>
                    <input
                      defaultValue={1}
                      min={0.01}
                      name="materialQuantity"
                      step="any"
                      type="number"
                    />
                  </label>
                  <label>
                    <span>Prioridad</span>
                    <select defaultValue="P4_NORMAL" name="priority">
                      <option value="P2_URGENT">P2 · Urgente</option>
                      <option value="P3_HIGH">P3 · Alta</option>
                      <option value="P4_NORMAL">P4 · Normal</option>
                      <option value="P5_LOW">P5 · Baja</option>
                    </select>
                  </label>
                  <label>
                    <span>Criticidad</span>
                    <select defaultValue="HIGH" name="criticality">
                      <option value="CRITICAL">Crítica</option>
                      <option value="HIGH">Alta</option>
                      <option value="MEDIUM">Media</option>
                      <option value="LOW">Baja</option>
                    </select>
                  </label>
                  <label>
                    <span>Generar con antelación</span>
                    <input
                      defaultValue={7}
                      max={90}
                      min={0}
                      name="leadDays"
                      type="number"
                    />
                  </label>
                </div>
              </details>
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
                  {loading ? "Creando…" : "Crear plan"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
