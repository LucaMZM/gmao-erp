import {
  ArrowRight,
  Boxes,
  CircleDollarSign,
  ClipboardCheck,
  ClockAlert,
  PackageOpen,
  ShoppingCart,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  RequisitionCreateDialog,
  TransferWorkspace,
} from "@/components/procurement/procurement-actions";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { can } from "@/lib/domain/permissions";
import { hasPermission } from "@/lib/domain/governance";
import { formatCurrency, formatDateTime } from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import { getProcurementCenter } from "@/lib/server/repositories/procurement";
import { tenantScope } from "@/lib/server/repositories/shared";

export default async function ProcurementPage() {
  const session = await requireDemoSession();
  if (
    !hasPermission(session.permissionCodes, "procurement.approve") &&
    !hasPermission(session.permissionCodes, "procurement.receive")
  )
    redirect("/overview");
  const data = await getProcurementCenter(tenantScope(session));
  const signals = [
    {
      label: "Pendientes aprobación",
      value: data.summary.pendingApproval,
      icon: ClipboardCheck,
      tone: data.summary.pendingApproval ? "warning" : "good",
    },
    {
      label: "Pedidos abiertos",
      value: data.summary.openOrders,
      icon: ShoppingCart,
      tone: "steel",
    },
    {
      label: "Entregas retrasadas",
      value: data.summary.delayedOrders,
      icon: ClockAlert,
      tone: data.summary.delayedOrders ? "critical" : "good",
    },
    {
      label: "Recepciones parciales",
      value: data.summary.partialReceipts,
      icon: Truck,
      tone: data.summary.partialReceipts ? "warning" : "good",
    },
    {
      label: "Stockouts críticos",
      value: data.summary.criticalStockouts,
      icon: PackageOpen,
      tone: data.summary.criticalStockouts ? "critical" : "good",
    },
    {
      label: "Spend · 90 días",
      value: formatCurrency(data.summary.recentSpend),
      icon: CircleDollarSign,
      tone: "steel",
    },
  ];
  return (
    <div className="page-stack procurement-page">
      <PageHeader
        actions={
          <RequisitionCreateDialog
            canCreate={can(session, "PURCHASE_REQUISITION_CREATE")}
            parts={data.parts}
            warehouses={data.warehouses}
          />
        }
        description="Necesidades MRO, proveedores, pedidos y recepciones con trazabilidad hasta la orden de trabajo."
        eyebrow={`${session.siteCode} · Supply operativo`}
        title="Procurement"
      />
      <section
        className="procurement-kpi-strip"
        aria-label="Señales de aprovisionamiento"
      >
        {signals.map((signal) => {
          const Icon = signal.icon;
          return (
            <article
              className={`procurement-kpi tone-${signal.tone}`}
              key={signal.label}
            >
              <span>
                <small>{signal.label}</small>
                <strong>{signal.value}</strong>
              </span>
              <Icon size={17} />
            </article>
          );
        })}
      </section>
      <section className="procurement-focus-grid">
        <article className="data-panel procurement-risk-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Decisión operativa</p>
              <h2>Critical spare risk</h2>
              <p>
                Riesgo explicable por cobertura, lead time, sustitutos y demanda
                de OT.
              </p>
            </div>
            <Link className="text-action" href="/inventory?stock=REORDER">
              Abrir inventario <ArrowRight size={14} />
            </Link>
          </div>
          <div className="procurement-risk-list">
            {data.risks.length ? (
              data.risks.slice(0, 7).map((item) => (
                <Link
                  href={`/inventory?part=${encodeURIComponent(item.partId)}`}
                  key={item.partId}
                >
                  <span
                    className={`risk-score risk-${item.risk.level.toLowerCase()}`}
                  >
                    {item.risk.score}
                  </span>
                  <span>
                    <small>
                      {item.sku} · {item.risk.level}
                    </small>
                    <strong>{item.name}</strong>
                    <em>{item.risk.reasons.join(" · ")}</em>
                  </span>
                  <span className="risk-stock">
                    <strong>{item.available}</strong>
                    <small>disp. / {item.onOrder} pedido</small>
                  </span>
                </Link>
              ))
            ) : (
              <EmptyState
                description="No hay referencias fuera de cobertura."
                title="Suministro controlado"
              />
            )}
          </div>
        </article>
        <aside className="data-panel supplier-panel">
          <div className="panel-title-row">
            <div>
              <p className="overline">Red de suministro</p>
              <h2>Proveedores aprobados</h2>
            </div>
            <span className="panel-count">{data.vendors.length}</span>
          </div>
          <div className="supplier-list">
            {data.vendors.slice(0, 7).map((vendor) => (
              <div key={vendor.id}>
                <span className="supplier-token">
                  {vendor.code.slice(0, 2)}
                </span>
                <span>
                  <strong>{vendor.name}</strong>
                  <small>
                    {vendor.suppliedParts} referencias · {vendor.leadTimeDays}{" "}
                    días
                  </small>
                  <em>
                    {vendor.contactName ?? vendor.email ?? "Contacto pendiente"}
                  </em>
                </span>
                <span>
                  <small>Última compra</small>
                  <strong>{formatDateTime(vendor.lastPurchaseAt)}</strong>
                </span>
              </div>
            ))}
          </div>
        </aside>
      </section>
      <section className="data-panel table-panel procurement-table-panel">
        <div className="panel-title-row">
          <div>
            <p className="overline">Demandas</p>
            <h2>Requisiciones de compra</h2>
            <p>
              {data.summary.pendingRequisitions} necesidades activas en el
              centro.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table procurement-table">
            <thead>
              <tr>
                <th>Requisición</th>
                <th>Necesidad</th>
                <th>Origen</th>
                <th>Solicitante</th>
                <th>Fecha necesaria</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.requisitions.map((item) => (
                <tr key={item.id}>
                  <td data-label="Requisición">
                    <Link
                      className="procurement-id"
                      href={`/procurement/requisitions/${encodeURIComponent(item.number)}`}
                    >
                      <small>{item.number}</small>
                      <strong>{item.itemSummary}</strong>
                    </Link>
                  </td>
                  <td data-label="Necesidad">
                    <span className="stacked-cell">
                      <strong>
                        {item.urgency === "CRITICAL"
                          ? "Crítica"
                          : item.urgency === "HIGH"
                            ? "Alta"
                            : "Normal"}
                      </strong>
                      <small>{item.warehouseName}</small>
                    </span>
                  </td>
                  <td data-label="Origen">
                    <span className="stacked-cell">
                      <strong>{item.origin.replaceAll("_", " ")}</strong>
                      <small>
                        {item.workOrderNumber ?? "Sin OT vinculada"}
                      </small>
                    </span>
                  </td>
                  <td data-label="Solicitante">{item.requesterName}</td>
                  <td data-label="Necesaria">{formatDateTime(item.needBy)}</td>
                  <td data-label="Estado">
                    <StatusBadge value={item.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="data-panel table-panel procurement-table-panel">
        <div className="panel-title-row">
          <div>
            <p className="overline">Supply pipeline</p>
            <h2>Pedidos de compra</h2>
            <p>Precios históricos, progreso de entrega y recepción.</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table procurement-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Proveedor</th>
                <th>Recepción</th>
                <th>Entrega prevista</th>
                <th>Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((order) => (
                <tr key={order.id}>
                  <td data-label="Pedido">
                    <Link
                      className="procurement-id"
                      href={`/procurement/purchase-orders/${encodeURIComponent(order.number)}`}
                    >
                      <small>{order.number}</small>
                      <strong>{order.requisitionNumber}</strong>
                    </Link>
                  </td>
                  <td data-label="Proveedor">
                    <span className="stacked-cell">
                      <strong>{order.vendorName}</strong>
                      <small>{order.vendorCode}</small>
                    </span>
                  </td>
                  <td data-label="Recepción">
                    <span className="receipt-progress">
                      <i
                        style={{
                          width: `${Math.min(100, order.orderedQuantity ? (order.receivedQuantity / order.orderedQuantity) * 100 : 0)}%`,
                        }}
                      />
                      <small>
                        {order.receivedQuantity} / {order.orderedQuantity}
                      </small>
                    </span>
                  </td>
                  <td data-label="Prevista">
                    {formatDateTime(order.expectedAt)}
                  </td>
                  <td data-label="Total">
                    <strong>{formatCurrency(order.total)}</strong>
                  </td>
                  <td data-label="Estado">
                    <StatusBadge value={order.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <TransferWorkspace
        canTransfer={can(session, "INVENTORY_TRANSFER")}
        data={data}
      />
      <p className="procurement-freshness">
        <Boxes size={13} /> Proyecciones derivadas de ubicaciones y movimientos
        · {formatDateTime(data.generatedAt)}
      </p>
    </div>
  );
}
