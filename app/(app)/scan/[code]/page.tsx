import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ClipboardList,
  History,
  MapPin,
  PackageSearch,
  QrCode,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssetQuickIncident } from "@/components/field/asset-quick-incident";
import { HealthIndicator } from "@/components/ui/health-indicator";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  criticalityLabels,
  formatDateTime,
  statusLabels,
} from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import { getAssetByScanCode } from "@/lib/server/repositories/field";
import { tenantScope } from "@/lib/server/repositories/shared";

export default async function ScannedAssetPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const session = await requireDemoSession();
  const { code } = await params;
  let asset = null;
  try {
    asset = await getAssetByScanCode(
      tenantScope(session),
      decodeURIComponent(code),
    );
  } catch {
    notFound();
  }
  if (!asset) notFound();
  return (
    <div className="page-stack scanned-asset-page">
      <nav className="breadcrumbs">
        <Link href="/scan">
          <ArrowLeft size={14} /> Identificar otro activo
        </Link>
      </nav>
      <header className="scanned-asset-header">
        <span className="scanned-asset-token">
          <Wrench size={21} />
        </span>
        <div>
          <p className="overline">
            <QrCode size={12} /> {asset.scanCode}
          </p>
          <h1>
            {asset.code} · {asset.name}
          </h1>
          <p>
            <MapPin size={13} /> {asset.locationCode} · {asset.locationName}
          </p>
        </div>
        <div>
          <StatusBadge value={asset.status} />
          <span className="criticality-label">
            {criticalityLabels[asset.criticality]}
          </span>
        </div>
      </header>
      <section className="scanned-asset-operational">
        <article>
          <Activity size={17} />
          <span>
            <small>Health</small>
            <HealthIndicator score={asset.healthScore} />
          </span>
        </article>
        <article>
          <ClipboardList size={17} />
          <span>
            <small>Trabajo activo</small>
            <strong>{asset.activeWorkOrders} OT</strong>
          </span>
        </article>
        <article>
          <ShieldCheck size={17} />
          <span>
            <small>Incidencias</small>
            <strong>{asset.openIncidents} abiertas</strong>
          </span>
        </article>
        <article>
          <CalendarClock size={17} />
          <span>
            <small>Próximo PM</small>
            <strong>{formatDateTime(asset.nextPmAt)}</strong>
          </span>
        </article>
      </section>
      <div className="scanned-asset-grid">
        <section className="data-panel">
          <header className="field-panel-heading">
            <History size={18} />
            <div>
              <p className="overline">Contexto reciente</p>
              <h2>Últimas intervenciones</h2>
            </div>
          </header>
          <div className="scanned-work-history">
            {asset.recentWorkOrders.map((item) => (
              <Link
                href={`/my-work/${encodeURIComponent(item.number)}`}
                key={item.number}
              >
                <span>
                  <small>
                    {item.number} · {formatDateTime(item.requestedAt)}
                  </small>
                  <strong>{item.title}</strong>
                </span>
                <span>
                  {statusLabels[item.status] ?? item.status}
                  <ArrowRight size={14} />
                </span>
              </Link>
            ))}
          </div>
          <Link
            className="field-text-link"
            href={`/assets/${encodeURIComponent(asset.code)}`}
          >
            Abrir expediente técnico completo <ArrowRight size={14} />
          </Link>
        </section>
        <section className="data-panel">
          <header className="field-panel-heading">
            <PackageSearch size={18} />
            <div>
              <p className="overline">Disponibilidad inmediata</p>
              <h2>Repuestos críticos</h2>
            </div>
          </header>
          <div className="scanned-spares">
            {asset.criticalSpares.length ? (
              asset.criticalSpares.map((item) => (
                <article key={item.id}>
                  <span>
                    <small>{item.sku}</small>
                    <strong>{item.name}</strong>
                  </span>
                  <em className={item.available <= 0 ? "critical" : ""}>
                    {item.available} disp.
                  </em>
                </article>
              ))
            ) : (
              <p>Sin repuestos críticos asociados.</p>
            )}
          </div>
        </section>
      </div>
      <AssetQuickIncident
        assetCode={asset.code}
        assetId={asset.id}
        locationId={asset.locationId}
      />
    </div>
  );
}
