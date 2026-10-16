"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type Option = { id: string; code: string; name: string };
type User = {
  id: string;
  email: string;
  fullName: string;
  jobTitle: string;
  roleKey: string;
  status: string;
  fullAreaAccess: number;
  fullWarehouseAccess: number;
};
export function UserAdminForm({
  selected,
  selectedAreas,
  selectedWarehouses,
  roles,
  areas,
  warehouses,
  allowFullArea,
  allowFullWarehouse,
}: {
  selected: User | null;
  selectedAreas: string[];
  selectedWarehouses: string[];
  roles: { key: string; name: string }[];
  areas: Option[];
  warehouses: Option[];
  allowFullArea: boolean;
  allowFullWarehouse: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null),
    [saving, setSaving] = useState(false);
  const [fullArea, setFullArea] = useState(
    Boolean(selected?.fullAreaAccess ?? allowFullArea),
  );
  const [fullWarehouse, setFullWarehouse] = useState(
    Boolean(selected?.fullWarehouseAccess ?? allowFullWarehouse),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      action: selected ? "UPDATE" : "CREATE",
      ...(selected
        ? { userId: selected.id, status: String(form.get("status")) }
        : {
            email: String(form.get("email")),
            fullName: String(form.get("fullName")),
            jobTitle: String(form.get("jobTitle")),
            password: String(form.get("password")),
          }),
      roleKey: String(form.get("roleKey")),
      fullAreaAccess: fullArea,
      areaIds: form.getAll("areaIds").map(String),
      fullWarehouseAccess: fullWarehouse,
      warehouseIds: form.getAll("warehouseIds").map(String),
    };
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        error?: { message: string };
        data?: { id: string };
      };
      if (!response.ok) {
        setError(result.error?.message ?? "No se pudo guardar el usuario.");
        return;
      }
      if (!selected && result.data?.id)
        router.push(
          `/governance/users?user=${encodeURIComponent(result.data.id)}`,
        );
      else router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="login-form" onSubmit={submit}>
      {!selected ? (
        <>
          <label className="field-label">
            Email
            <input className="input-shell" name="email" type="email" required />
          </label>
          <label className="field-label">
            Nombre completo
            <input className="input-shell" name="fullName" required />
          </label>
          <label className="field-label">
            Puesto
            <input className="input-shell" name="jobTitle" required />
          </label>
          <label className="field-label">
            Contraseña inicial segura
            <input
              className="input-shell"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={14}
              required
            />
          </label>
        </>
      ) : (
        <p>
          {selected.email} · {selected.jobTitle}
        </p>
      )}
      <label className="field-label">
        Rol
        <select name="roleKey" defaultValue={selected?.roleKey ?? "TECHNICIAN"}>
          {roles.map((role) => (
            <option key={role.key} value={role.key}>
              {role.name}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <label className="field-label">
          Acceso
          <select name="status" defaultValue={selected.status}>
            <option value="ACTIVE">Activo</option>
            <option value="INACTIVE">Desactivado</option>
          </select>
        </label>
      ) : null}
      <fieldset>
        <legend>Áreas</legend>
        {allowFullArea ? (
          <label>
            <input
              type="checkbox"
              checked={fullArea}
              onChange={(event) => setFullArea(event.target.checked)}
            />{" "}
            Todas las áreas
          </label>
        ) : null}
        {!fullArea ? (
          <div className="list-stack">
            {areas.map((area) => (
              <label key={area.id}>
                <input
                  type="checkbox"
                  name="areaIds"
                  value={area.id}
                  defaultChecked={selectedAreas.includes(area.id)}
                />
                {area.code} · {area.name}
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>
      <fieldset>
        <legend>Almacenes</legend>
        {allowFullWarehouse ? (
          <label>
            <input
              type="checkbox"
              checked={fullWarehouse}
              onChange={(event) => setFullWarehouse(event.target.checked)}
            />{" "}
            Todos los almacenes
          </label>
        ) : null}
        {!fullWarehouse ? (
          <div className="list-stack">
            {warehouses.map((warehouse) => (
              <label key={warehouse.id}>
                <input
                  type="checkbox"
                  name="warehouseIds"
                  value={warehouse.id}
                  defaultChecked={selectedWarehouses.includes(warehouse.id)}
                />
                {warehouse.code} · {warehouse.name}
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="primary-button" type="submit" disabled={saving}>
        {saving
          ? "Guardando…"
          : selected
            ? "Actualizar acceso"
            : "Crear usuario"}
      </button>
    </form>
  );
}
