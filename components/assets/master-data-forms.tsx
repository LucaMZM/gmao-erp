"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import Link from "next/link";

type Location = {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  status: string;
  description: string | null;
};
type AssetOption = {
  id: string;
  code: string;
  name: string;
  functionalLocationId: string;
};
type ClassOption = { id: string; code: string; name: string; family: string };
type VendorOption = { id: string; code: string; name: string };

export function MasterDataForms({
  locations,
  classes,
  vendors,
  assets,
  selectedAsset,
  selectedLocation,
}: {
  locations: Location[];
  classes: ClassOption[];
  vendors: VendorOption[];
  assets: AssetOption[];
  selectedAsset: Record<string, string | null> | null;
  selectedLocation: Location | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function save(
    event: FormEvent<HTMLFormElement>,
    path: string,
    redirectTo?: string,
  ) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    const payload = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    ) as Record<string, string>;
    for (const key of [
      "parentId",
      "parentAssetId",
      "vendorId",
      "commissionedAt",
      "warrantyUntil",
      "description",
      "technicalSummary",
      "manufacturer",
      "model",
      "serialNumber",
    ]) {
      if (key in payload && !payload[key]) payload[key] = "";
    }
    if (payload.commissionedAt)
      payload.commissionedAt = new Date(
        `${payload.commissionedAt}T00:00:00Z`,
      ).toISOString();
    else delete payload.commissionedAt;
    if (payload.warrantyUntil)
      payload.warrantyUntil = new Date(
        `${payload.warrantyUntil}T00:00:00Z`,
      ).toISOString();
    else delete payload.warrantyUntil;
    for (const key of ["parentId", "parentAssetId", "vendorId"])
      if (payload[key] === "") delete payload[key];
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        data?: { code?: string };
        error?: { message: string };
      };
      if (!response.ok) {
        setError(result.error?.message ?? "No se pudo guardar.");
        return;
      }
      if (redirectTo === "asset" && result.data?.code)
        router.push(`/assets/${encodeURIComponent(result.data.code)}`);
      else router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="detail-layout">
      <div className="detail-main-column">
        <section className="data-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Estructura industrial</p>
              <h2>
                {selectedLocation
                  ? `Editar ${selectedLocation.code}`
                  : "Nueva ubicación"}
              </h2>
            </div>
          </div>
          <form
            className="login-form"
            onSubmit={(event) => save(event, "/api/master-data/locations")}
          >
            {selectedLocation ? (
              <input type="hidden" name="id" value={selectedLocation.id} />
            ) : null}
            <label className="field-label">
              Código
              <input
                className="input-shell"
                name="code"
                defaultValue={selectedLocation?.code}
                required
                maxLength={40}
              />
            </label>
            <label className="field-label">
              Nombre
              <input
                className="input-shell"
                name="name"
                defaultValue={selectedLocation?.name}
                required
                maxLength={160}
              />
            </label>
            <label className="field-label">
              Tipo
              <select
                name="type"
                defaultValue={selectedLocation?.type ?? "AREA"}
              >
                {[
                  "AREA",
                  "PRODUCTION_LINE",
                  "SYSTEM",
                  "ZONE",
                  "WAREHOUSE",
                  "WORKSHOP",
                  "LAB",
                  "UTILITY",
                ].map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Ubicación padre
              <select
                name="parentId"
                defaultValue={selectedLocation?.parentId ?? ""}
              >
                <option value="">Raíz de planta</option>
                {locations
                  .filter(
                    (item) =>
                      item.id !== selectedLocation?.id &&
                      item.status === "ACTIVE",
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} · {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field-label">
              Descripción
              <input
                className="input-shell"
                name="description"
                defaultValue={selectedLocation?.description ?? ""}
              />
            </label>
            <label className="field-label">
              Estado
              <select
                name="status"
                defaultValue={selectedLocation?.status ?? "ACTIVE"}
              >
                <option value="ACTIVE">Activa</option>
                <option value="INACTIVE">Inactiva</option>
              </select>
            </label>
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? "Guardando…" : "Guardar ubicación"}
            </button>
          </form>
        </section>
        <section className="data-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Expediente técnico</p>
              <h2>
                {selectedAsset
                  ? `Editar ${selectedAsset.code}`
                  : "Nuevo activo"}
              </h2>
            </div>
          </div>
          <form
            className="login-form"
            onSubmit={(event) =>
              save(event, "/api/master-data/assets", "asset")
            }
          >
            {selectedAsset ? (
              <input type="hidden" name="id" value={selectedAsset.id ?? ""} />
            ) : null}
            <label className="field-label">
              Código
              <input
                className="input-shell"
                name="code"
                defaultValue={selectedAsset?.code ?? ""}
                required
              />
            </label>
            <label className="field-label">
              Nombre
              <input
                className="input-shell"
                name="name"
                defaultValue={selectedAsset?.name ?? ""}
                required
              />
            </label>
            <label className="field-label">
              Descripción
              <input
                className="input-shell"
                name="description"
                defaultValue={selectedAsset?.description ?? ""}
              />
            </label>
            <label className="field-label">
              Tipo
              <select
                name="kind"
                defaultValue={selectedAsset?.kind ?? "EQUIPMENT"}
              >
                <option value="EQUIPMENT">Equipo</option>
                <option value="ASSEMBLY">Conjunto</option>
                <option value="COMPONENT">Componente</option>
              </select>
            </label>
            <label className="field-label">
              Ubicación
              <select
                name="functionalLocationId"
                defaultValue={selectedAsset?.functional_location_id ?? ""}
                required
              >
                <option value="">Seleccionar</option>
                {locations
                  .filter((item) => item.status === "ACTIVE")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} · {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field-label">
              Activo padre
              <select
                name="parentAssetId"
                defaultValue={selectedAsset?.parent_asset_id ?? ""}
              >
                <option value="">Ninguno</option>
                {assets
                  .filter((item) => item.id !== selectedAsset?.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} · {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field-label">
              Clase
              <select
                name="assetClassId"
                defaultValue={selectedAsset?.asset_class_id ?? ""}
                required
              >
                <option value="">Seleccionar</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Criticidad
              <select
                name="criticality"
                defaultValue={selectedAsset?.criticality ?? "MEDIUM"}
              >
                {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Estado
              <select
                name="status"
                defaultValue={selectedAsset?.status ?? "OPERATING"}
              >
                {[
                  "OPERATING",
                  "DEGRADED",
                  "DOWN",
                  "MAINTENANCE",
                  "STANDBY",
                  "RETIRED",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Fabricante
              <input
                className="input-shell"
                name="manufacturer"
                defaultValue={selectedAsset?.manufacturer ?? ""}
              />
            </label>
            <label className="field-label">
              Modelo
              <input
                className="input-shell"
                name="model"
                defaultValue={selectedAsset?.model ?? ""}
              />
            </label>
            <label className="field-label">
              Serie
              <input
                className="input-shell"
                name="serialNumber"
                defaultValue={selectedAsset?.serial_number ?? ""}
              />
            </label>
            <label className="field-label">
              Proveedor
              <select
                name="vendorId"
                defaultValue={selectedAsset?.vendor_id ?? ""}
              >
                <option value="">Sin proveedor</option>
                {vendors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Puesta en servicio
              <input
                className="input-shell"
                type="date"
                name="commissionedAt"
                defaultValue={
                  selectedAsset?.commissioned_at?.slice(0, 10) ?? ""
                }
              />
            </label>
            <label className="field-label">
              Garantía hasta
              <input
                className="input-shell"
                type="date"
                name="warrantyUntil"
                defaultValue={selectedAsset?.warranty_until?.slice(0, 10) ?? ""}
              />
            </label>
            <label className="field-label">
              Resumen técnico
              <textarea
                name="technicalSummary"
                defaultValue={selectedAsset?.technical_summary ?? ""}
              />
            </label>
            <button
              className="primary-button"
              disabled={
                saving || classes.length === 0 || locations.length === 0
              }
              type="submit"
            >
              {saving ? "Guardando…" : "Guardar activo"}
            </button>
          </form>
        </section>
      </div>
      <aside className="detail-side-column">
        <section className="data-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Clasificación</p>
              <h2>Nueva clase de activo</h2>
            </div>
          </div>
          <form
            className="login-form"
            onSubmit={(event) => save(event, "/api/master-data/asset-classes")}
          >
            <label className="field-label">
              Código
              <input className="input-shell" name="code" required />
            </label>
            <label className="field-label">
              Nombre
              <input className="input-shell" name="name" required />
            </label>
            <label className="field-label">
              Familia
              <input className="input-shell" name="family" required />
            </label>
            <button
              className="secondary-button"
              disabled={saving}
              type="submit"
            >
              Crear clase
            </button>
          </form>
        </section>
        <section className="data-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Estructura de planta</p>
              <h2>Ubicaciones existentes</h2>
            </div>
          </div>
          <div className="list-stack">
            {locations.slice(0, 30).map((item) => (
              <Link
                key={item.id}
                href={`/assets/manage?location=${encodeURIComponent(item.id)}`}
              >
                {item.code} · {item.name}
              </Link>
            ))}
          </div>
        </section>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </aside>
    </div>
  );
}
