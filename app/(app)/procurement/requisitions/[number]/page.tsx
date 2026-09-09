import {
  ArrowLeft,
  Boxes,
  CalendarClock,
  ClipboardCheck,
  History,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RequisitionActions } from "@/components/procurement/procurement-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { can } from "@/lib/domain/permissions";
import { hasPermission } from "@/lib/domain/governance";
import { formatCurrency, formatDateTime } from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import {
  getProcurementCenter,
  getRequisitionDetail,
} from "@/lib/server/repositories/procurement";
import { tenantScope } from "@/lib/server/repositories/shared";

export default async function RequisitionDetailPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const session = await requireDemoSession();
  if (
    !hasPermission(session.permissionCodes, "procurement.approve") &&
    !hasPermission(session.permissionCodes, "procurement.receive")
  )
    redirect("/overview");
  const { number } = await params;
  const scope = tenantScope(session);
  const [data, center] = await Promise.all([
    getRequisitionDetail(scope, decodeURIComponent(number)),
    getProcurementCenter(scope),
  ]);
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
          <span className="large-asset-token order-token">PR</span>
          <div>
            <p className="overline">
              {data.number} · {data.origin.replaceAll("_", " ")}
            </p>
            <h1>{data.itemSummary}</h1>
            <p>{data.justification}</p>
          </div>
        </div>
        <div className="detail-status-cluster">
          <StatusBadge
            kind="priority"
            value={
              data.urgency === "CRITICAL"
                ? "P1_EMERGENCY"
                : data.urgency === "HIGH"
                  ? "P3_HIGH"
                  : "P4_NORMAL"
            }
          />
          <StatusBadge value={data.status} />
          {data.purchaseOrderNumber ? (
            <Link
              className="primary-button"
              href={`/procurement/purchase-orders/${encodeURIComponent(data.purchaseOrderNumber)}`}
            >
              Abrir {data.purchaseOrderNumber}
            </Link>
          ) : null}
        </div>
      </header>
      <RequisitionActions
        bins={center.bins}
        canApprove={can(session, "PURCHASE_REQUISITION_APPROVE")}
        canManageOrder={can(session, "PURCHASE_ORDER_MANAGE")}
        requisition={data}
      />
      <div className="detail-layout">
        <div className="detail-main-column">
          <section className="data-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Necesidad solicitada</p>
                <h2>Material y cobertura</h2>
              </div>
              <Boxes size={17} />
            </div>
            <div className="procurement-line-list">
              {data.lines.map((line) => (
                <div key={line.id}>
                  <span>
                    <small>{line.sku}</small>
                    <strong>{line.name}</strong>
                  </span>
                  <span>
                    <small>Solicitado</small>
                    <strong>
                      {line.quantity} {line.unit}
                    </strong>
                  </span>
                  <span>
                    <small>Al crear</small>
                    <strong>
                      {line.availableSnapshot} disp. / {line.onOrderSnapshot}{" "}
                      pedido
                    </strong>
                  </span>
                  <span>
                    <small>Ahora</small>
                    <strong>
                      {line.currentAvailable} disp. / {line.currentOnOrder}{" "}
                      pedido
                    </strong>
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="data-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Sourcing</p>
                <h2>Ofertas aprobadas</h2>
                <p>
                  La oferta elegida se copia al pedido como precio histórico.
                </p>
              </div>
              <ClipboardCheck size={17} />
            </div>
            <div className="offer-list">
              {data.offers.map((offer) => (
                <div
                  className={offer.preferred ? "preferred" : ""}
                  key={offer.id}
                >
                  <span>
                    <small>
                      {offer.vendorCode}
                      {offer.preferred ? " · Preferido" : ""}
                    </small>
                    <strong>{offer.vendorName}</strong>
                    <em>{offer.vendorSku}</em>
                  </span>
                  <span>
                    <small>Precio</small>
                    <strong>{formatCurrency(offer.unitPrice)}</strong>
                    <em>desde {formatDateTime(offer.priceAt)}</em>
                  </span>
                  <span>
                    <small>MOQ / lead time</small>
                    <strong>
                      {offer.minimumOrderQuantity} ud · {offer.leadTimeDays}{" "}
                      días
                    </strong>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside className="detail-rail">
          <section className="data-panel detail-facts">
            <div className="panel-title-row">
              <div>
                <p className="overline">Contexto</p>
                <h2>Decisión de compra</h2>
              </div>
              <CalendarClock size={16} />
            </div>
            <dl>
              <div>
                <dt>
                  <UserRound size={14} /> Solicitante
                </dt>
                <dd>
                  {data.requesterName}
                  <small>{formatDateTime(data.createdAt)}</small>
                </dd>
              </div>
              <div>
                <dt>Almacén</dt>
                <dd>{data.warehouseName}</dd>
              </div>
              <div>
                <dt>Necesaria</dt>
                <dd>{formatDateTime(data.needBy)}</dd>
              </div>
              {data.workOrderNumber ? (
                <div>
                  <dt>Orden relacionada</dt>
                  <dd>
                    <Link
                      href={`/work-orders/${encodeURIComponent(data.workOrderNumber)}`}
                    >
                      {data.workOrderNumber}
                    </Link>
                  </dd>
                </div>
              ) : null}
              {data.approverName ? (
                <div>
                  <dt>Decisión</dt>
                  <dd>
                    {data.approverName}
                    <small>{formatDateTime(data.approvedAt)}</small>
                  </dd>
                </div>
              ) : null}
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
