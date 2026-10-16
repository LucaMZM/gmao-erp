"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type Option = { id: string; code: string; name: string };
type PartOption = { id: string; sku: string; name: string };
type BinOption = {
  id: string;
  code: string;
  description: string;
  warehouseId: string;
};
type Row = Record<string, string | number | null>;
const text = (row: Row | null, key: string) => String(row?.[key] ?? "");

export function MroMasterForms({
  categories,
  parts,
  vendors,
  warehouses,
  bins,
  selectedPart,
  selectedVendor,
  selectedWarehouse,
  selectedBin,
  fullWarehouseAccess,
}: {
  categories: Option[];
  parts: PartOption[];
  vendors: Option[];
  warehouses: Option[];
  bins: BinOption[];
  selectedPart: Row | null;
  selectedVendor: Row | null;
  selectedWarehouse: Row | null;
  selectedBin: Row | null;
  fullWarehouseAccess: boolean;
}) {
  const router = useRouter(),
    [error, setError] = useState<string | null>(null),
    [saving, setSaving] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>, type: string) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    const raw = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    ) as Record<string, string>;
    const payload: Record<string, unknown> = { type, ...raw };
    for (const field of [
      "standardCost",
      "minStock",
      "maxStock",
      "reorderPoint",
      "leadTimeDays",
      "unitPrice",
      "minimumOrderQuantity",
    ])
      if (field in payload) payload[field] = Number(raw[field]);
    for (const field of ["critical", "preferred"])
      if (field in payload) payload[field] = raw[field] === "true";
    for (const field of [
      "parentId",
      "zoneId",
      "primaryVendorId",
      "manufacturer",
      "manufacturerRef",
      "contactName",
      "email",
      "phone",
      "address",
      "validUntil",
      "note",
    ])
      if (payload[field] === "") payload[field] = null;
    try {
      const response = await fetch("/api/master-data/mro", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        data?: { id: string };
        error?: { message: string };
      };
      if (!response.ok) {
        setError(result.error?.message ?? "No se pudo guardar.");
        return;
      }
      if (type === "PART" && result.data?.id)
        router.push(
          `/inventory/manage?part=${encodeURIComponent(result.data.id)}`,
        );
      else if (type === "VENDOR" && result.data?.id)
        router.push(
          `/inventory/manage?vendor=${encodeURIComponent(result.data.id)}`,
        );
      else router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setSaving(false);
    }
  }
  const button = (label: string) => (
    <button className="secondary-button" disabled={saving} type="submit">
      {saving ? "Guardando…" : label}
    </button>
  );
  return (
    <div className="detail-layout">
      <div className="detail-main-column">
        <section className="data-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Catálogo</p>
              <h2>
                {selectedPart
                  ? `Editar ${text(selectedPart, "sku")}`
                  : "Nuevo recambio"}
              </h2>
            </div>
          </div>
          <form
            className="login-form"
            onSubmit={(event) => save(event, "PART")}
          >
            {selectedPart ? (
              <input type="hidden" name="id" value={text(selectedPart, "id")} />
            ) : null}
            <label className="field-label">
              SKU
              <input
                className="input-shell"
                name="sku"
                defaultValue={text(selectedPart, "sku")}
                required
              />
            </label>
            <label className="field-label">
              Nombre
              <input
                className="input-shell"
                name="name"
                defaultValue={text(selectedPart, "name")}
                required
              />
            </label>
            <label className="field-label">
              Descripción
              <input
                className="input-shell"
                name="description"
                defaultValue={text(selectedPart, "description")}
              />
            </label>
            <label className="field-label">
              Categoría
              <select
                name="categoryId"
                defaultValue={text(selectedPart, "category_id")}
                required
              >
                <option value="">Seleccionar</option>
                {categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Unidad
              <input
                className="input-shell"
                name="unit"
                defaultValue={text(selectedPart, "unit") || "ud"}
                required
              />
            </label>
            <label className="field-label">
              Fabricante
              <input
                className="input-shell"
                name="manufacturer"
                defaultValue={text(selectedPart, "manufacturer")}
              />
            </label>
            <label className="field-label">
              Referencia fabricante
              <input
                className="input-shell"
                name="manufacturerRef"
                defaultValue={text(selectedPart, "manufacturer_ref")}
              />
            </label>
            <label className="field-label">
              Coste estándar
              <input
                className="input-shell"
                type="number"
                min="0"
                step="0.01"
                name="standardCost"
                defaultValue={text(selectedPart, "standard_cost") || "0"}
                required
              />
            </label>
            <label className="field-label">
              Moneda
              <select
                name="currency"
                defaultValue={text(selectedPart, "currency") || "EUR"}
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
              </select>
            </label>
            <label className="field-label">
              Estado
              <select
                name="status"
                defaultValue={text(selectedPart, "status") || "ACTIVE"}
              >
                <option value="ACTIVE">Activo</option>
                <option value="INACTIVE">Inactivo</option>
              </select>
            </label>
            {button("Guardar recambio")}
          </form>
        </section>
        <section className="data-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Sourcing</p>
              <h2>
                {selectedVendor
                  ? `Editar ${text(selectedVendor, "name")}`
                  : "Nuevo proveedor"}
              </h2>
            </div>
          </div>
          <form
            className="login-form"
            onSubmit={(event) => save(event, "VENDOR")}
          >
            {selectedVendor ? (
              <input
                type="hidden"
                name="id"
                value={text(selectedVendor, "id")}
              />
            ) : null}
            <label className="field-label">
              Código
              <input
                className="input-shell"
                name="code"
                defaultValue={text(selectedVendor, "code")}
                required
              />
            </label>
            <label className="field-label">
              Nombre
              <input
                className="input-shell"
                name="name"
                defaultValue={text(selectedVendor, "name")}
                required
              />
            </label>
            <label className="field-label">
              Categoría
              <input
                className="input-shell"
                name="category"
                defaultValue={text(selectedVendor, "category") || "MRO"}
                required
              />
            </label>
            <label className="field-label">
              Contacto
              <input
                className="input-shell"
                name="contactName"
                defaultValue={text(selectedVendor, "contact_name")}
              />
            </label>
            <label className="field-label">
              Email
              <input
                className="input-shell"
                type="email"
                name="email"
                defaultValue={text(selectedVendor, "email")}
              />
            </label>
            <label className="field-label">
              Teléfono
              <input
                className="input-shell"
                name="phone"
                defaultValue={text(selectedVendor, "phone")}
              />
            </label>
            <label className="field-label">
              Dirección
              <input
                className="input-shell"
                name="address"
                defaultValue={text(selectedVendor, "address")}
              />
            </label>
            <label className="field-label">
              Condiciones de pago
              <input
                className="input-shell"
                name="paymentTerms"
                defaultValue={text(selectedVendor, "payment_terms") || "NET30"}
                required
              />
            </label>
            <label className="field-label">
              Moneda
              <select
                name="currency"
                defaultValue={text(selectedVendor, "currency") || "EUR"}
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
              </select>
            </label>
            <label className="field-label">
              Lead time (días)
              <input
                className="input-shell"
                type="number"
                min="0"
                name="leadTimeDays"
                defaultValue={text(selectedVendor, "lead_time_days") || "7"}
                required
              />
            </label>
            <label className="field-label">
              Estado
              <select
                name="status"
                defaultValue={text(selectedVendor, "status") || "ACTIVE"}
              >
                <option value="ACTIVE">Activo</option>
                <option value="INACTIVE">Inactivo</option>
              </select>
            </label>
            {button("Guardar proveedor")}
          </form>
        </section>
        <section className="data-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Ubicación física</p>
              <h2>{selectedWarehouse ? "Editar almacén" : "Nuevo almacén"}</h2>
            </div>
          </div>
          <form
            className="login-form"
            onSubmit={(event) => save(event, "WAREHOUSE")}
          >
            {selectedWarehouse ? (
              <input
                type="hidden"
                name="id"
                value={text(selectedWarehouse, "id")}
              />
            ) : null}
            <label className="field-label">
              Código
              <input
                className="input-shell"
                name="code"
                defaultValue={text(selectedWarehouse, "code")}
                required
              />
            </label>
            <label className="field-label">
              Nombre
              <input
                className="input-shell"
                name="name"
                defaultValue={text(selectedWarehouse, "name")}
                required
              />
            </label>
            <label className="field-label">
              Estado
              <select
                name="status"
                defaultValue={text(selectedWarehouse, "status") || "ACTIVE"}
              >
                <option value="ACTIVE">Activo</option>
                <option value="INACTIVE">Inactivo</option>
              </select>
            </label>
            {button("Guardar almacén")}
          </form>
          <h3>
            {selectedBin
              ? "Editar ubicación de almacén"
              : "Nueva ubicación de almacén"}
          </h3>
          <form className="login-form" onSubmit={(event) => save(event, "BIN")}>
            {selectedBin ? (
              <input type="hidden" name="id" value={text(selectedBin, "id")} />
            ) : null}
            <label className="field-label">
              Almacén
              <select
                name="warehouseId"
                defaultValue={text(selectedBin, "warehouse_id")}
                required
              >
                <option value="">Seleccionar</option>
                {warehouses.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Código
              <input
                className="input-shell"
                name="code"
                defaultValue={text(selectedBin, "code")}
                required
              />
            </label>
            <label className="field-label">
              Descripción
              <input
                className="input-shell"
                name="description"
                defaultValue={text(selectedBin, "description")}
              />
            </label>
            <label className="field-label">
              Estado
              <select
                name="status"
                defaultValue={text(selectedBin, "status") || "ACTIVE"}
              >
                <option value="ACTIVE">Activo</option>
                <option value="INACTIVE">Inactivo</option>
              </select>
            </label>
            {button("Guardar ubicación")}
          </form>
        </section>
      </div>
      <aside className="detail-side-column">
        <section className="data-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Clasificación</p>
              <h2>Nueva categoría</h2>
            </div>
          </div>
          <form
            className="login-form"
            onSubmit={(event) => save(event, "CATEGORY")}
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
              Categoría padre
              <select name="parentId">
                <option value="">Ninguna</option>
                {categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code}
                  </option>
                ))}
              </select>
            </label>
            {button("Crear categoría")}
          </form>
        </section>
        <section className="data-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Reposición</p>
              <h2>Política por planta</h2>
            </div>
          </div>
          <form
            className="login-form"
            onSubmit={(event) => save(event, "POLICY")}
          >
            <label className="field-label">
              Recambio
              <select name="partId" required>
                <option value="">Seleccionar</option>
                {parts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku} · {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Proveedor principal
              <select name="primaryVendorId">
                <option value="">Ninguno</option>
                {vendors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Crítico
              <select name="critical">
                <option value="false">No</option>
                <option value="true">Sí</option>
              </select>
            </label>
            {[
              ["minStock", "Mínimo"],
              ["maxStock", "Máximo"],
              ["reorderPoint", "Punto de pedido"],
              ["leadTimeDays", "Lead time (días)"],
            ].map(([key, label]) => (
              <label className="field-label" key={key}>
                {label}
                <input
                  className="input-shell"
                  type="number"
                  min="0"
                  step={key === "leadTimeDays" ? "1" : "0.01"}
                  name={key}
                  defaultValue="0"
                  required
                />
              </label>
            ))}
            {button("Guardar política")}
          </form>
        </section>
        <section className="data-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Sourcing</p>
              <h2>Nueva oferta</h2>
            </div>
          </div>
          <form
            className="login-form"
            onSubmit={(event) => save(event, "OFFER")}
          >
            <label className="field-label">
              Recambio
              <select name="partId" required>
                <option value="">Seleccionar</option>
                {parts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Proveedor
              <select name="vendorId" required>
                <option value="">Seleccionar</option>
                {vendors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Referencia proveedor
              <input className="input-shell" name="vendorSku" required />
            </label>
            <label className="field-label">
              Precio unitario
              <input
                className="input-shell"
                type="number"
                min="0"
                step="0.01"
                name="unitPrice"
                required
              />
            </label>
            <input type="hidden" name="currency" value="EUR" />
            <label className="field-label">
              Pedido mínimo
              <input
                className="input-shell"
                type="number"
                min="0.01"
                step="0.01"
                name="minimumOrderQuantity"
                defaultValue="1"
                required
              />
            </label>
            <label className="field-label">
              Lead time
              <input
                className="input-shell"
                type="number"
                min="0"
                name="leadTimeDays"
                defaultValue="7"
                required
              />
            </label>
            <label className="field-label">
              Preferida
              <select name="preferred">
                <option value="false">No</option>
                <option value="true">Sí</option>
              </select>
            </label>
            {button("Registrar oferta")}
          </form>
        </section>
        <section className="data-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Compatibilidad</p>
              <h2>Sustituto aprobado</h2>
            </div>
          </div>
          <form
            className="login-form"
            onSubmit={(event) => save(event, "SUBSTITUTE")}
          >
            <label className="field-label">
              Pieza base
              <select name="partId" required>
                <option value="">Seleccionar</option>
                {parts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Sustituto
              <select name="substitutePartId" required>
                <option value="">Seleccionar</option>
                {parts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Estado
              <select name="approvalStatus">
                <option value="APPROVED">Aprobado</option>
                <option value="PENDING">Pendiente</option>
                <option value="REJECTED">Rechazado</option>
              </select>
            </label>
            <label className="field-label">
              Nota
              <input className="input-shell" name="note" />
            </label>
            {button("Guardar sustituto")}
          </form>
        </section>
        <section className="data-panel">
          <h2>Referencias recientes</h2>
          <div className="list-stack">
            {parts.slice(0, 15).map((item) => (
              <Link
                href={`/inventory/manage?part=${encodeURIComponent(item.id)}`}
                key={item.id}
              >
                {item.sku} · {item.name}
              </Link>
            ))}
            {vendors.slice(0, 8).map((item) => (
              <Link
                href={`/inventory/manage?vendor=${encodeURIComponent(item.id)}`}
                key={item.id}
              >
                {item.code} · {item.name}
              </Link>
            ))}
            {warehouses.slice(0, 8).map((item) => (
              <Link
                href={`/inventory/manage?warehouse=${encodeURIComponent(item.id)}`}
                key={item.id}
              >
                {item.code} · {item.name}
              </Link>
            ))}
            {bins.slice(0, 8).map((item) => (
              <Link
                href={`/inventory/manage?bin=${encodeURIComponent(item.id)}`}
                key={item.id}
              >
                {item.code} · {item.description}
              </Link>
            ))}
          </div>
        </section>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {!fullWarehouseAccess ? (
          <p>Tu ámbito de almacén limita los datos maestros disponibles.</p>
        ) : null}
      </aside>
    </div>
  );
}
