import {
  AlertTriangle,
  ArrowDownToLine,
  BadgeEuro,
  Boxes,
  LockKeyhole,
  PackageCheck,
  PackageOpen,
  Repeat2,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Warehouse,
  X,
} from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import {
  formatCurrency,
  formatDateTime,
  movementLabels,
} from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import {
  type InventoryFilters,
  listInventory,
} from "@/lib/server/repositories/inventory";

function stockTone(item: {
  available: number;
  reorderPoint: number;
  critical: number;
}): { label: string; tone: string } {
  if (Number(item.available) <= 0)
    return {
      label: item.critical ? "Stockout crítico" : "Sin disponible",
      tone: "critical",
    };
  if (Number(item.available) <= Number(item.reorderPoint))
    return { label: "Bajo reposición", tone: "warning" };
  return { label: "Disponible", tone: "success" };
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<InventoryFilters>;
}) {
  const filters = await searchParams;
  const session = await requireDemoSession();
  const data = await listInventory(
    {
      organizationId: session.organizationId,
      siteId: session.siteId,
    },
    filters,
  );
  const selectedStatus = data.selected ? stockTone(data.selected.part) : null;

  return (
    <div className="page-stack inventory-page">
      <PageHeader
        description="Stock trazable, políticas de reposición y compatibilidad técnica."
        eyebrow={`${session.siteCode} · Almacén MRO`}
        title="Inventario y recambios"
        actions={
          <div className="ledger-principle">
            <LockKeyhole size={14} />
            <span>El stock solo cambia mediante movimientos</span>
          </div>
        }
      />

      <section className="inventory-summary-strip">
        <div className="summary-warning">
          <span className="summary-icon warning">
            <AlertTriangle size={16} />
          </span>
          <span>
            <small>Bajo punto de pedido</small>
            <strong>{data.summary.belowReorder}</strong>
          </span>
        </div>
        <div className="summary-critical">
          <span className="summary-icon critical">
            <PackageOpen size={16} />
          </span>
          <span>
            <small>Stockouts críticos</small>
            <strong>{data.summary.criticalStockouts}</strong>
          </span>
        </div>
        <div className="summary-reserved">
          <span className="summary-icon steel">
            <PackageCheck size={16} />
          </span>
          <span>
            <small>Unidades reservadas</small>
            <strong>{data.summary.reservedUnits}</strong>
          </span>
        </div>
        <div className="summary-on-order">
          <span className="summary-icon good">
            <ShoppingCart size={16} />
          </span>
          <span>
            <small>Unidades en pedido</small>
            <strong>{data.summary.onOrderUnits}</strong>
          </span>
        </div>
      </section>

      <section className="toolbar-panel">
        <form className="filter-form inventory-filter-form" method="get">
          <label className="search-field">
            <Search size={16} />
            <input
              defaultValue={data.query}
              name="q"
              placeholder="SKU, descripción, fabricante o referencia"
            />
          </label>
          <select
            aria-label="Filtrar por categoría"
            defaultValue={
              typeof filters.category === "string" ? filters.category : ""
            }
            name="category"
          >
            <option value="">Todas las categorías</option>
            {data.categories.map((category) => (
              <option key={category.code} value={category.code}>
                {category.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por estado de stock"
            defaultValue={
              typeof filters.stock === "string" ? filters.stock : ""
            }
            name="stock"
          >
            <option value="">Cualquier stock</option>
            <option value="STOCKOUT">Sin disponible</option>
            <option value="REORDER">Bajo reposición</option>
            <option value="AVAILABLE">Disponible</option>
          </select>
          <label className="checkbox-filter">
            <input
              defaultChecked={filters.critical === "1"}
              name="critical"
              type="checkbox"
              value="1"
            />
            <span>Solo críticos</span>
          </label>
          <button className="filter-submit" type="submit">
            <SlidersHorizontal size={15} /> Aplicar
          </button>
        </form>
      </section>

      <section className="data-panel table-panel">
        {data.items.length ? (
          <div className="table-scroll">
            <table className="data-table inventory-table">
              <thead>
                <tr>
                  <th>Referencia MRO</th>
                  <th>Ubicación</th>
                  <th className="number-head">Físico</th>
                  <th className="number-head">Reservado</th>
                  <th className="number-head">Disponible</th>
                  <th className="number-head">En pedido</th>
                  <th>Política</th>
                  <th>Estado</th>
                  <th>Proveedor</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => {
                  const status = stockTone(item);
                  return (
                    <tr
                      className={`inventory-row stock-${status.tone}${item.critical ? " is-critical-part" : ""}`}
                      key={item.id}
                    >
                      <td data-label="Referencia">
                        <Link
                          className="part-identity"
                          href={{
                            pathname: "/inventory",
                            query: { ...filters, part: item.id },
                          }}
                        >
                          <span className="part-token">
                            {item.sku.split("-")[0]}
                          </span>
                          <span>
                            <small>{item.sku}</small>
                            <strong>{item.name}</strong>
                            <em>
                              {item.manufacturer} · {item.manufacturerRef}
                            </em>
                          </span>
                        </Link>
                      </td>
                      <td data-label="Ubicación">
                        <span className="stacked-cell">
                          <strong>{item.binCode}</strong>
                          <small>
                            {item.warehouseName}
                            {Number(item.locationCount) > 1
                              ? ` · ${item.locationCount} ubicaciones`
                              : ""}
                          </small>
                        </span>
                      </td>
                      <td className="number-cell" data-label="Físico">
                        <strong>{item.onHand}</strong>
                        <small>{item.unit}</small>
                      </td>
                      <td
                        className={`number-cell reserved-cell${Number(item.reserved) ? " active" : ""}`}
                        data-label="Reservado"
                      >
                        <strong>{item.reserved}</strong>
                        <small>{item.unit}</small>
                      </td>
                      <td
                        className={`number-cell emphasis ${status.tone}`}
                        data-label="Disponible"
                      >
                        <strong>{item.available}</strong>
                        <small>{item.unit}</small>
                      </td>
                      <td className="number-cell" data-label="En pedido">
                        <strong>{item.onOrder}</strong>
                        <small>{item.unit}</small>
                      </td>
                      <td data-label="Política">
                        <span className="stacked-cell">
                          <strong>
                            PR {item.reorderPoint} {item.unit}
                          </strong>
                          <small>
                            min {item.minStock} · máx {item.maxStock}
                          </small>
                        </span>
                      </td>
                      <td data-label="Estado">
                        <span className={`stock-status ${status.tone}`}>
                          <i />
                          {status.label}
                        </span>
                        {item.critical ? (
                          <small className="critical-part-note">
                            Repuesto crítico
                          </small>
                        ) : null}
                      </td>
                      <td data-label="Proveedor">
                        <span className="stacked-cell">
                          <strong>{item.vendorName ?? "Sin proveedor"}</strong>
                          <small>
                            {item.leadTimeDays} días ·{" "}
                            {formatCurrency(item.averageCost)}
                          </small>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            action={
              <Link className="secondary-button" href="/inventory">
                Limpiar filtros
              </Link>
            }
            description="No hay referencias que coincidan con la búsqueda actual."
            title="Sin resultados de inventario"
          />
        )}
        <Pagination
          basePath="/inventory"
          page={data.page}
          searchParams={filters}
          totalPages={data.totalPages}
        />
      </section>

      {data.selected ? (
        <>
          <Link
            aria-label="Cerrar detalle de recambio"
            className="drawer-backdrop"
            href="/inventory"
          />
          <aside
            aria-label={`Detalle de ${data.selected.part.sku}`}
            className={`inventory-drawer stock-${selectedStatus?.tone ?? "success"}`}
          >
            <header>
              <div>
                <p className="overline">Referencia MRO</p>
                <h2>{data.selected.part.name}</h2>
                <div className="drawer-header-meta">
                  <span className="mono">{data.selected.part.sku}</span>
                  {selectedStatus ? (
                    <span className={`stock-status ${selectedStatus.tone}`}>
                      <i />
                      {selectedStatus.label}
                    </span>
                  ) : null}
                  {data.selected.part.critical ? (
                    <span className="drawer-critical-note">
                      Repuesto crítico
                    </span>
                  ) : null}
                </div>
              </div>
              <Link aria-label="Cerrar" href="/inventory">
                <X size={18} />
              </Link>
            </header>
            <div className="drawer-scroll">
              <section className="drawer-stock">
                <div>
                  <small>Físico</small>
                  <strong>{data.selected.part.onHand}</strong>
                </div>
                <div>
                  <small>Reservado</small>
                  <strong>{data.selected.part.reserved}</strong>
                </div>
                <div className="accent">
                  <small>Disponible</small>
                  <strong>{data.selected.part.available}</strong>
                </div>
                <div>
                  <small>En pedido</small>
                  <strong>{data.selected.part.onOrder}</strong>
                </div>
              </section>
              <p className="drawer-description">
                {data.selected.part.description}
              </p>
              <section className="drawer-facts">
                <div>
                  <span>
                    <Warehouse size={14} /> Ubicación
                  </span>
                  <strong>{data.selected.part.binCode}</strong>
                </div>
                <div>
                  <span>Fabricante</span>
                  <strong>{data.selected.part.manufacturer}</strong>
                </div>
                <div>
                  <span>Referencia fabricante</span>
                  <strong className="mono">
                    {data.selected.part.manufacturerRef}
                  </strong>
                </div>
                <div>
                  <span>Proveedor principal</span>
                  <strong>{data.selected.part.vendorName}</strong>
                </div>
                <div>
                  <span>Lead time</span>
                  <strong>{data.selected.part.leadTimeDays} días</strong>
                </div>
                <div>
                  <span>Consumo · 90 días</span>
                  <strong>
                    {data.selected.recentConsumption} {data.selected.part.unit}
                  </strong>
                </div>
                <div>
                  <span>Coste medio</span>
                  <strong>
                    {formatCurrency(data.selected.part.averageCost)}
                  </strong>
                </div>
              </section>

              <section className="drawer-section">
                <div className="drawer-section-title">
                  <span>
                    <Warehouse size={15} /> Stock por ubicación
                  </span>
                  <small>{data.selected.locations.length}</small>
                </div>
                <div className="inventory-location-list">
                  {data.selected.locations.map((location) => (
                    <div key={location.id}>
                      <span>
                        <small>
                          {location.warehouseName}
                          {location.zoneName ? ` · ${location.zoneName}` : ""}
                        </small>
                        <strong className="mono">{location.binCode}</strong>
                      </span>
                      <span>
                        <strong>{location.available} disp.</strong>
                        <small>
                          {location.onHand} físico · {location.reserved}{" "}
                          reservado · {location.onOrder} pedido
                        </small>
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="drawer-section">
                <div className="drawer-section-title">
                  <span>
                    <BadgeEuro size={15} /> Proveedores aprobados
                  </span>
                  <small>{data.selected.offers.length}</small>
                </div>
                <div className="inventory-offer-list">
                  {data.selected.offers.map((offer) => (
                    <div
                      className={offer.preferred ? "preferred" : ""}
                      key={offer.id}
                    >
                      <span>
                        <small>
                          {offer.preferred ? "Preferido" : "Aprobado"}
                        </small>
                        <strong>{offer.vendorName}</strong>
                        <em>{offer.vendorSku}</em>
                      </span>
                      <span>
                        <strong>{formatCurrency(offer.unitPrice)}</strong>
                        <small>
                          MOQ {offer.minimumOrderQuantity} ·{" "}
                          {offer.leadTimeDays} días
                        </small>
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="drawer-section">
                <div className="drawer-section-title">
                  <span>
                    <Repeat2 size={15} /> Sustitutos aprobados
                  </span>
                  <small>{data.selected.substitutes.length}</small>
                </div>
                <div className="drawer-asset-list">
                  {data.selected.substitutes.length ? (
                    data.selected.substitutes.map((part) => (
                      <Link
                        href={`/inventory?part=${encodeURIComponent(part.partId)}`}
                        key={part.id}
                      >
                        <span>
                          <small>{part.sku}</small>
                          <strong>{part.name}</strong>
                        </span>
                        <em>{part.available} disp.</em>
                      </Link>
                    ))
                  ) : (
                    <p>Sin sustitutos aprobados.</p>
                  )}
                </div>
                <Link
                  className="secondary-button procurement-drawer-link"
                  href={{
                    pathname: "/procurement",
                    query: { part: data.selected.part.id },
                  }}
                >
                  Abrir aprovisionamiento
                </Link>
              </section>

              <section className="drawer-section">
                <div className="drawer-section-title">
                  <span>
                    <ArrowDownToLine size={15} /> Movimientos recientes
                  </span>
                  <small>Ledger inmutable</small>
                </div>
                <div className="movement-list">
                  {data.selected.movements.map((movement) => {
                    const delta =
                      Number(movement.deltaOnHand) ||
                      Number(movement.deltaReserved) ||
                      Number(movement.deltaOnOrder);
                    return (
                      <div key={movement.id}>
                        <span
                          className={
                            delta < 0
                              ? "movement-icon outbound"
                              : "movement-icon inbound"
                          }
                        >
                          {delta < 0 ? "−" : "+"}
                        </span>
                        <span>
                          <strong>
                            {movementLabels[movement.movementType] ??
                              movement.movementType}
                          </strong>
                          <small>{movement.reason}</small>
                          <em>
                            {movement.reference}
                            {movement.workOrderNumber &&
                            movement.workOrderNumber !== movement.reference
                              ? ` · ${movement.workOrderNumber}`
                              : ""}
                          </em>
                        </span>
                        <span>
                          <strong>
                            {delta > 0 ? "+" : ""}
                            {delta} {data.selected?.part.unit}
                          </strong>
                          <small>{formatDateTime(movement.occurredAt)}</small>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="drawer-section">
                <div className="drawer-section-title">
                  <span>
                    <Boxes size={15} /> Activos compatibles
                  </span>
                  <small>{data.selected.assets.length}</small>
                </div>
                <div className="drawer-asset-list">
                  {data.selected.assets.length ? (
                    data.selected.assets.map((asset) => (
                      <Link
                        href={`/assets/${encodeURIComponent(asset.code)}`}
                        key={asset.id}
                      >
                        <span>
                          <small>{asset.code}</small>
                          <strong>{asset.name}</strong>
                        </span>
                        <em>
                          {asset.relation === "PREFERRED"
                            ? "Preferente"
                            : "Compatible"}
                        </em>
                      </Link>
                    ))
                  ) : (
                    <p>Sin compatibilidades registradas.</p>
                  )}
                </div>
              </section>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
