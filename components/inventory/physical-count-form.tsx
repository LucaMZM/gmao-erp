"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export function PhysicalCountForm({
  stockId,
  version,
  physical,
  reserved,
  unit,
}: {
  stockId: string;
  version: number;
  physical: number;
  reserved: number;
  unit: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setPending(true);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/inventory/counts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stockId,
          expectedVersion: version,
          countedQuantity: Number(data.get("countedQuantity")),
          reason: String(data.get("reason") ?? ""),
        }),
      });
      const payload = (await response.json()) as {
        error?: { message: string };
      };
      if (!response.ok) {
        setError(
          payload.error?.message ?? "No se ha podido registrar el conteo.",
        );
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("El servicio no está disponible. Reinténtalo.");
    } finally {
      setPending(false);
    }
  }
  return (
    <details className="physical-count-control">
      <summary>Registrar conteo físico</summary>
      <form onSubmit={submit}>
        <label>
          Contado ({unit})
          <input
            name="countedQuantity"
            type="number"
            min={reserved}
            step="any"
            defaultValue={physical}
            required
          />
        </label>
        <label>
          Motivo / referencia
          <input
            name="reason"
            minLength={8}
            maxLength={500}
            placeholder="Conteo cíclico · turno de mañana"
            required
          />
        </label>
        <small>
          Físico actual {physical} · reservado {reserved}. Un ajuste inferior a
          lo reservado se bloquea.
        </small>
        {error ? (
          <p className="operation-feedback error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="operation-feedback success" role="status">
            Conteo registrado en el ledger.
          </p>
        ) : null}
        <button className="secondary-button" disabled={pending} type="submit">
          {pending ? "Registrando…" : "Confirmar conteo"}
        </button>
      </form>
    </details>
  );
}

export function InitialPhysicalCountForm({
  parts,
  bins,
}: {
  parts: Array<{ id: string; sku: string; name: string }>;
  bins: Array<{
    id: string;
    code: string;
    description: string;
    warehouseId: string;
  }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setPending(true);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/inventory/counts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          partId: String(data.get("partId")),
          binId: String(data.get("binId")),
          expectedVersion: 0,
          countedQuantity: Number(data.get("countedQuantity")),
          reason: String(data.get("reason") ?? ""),
        }),
      });
      const payload = (await response.json()) as {
        error?: { message: string };
      };
      if (!response.ok) {
        setError(
          payload.error?.message ??
            "No se ha podido registrar el conteo inicial.",
        );
        return;
      }
      setSaved(true);
      event.currentTarget.reset();
      router.refresh();
    } catch {
      setError("El servicio no está disponible. Reinténtalo.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="data-panel">
      <h2>Primer conteo en una ubicación</h2>
      <p>
        Para una referencia importada sin saldo previo. El conteo crea saldo y
        movimiento de ajuste juntos.
      </p>
      <form className="login-form" onSubmit={submit}>
        <label className="field-label">
          Recambio
          <select name="partId" required defaultValue="">
            <option value="" disabled>
              Seleccionar referencia
            </option>
            {parts.map((part) => (
              <option key={part.id} value={part.id}>
                {part.sku} · {part.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Ubicación física
          <select name="binId" required defaultValue="">
            <option value="" disabled>
              Seleccionar ubicación
            </option>
            {bins.map((bin) => (
              <option key={bin.id} value={bin.id}>
                {bin.code} · {bin.description}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Unidades contadas
          <input
            name="countedQuantity"
            type="number"
            min="0"
            step="any"
            required
          />
        </label>
        <label className="field-label">
          Motivo / referencia
          <input name="reason" minLength={8} maxLength={500} required />
        </label>
        {error ? (
          <p className="operation-feedback error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="operation-feedback success" role="status">
            Conteo y movimiento registrados.
          </p>
        ) : null}
        <button
          className="secondary-button"
          disabled={pending || !parts.length || !bins.length}
          type="submit"
        >
          {pending ? "Registrando…" : "Registrar primer conteo"}
        </button>
      </form>
    </section>
  );
}
