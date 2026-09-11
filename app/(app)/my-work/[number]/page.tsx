import {
  ArrowLeft,
  CalendarClock,
  Clock3,
  MapPin,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/lib/domain/governance";
import { FieldWorkspace } from "@/components/field/field-workspace";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime, formatDuration, typeLabels } from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import { getFieldWorkOrder } from "@/lib/server/repositories/field";
import { tenantScope } from "@/lib/server/repositories/shared";

export default async function FieldWorkOrderPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const session = await requireDemoSession();
  if (!hasPermission(session.permissionCodes, "workorder.execute"))
    redirect("/overview");
  const { number } = await params;
  const data = await getFieldWorkOrder(
    tenantScope(session),
    session.userId,
    session.roleKey,
    decodeURIComponent(number),
  );
  if (!data) notFound();
  const { order } = data;

  return (
    <div className="page-stack field-order-page">
      <nav className="breadcrumbs" aria-label="Ruta de trabajo">
        <Link href="/my-work">
          <ArrowLeft size={14} /> Mi trabajo
        </Link>
        <span>/</span>
        <strong>{order.number}</strong>
      </nav>
      <header className="field-order-header">
        <div className="field-order-identity">
          <span className="field-order-token">
            {order.type === "PREVENTIVE" ? "PM" : "OT"}
          </span>
          <div>
            <p className="overline">
              {order.number} · {typeLabels[order.type]}
            </p>
            <h1>{order.title}</h1>
            <p>{order.description}</p>
          </div>
        </div>
        <div className="field-order-badges">
          <StatusBadge kind="priority" value={order.priority} />
          <StatusBadge value={order.status} />
        </div>
        <div className="field-order-context">
          <Link href={`/assets/${encodeURIComponent(order.assetCode)}`}>
            <Wrench size={15} />
            <span>
              <small>Activo</small>
              <strong>
                {order.assetCode} · {order.assetName}
              </strong>
            </span>
          </Link>
          <span>
            <MapPin size={15} />
            <span>
              <small>Ubicación</small>
              <strong>{order.locationName}</strong>
            </span>
          </span>
          <span>
            <CalendarClock size={15} />
            <span>
              <small>Ventana</small>
              <strong>
                {formatDateTime(order.plannedStart ?? order.dueAt)}
              </strong>
            </span>
          </span>
          <span>
            <Clock3 size={15} />
            <span>
              <small>Duración</small>
              <strong>{formatDuration(order.estimatedMinutes)}</strong>
            </span>
          </span>
          {order.safetyLevel !== "STANDARD" ? (
            <span className="attention">
              <ShieldCheck size={15} />
              <span>
                <small>Seguridad</small>
                <strong>
                  {order.safetyLevel === "CRITICAL"
                    ? "Crítica"
                    : "Con precauciones"}
                </strong>
              </span>
            </span>
          ) : null}
        </div>
      </header>
      <FieldWorkspace data={data} userId={session.userId} />
    </div>
  );
}
