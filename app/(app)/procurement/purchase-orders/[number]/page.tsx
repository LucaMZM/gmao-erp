import {
  ArrowLeft,
  Boxes,
  CircleDollarSign,
  History,
  MapPin,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PurchaseOrderActions } from "@/components/procurement/procurement-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { can } from "@/lib/domain/permissions";
import { formatCurrency, formatDateTime } from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import { getPurchaseOrderDetail } from "@/lib/server/repositories/procurement";

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const session = await requireDemoSession();
  const { number } = await params;
  const data = await getPurchaseOrderDetail(
    { organizationId: session.organizationId, siteId: session.siteId },
    decodeURIComponent(number),
  );
  if (!data) notFound();
  return (
    <div className="page-stack detail-page procurement-detail-page">
      <nav className="breadcrumbs">
        <Link href="/procurement">
          <ArrowLeft size={14} /> Procurement
        </Link>
        <span>/</span>
        <strong>{data.number}</strong>
      </nav>
      <header className="entity-detail-header procurement-detail-header">
        <div className="detail-identity">
          <span className="large-asset-token order-token">PO</span>
          <div>
            <p className="overline">
              {data.number} · {data.requisitionNumber}
            </p>
            <h1>{data.vendorName}</h1>
            <p>
              Pedido MRO para {data.warehouseName} · entrega prevista{" "}
              {formatDateTime(data.expectedAt)}.
            </p>
          </div>
        </div>
        <div className="detail-status-cluster">
          <StatusBadge value={data.status} />
          {data.workOrderNumber ? (
            <Link
              className="secondary-button"
              href={`/work-orders/${encodeURIComponent(data.workOrderNumber)}`}
            >
              Abrir {data.workOrderNumber}
            </Link>
          ) : null}
        </div>
      </header>
      <section className="work-order-summary-strip">
        <div>
          <span>
            <Truck size={14} /> Proveedor
          </span>
          <strong>{data.vendorCode}</strong>
        </div>
        <div>
          <span>
            <MapPin size={14} /> Recepción
          </span>
          <strong>{data.destinationBin}</strong>
        </div>
        <div>
          <span>
            <Boxes size={14} /> Progreso
          </span>
          <strong>
            {data.receivedQuantity} / {data.orderedQuantity}
          </strong>
        </div>
        <div>
          <span>
            <CircleDollarSign size={14} /> Total
          </span>
          <strong>{formatCurrency(data.total)}</strong>
        </div>
      </section>
      <PurchaseOrderActions
        canManage={can(session, "PURCHASE_ORDER_MANAGE")}
        canReceive={can(session, "INVENTORY_RECEIVE")}
        order={data}
      />
      <div className="detail-layout">
        <div className="detail-main-column">
          <section className="data-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Compromiso de suministro</p>
                <h2>Líneas de pedido</h2>
                <p>
                  Precio y descripción quedan congelados en el momento de
                  conversión.
                </p>
              </div>
              <Boxes size={17} />
            </div>
            <div className="purchase-order-lines">
              {data.lines.map((line) => (
                <div key={line.id}>
                  <span>
                    <small>
                      {line.sku} · {line.vendorSku}
                    </small>
                    <strong>{line.name}</strong>
                  </span>
                  <span>
                    <small>Pedido</small>
                    <strong>
                      {line.orderedQuantity} {line.unit}
                    </strong>
                  </span>
                  <span>
                    <small>Recibido / pendiente</small>
                    <strong>
                      {line.receivedQuantity} / {line.outstandingQuantity}
                    </strong>
                  </span>
                  <span>
                    <small>Precio histórico</small>
                    <strong>{formatCurrency(line.unitPrice)}</strong>
                  </span>
                  <strong>{formatCurrency(line.lineTotal)}</strong>
                </div>
              ))}
            </div>
            <footer className="purchase-order-total">
              <span>
                Subtotal {formatCurrency(data.subtotal)} · IVA {data.taxRate}%{" "}
                {formatCurrency(data.taxAmount)}
              </span>
              <strong>{formatCurrency(data.total)}</strong>
            </footer>
          </section>
          <section className="data-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Entradas contabilizadas</p>
                <h2>Recepciones</h2>
                <p>Cada albarán genera movimientos de ledger idempotentes.</p>
              </div>
              <Truck size={17} />
            </div>
            <div className="receipt-list">
              {data.receipts.length ? (
                data.receipts.map((receipt) => (
                  <div key={receipt.id}>
                    <span>
                      <small>
                        {receipt.number} ·{" "}
                        {receipt.externalReference ?? "Sin referencia externa"}
                      </small>
                      <strong>{receipt.itemSummary}</strong>
                      <em>
                        {receipt.receiverName} ·{" "}
                        {formatDateTime(receipt.receivedAt)}
                      </em>
                    </span>
                    <strong>{formatCurrency(receipt.totalCost)}</strong>
                  </div>
                ))
              ) : (
                <p className="compact-empty-material">
                  Todavía no hay recepciones registradas.
                </p>
              )}
            </div>
          </section>
        </div>
        <aside className="detail-rail">
          <section className="data-panel detail-facts">
            <div className="panel-title-row">
              <div>
                <p className="overline">Condiciones</p>
                <h2>Pedido y proveedor</h2>
              </div>
              <CircleDollarSign size={16} />
            </div>
            <dl>
              <div>
                <dt>Contacto</dt>
                <dd>
                  {data.contactName ?? "No indicado"}
                  <small>{data.vendorEmail}</small>
                </dd>
              </div>
              <div>
                <dt>Pago</dt>
                <dd>{data.paymentTerms}</dd>
              </div>
              <div>
                <dt>Aprobado</dt>
                <dd>{formatDateTime(data.orderedAt)}</dd>
              </div>
              <div>
                <dt>Enviado</dt>
                <dd>{formatDateTime(data.sentAt)}</dd>
              </div>
              <div>
                <dt>Recibido</dt>
                <dd>{formatDateTime(data.receivedAt)}</dd>
              </div>
              <div>
                <dt>Requisición</dt>
                <dd>
                  <Link
                    href={`/procurement/requisitions/${encodeURIComponent(data.requisitionNumber)}`}
                  >
                    {data.requisitionNumber}
                  </Link>
                </dd>
              </div>
            </dl>
          </section>
          <section className="data-panel event-timeline-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Trazabilidad</p>
                <h2>Historial</h2>
              </div>
              <History size={16} />
            </div>
            <div className="event-timeline">
              {data.events.map((event) => (
                <div key={event.id}>
                  <i />
                  <span>
                    <strong>{event.eventType.replaceAll("_", " ")}</strong>
                    <small>{event.note}</small>
                    <em>
                      {event.actorName} · {formatDateTime(event.createdAt)}
                    </em>
                  </span>
                  {event.toStatus ? (
                    <StatusBadge value={event.toStatus} />
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
