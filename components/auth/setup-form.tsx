"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const fields = [
  ["organizationCode", "Código organización", "MIFABRICA"],
  ["organizationName", "Nombre organización", "Mi Fábrica, S.L."],
  ["siteCode", "Código planta", "ES-PL-01"],
  ["siteName", "Nombre planta", "Planta Principal"],
  ["siteShortName", "Nombre corto", "Principal"],
  ["city", "Ciudad", "Valencia"],
  ["adminEmail", "Email administrador", "admin@empresa.example"],
  ["adminName", "Nombre administrador", "Nombre Apellido"],
] as const;

export function SetupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const token = String(form.get("bootstrapToken") ?? "");
    const body = Object.fromEntries([
      ...fields.map(([key]) => [key, String(form.get(key) ?? "")]),
      ["adminPassword", String(form.get("adminPassword") ?? "")],
    ]);
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(payload.error?.message ?? "No se pudo aprovisionar.");
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <form className="login-form" onSubmit={submit}>
      {fields.map(([key, label, placeholder]) => (
        <label className="field-label" htmlFor={key} key={key}>
          {label}
          <input
            autoComplete={key === "adminEmail" ? "email" : "off"}
            className="input-shell"
            id={key}
            name={key}
            placeholder={placeholder}
            required
            type={key === "adminEmail" ? "email" : "text"}
          />
        </label>
      ))}
      <label className="field-label" htmlFor="adminPassword">
        Contraseña administrador
        <input
          autoComplete="new-password"
          className="input-shell"
          id="adminPassword"
          minLength={14}
          name="adminPassword"
          required
          type="password"
        />
      </label>
      <label className="field-label" htmlFor="bootstrapToken">
        Token de aprovisionamiento privado
        <input
          autoComplete="off"
          className="input-shell"
          id="bootstrapToken"
          name="bootstrapToken"
          required
          type="password"
        />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="login-submit" disabled={loading} type="submit">
        {loading ? "Preparando entorno…" : "Crear organización inicial"}
      </button>
    </form>
  );
}
