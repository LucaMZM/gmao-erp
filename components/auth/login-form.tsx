"use client";

import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { type FormEvent, useState } from "react";

const accounts = [
  { label: "Responsable de Mantenimiento", email: "responsable@mazmi.demo" },
  { label: "Planner", email: "planner@mazmi.demo" },
  { label: "Ingeniero de Fiabilidad", email: "fiabilidad@mazmi.demo" },
  { label: "Técnico", email: "tecnico4@mazmi.demo" },
  { label: "Almacén", email: "almacen@mazmi.demo" },
  { label: "Viewer", email: "viewer@mazmi.demo" },
];

export function LoginForm() {
  const [email, setEmail] = useState(accounts[0].email);
  const [password, setPassword] = useState("Mazmi2026!");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as {
        data?: { redirectTo: string };
        error?: { message: string };
      };
      if (!response.ok) {
        setError(payload.error?.message ?? "No se ha podido iniciar sesión.");
        return;
      }
      window.location.assign(payload.data?.redirectTo ?? "/overview");
    } catch {
      setError("El servicio no está disponible. Reinténtalo en unos segundos.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="login-form" onSubmit={submit}>
      <label className="field-label" htmlFor="demo-account">
        Perfil demo
      </label>
      <div className="select-wrap">
        <select
          id="demo-account"
          onChange={(event) => setEmail(event.target.value)}
          value={email}
        >
          {accounts.map((account) => (
            <option key={account.email} value={account.email}>
              {account.label}
            </option>
          ))}
        </select>
      </div>

      <label className="field-label" htmlFor="email">
        Email
      </label>
      <div className="input-shell">
        <Mail size={16} />
        <input
          autoComplete="username"
          id="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </div>

      <div className="password-label">
        <label className="field-label" htmlFor="password">
          Contraseña
        </label>
        <span>Demo segura</span>
      </div>
      <div className="input-shell">
        <LockKeyhole size={16} />
        <input
          autoComplete="current-password"
          id="password"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          required
          type={showPassword ? "text" : "password"}
          value={password}
        />
        <button
          aria-label={
            showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
          }
          onClick={() => setShowPassword((visible) => !visible)}
          type="button"
        >
          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="login-submit" disabled={loading} type="submit">
        <span>
          {loading ? "Preparando tu centro…" : "Entrar a Mazmi Factory"}
        </span>
        {loading ? <i className="button-spinner" /> : <ArrowRight size={17} />}
      </button>

      <p className="demo-hint">
        <span>Credencial compartida</span>
        <code>Mazmi2026!</code>
      </p>
    </form>
  );
}
