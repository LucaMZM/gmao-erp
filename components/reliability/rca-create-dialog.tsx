"use client";

import { AlertTriangle, SearchCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type Option = { id: string; code?: string; name: string };

function localDate(days = 14): string {
  const value = new Date(Date.now() + days * 86_400_000);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function RcaCreateDialog({
  assets,
  failureModes,
  owners,
  canCreate,
  defaultAssetId,
  defaultFailureModeId,
  sourceWorkOrderId,
  autoOpen = false,
}: {
  assets: Option[];
  failureModes: Option[];
  owners: Option[];
  canCreate: boolean;
  defaultAssetId?: string;
  defaultFailureModeId?: string;
  sourceWorkOrderId?: string;
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canCreate) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/reliability/rca", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetId: form.get("assetId"),
          sourceWorkOrderId: sourceWorkOrderId ?? null,
          failureModeId: form.get("failureModeId") || null,
          ownerId: form.get("ownerId"),
          problem: form.get("problem"),
          impact: form.get("impact"),
          targetAt: new Date(String(form.get("targetAt"))).toISOString(),
        }),
      });
      const payload = (await response.json()) as {
        data?: { number: string };
        error?: { message: string };
      };
      if (!response.ok || !payload.data) {
        setError(payload.error?.message ?? "No se ha podido iniciar la RCA.");
        return;
      }
      router.push(
        `/reliability/rca/${encodeURIComponent(payload.data.number)}`,
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
        <SearchCheck size={15} /> Iniciar RCA
      </button>
      {open ? (
        <div className="dialog-backdrop" onMouseDown={() => setOpen(false)}>
          <section
            aria-label="Iniciar análisis de causa raíz"
            aria-modal="true"
            className="incident-dialog rca-create-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <div>
                <p className="overline">Investigación operativa</p>
                <h2>Iniciar análisis de causa raíz</h2>
                <p>
                  Parte del activo y del impacto observado; la evidencia y las
                  acciones se completan en el workspace.
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
              <label>
                <span>Activo</span>
                <select
                  defaultValue={defaultAssetId ?? assets[0]?.id}
                  name="assetId"
                  required
                >
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.code} · {asset.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Modo de fallo</span>
                <select
                  defaultValue={defaultFailureModeId ?? ""}
                  name="failureModeId"
                >
                  <option value="">Por formalizar</option>
                  {failureModes.map((mode) => (
                    <option key={mode.id} value={mode.id}>
                      {mode.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wide-field">
                <span>Problema investigado</span>
                <textarea
                  autoFocus
                  maxLength={2000}
                  minLength={10}
                  name="problem"
                  placeholder="Qué patrón o fallo necesita explicación"
                  required
                  rows={3}
                />
              </label>
              <label className="wide-field">
                <span>Impacto</span>
                <textarea
                  maxLength={2000}
                  minLength={5}
                  name="impact"
                  placeholder="Downtime, calidad, seguridad o coste observado"
                  required
                  rows={2}
                />
              </label>
              <label>
                <span>Responsable</span>
                <select defaultValue={owners[0]?.id} name="ownerId" required>
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                    </option>
                  ))}
                </select>
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
                  {loading ? "Iniciando…" : "Crear investigación"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
