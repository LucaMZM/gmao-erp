"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export function LaborRateForm({
  users,
}: {
  users: Array<{ id: string; name: string }>;
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
      const response = await fetch("/api/admin/labor-rates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: form.get("userId"),
          hourlyRateCents: Math.round(Number(form.get("hourlyRate")) * 100),
          effectiveFrom: new Date(
            String(form.get("effectiveFrom")),
          ).toISOString(),
        }),
      });
      const payload = (await response.json()) as {
        error?: { message: string };
      };
      if (!response.ok) {
        setError(payload.error?.message ?? "No se pudo registrar la tarifa.");
        return;
      }
      event.currentTarget.reset();
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servicio.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="login-form" onSubmit={submit}>
      <label className="field-label">
        Persona
        <select name="userId" required>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field-label">
        Tarifa horaria EUR
        <input
          name="hourlyRate"
          type="number"
          min="0"
          max="10000"
          step="0.01"
          required
        />
      </label>
      <label className="field-label">
        Vigente desde
        <input name="effectiveFrom" type="date" required />
      </label>
      <p className="text-xs">
        Las sesiones finalizadas conservan su coste histórico; la nueva tarifa
        solo se usa al iniciar trabajo posterior.
      </p>
      {error ? (
        <p className="operation-feedback error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="primary-button"
        disabled={pending || !users.length}
        type="submit"
      >
        {pending ? "Guardando…" : "Añadir tarifa"}
      </button>
    </form>
  );
}
