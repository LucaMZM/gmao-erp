"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export function WorkOrderCostForm({
  number,
  vendors,
}: {
  number: string;
  vendors: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        `/api/work-orders/${encodeURIComponent(number)}/costs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: form.get("kind"),
            description: form.get("description"),
            amountCents: Math.round(Number(form.get("amount")) * 100),
            vendorId: form.get("vendorId") || null,
          }),
        },
      );
      const payload = (await response.json()) as {
        error?: { message: string };
      };
      if (!response.ok) {
        setError(
          payload.error?.message ?? "No se ha podido registrar el coste.",
        );
        return;
      }
      event.currentTarget.reset();
      router.refresh();
    } catch {
      setError("El servicio no está disponible.");
    } finally {
      setPending(false);
    }
  }
  return (
    <details className="work-cost-control">
      <summary>Añadir coste externo</summary>
      <form className="login-form" onSubmit={submit}>
        <label className="field-label">
          Concepto
          <select name="kind" defaultValue="EXTERNAL_VENDOR">
            <option value="EXTERNAL_VENDOR">Servicio externo</option>
            <option value="OTHER">Otro</option>
          </select>
        </label>
        <label className="field-label">
          Descripción
          <input name="description" minLength={5} maxLength={500} required />
        </label>
        <label className="field-label">
          Importe EUR
          <input name="amount" type="number" min="0.01" step="0.01" required />
        </label>
        <label className="field-label">
          Proveedor (opcional)
          <select name="vendorId" defaultValue="">
            <option value="">Sin proveedor</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
        </label>
        {error ? (
          <p role="alert" className="operation-feedback error">
            {error}
          </p>
        ) : null}
        <button className="secondary-button" disabled={pending} type="submit">
          {pending ? "Registrando…" : "Registrar coste"}
        </button>
      </form>
    </details>
  );
}
