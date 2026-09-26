import { BarChart3, Download } from "lucide-react";
import { env } from "cloudflare:workers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { SavedViewButton } from "@/components/governance/saved-view-button";
import { PrintButton } from "@/components/governance/print-button";
import { hasPermission } from "@/lib/domain/governance";
import { formatDuration } from "@/lib/presentation";
import { requireDemoSession } from "@/lib/server/auth";
import { getReportingData } from "@/lib/server/repositories/reports";

const money = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
});

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireDemoSession();
  if (!hasPermission(session.permissionCodes, "reports.read"))
    redirect("/overview");
  const query = await searchParams;
  const value = (key: string, fallback: string) => {
    const raw = query[key];
    return (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 10) || fallback;
  };
  const currentDate = new Date(env.MAZMI_TEST_NOW ?? new Date().toISOString());
  const today = currentDate.toISOString().slice(0, 10);
  const startDate = new Date(currentDate);
  startDate.setUTCDate(startDate.getUTCDate() - 90);
  const start = startDate.toISOString().slice(0, 10);
  const filters = { from: value("from", start), to: value("to", today) };
  const data = await getReportingData(session, filters);
  const canExport = hasPermission(session.permissionCodes, "reports.export");
  return (
    <div className="page-stack reporting-page">
      <PageHeader
        description="Coste, disponibilidad y ejecución derivados de operaciones persistidas."
        eyebrow={`${session.siteCode} · Reporting`}
        title="Reporting Center"
        actions={
          <div className="header-actions">
            <SavedViewButton filters={filters} resource="reports" />
            {canExport ? (
              <Link
                className="secondary-button"
                href={`/api/reports/export?from=${filters.from}&to=${filters.to}`}
              >
                <Download size={15} /> CSV
              </Link>
            ) : null}
            <PrintButton />
          </div>
        }
      />
      <form className="filter-bar report-period-filter">
        <BarChart3 size={15} />
        <label>
          <span>Desde</span>
          <input defaultValue={filters.from} name="from" type="date" />
        </label>
        <label>
          <span>Hasta</span>
          <input defaultValue={filters.to} name="to" type="date" />
        </label>
        <button className="secondary-button" type="submit">
          Actualizar
        </button>
      </form>
      <section className="report-kpi-grid">
        <article>
          <span>Coste mantenimiento</span>
          <strong>{money.format(data.summary.totalCostCents / 100)}</strong>
          <small>Labor + MRO + explícitos</small>
        </article>
        <article>
          <span>Disponibilidad productiva</span>
          <strong>
            {data.summary.availability === null
              ? "Datos insuficientes"
              : `${data.summary.availability.toFixed(1).replace(".", ",")}%`}
          </strong>
          <small>
            {formatDuration(data.summary.exposureMinutes)} de exposición
            agregada
          </small>
        </article>
        <article>
          <span>PM Compliance</span>
          <strong>
            {data.summary.pmCompliance === null
              ? "Datos insuficientes"
              : `${data.summary.pmCompliance.toFixed(1).replace(".", ",")}%`}
          </strong>
          <small>
            {data.summary.pmOnTime}/{data.summary.pmScheduled} a tiempo
          </small>
        </article>
        <article>
          <span>Downtime</span>
          <strong>{formatDuration(data.summary.downtimeMinutes)}</strong>
          <small>{data.summary.completed} OTs completadas</small>
        </article>
        <article>
          <span>MTTR</span>
          <strong>{formatDuration(data.summary.mttrMinutes)}</strong>
          <small>Correctivos completados</small>
        </article>
        <article>
          <span>MTBF</span>
          <strong>
            {data.summary.mtbfMinutes === null
              ? "Datos insuficientes"
              : formatDuration(data.summary.mtbfMinutes)}
          </strong>
          <small>{data.summary.failureCount} fallos correctivos</small>
        </article>
        <article>
          <span>Backlog</span>
          <strong>{data.summary.backlog}</strong>
          <small>Órdenes aún abiertas</small>
        </article>
      </section>
      <CostByAssetSection data={data.costsByAsset} />
      <CostByAreaSection data={data.costsByArea} />
      <section className="data-panel report-secondary-grid">
        <div>
          <p className="overline">Desglose económico</p>
          <h2>Composición del coste</h2>
          <dl className="cost-breakdown">
            <div>
              <dt>Mano de obra</dt>
              <dd>{money.format(data.summary.laborCents / 100)}</dd>
            </div>
            <div>
              <dt>MRO consumido</dt>
              <dd>{money.format(data.summary.materialCents / 100)}</dd>
            </div>
            <div>
              <dt>Proveedor / otros</dt>
              <dd>{money.format(data.summary.explicitCents / 100)}</dd>
            </div>
            <div>
              <dt>Compras del periodo</dt>
              <dd>{money.format(data.summary.purchaseCents / 100)}</dd>
            </div>
          </dl>
        </div>
        <div>
          <p className="overline">Carga técnica registrada</p>
          <h2>Productividad trazable</h2>
          <div className="technician-cost-list">
            {data.technicians.map((tech) => (
              <div key={tech.name}>
                <span>
                  <strong>{tech.name}</strong>
                  <small>
                    {tech.sessions} sesiones · {formatDuration(tech.minutes)}
                  </small>
                </span>
                <b>{money.format(tech.costCents / 100)}</b>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function CostByAreaSection({
  data,
}: {
  data: Awaited<ReturnType<typeof getReportingData>>["costsByArea"];
}) {
  return (
    <section className="data-panel">
      <div className="panel-title-row">
        <div>
          <p className="overline">Responsabilidad operativa</p>
          <h2>Coste y downtime por área</h2>
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Área</th>
              <th>Downtime</th>
              <th>Coste consolidado</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.code}>
                <td>
                  <strong>{item.code}</strong>
                  <small>{item.name}</small>
                </td>
                <td>{formatDuration(item.downtimeMinutes)}</td>
                <td>
                  <strong>{money.format(item.totalCents / 100)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CostByAssetSection({
  data,
}: {
  data: Awaited<ReturnType<typeof getReportingData>>["costsByAsset"];
}) {
  return (
    <section className="data-panel">
      <div className="panel-title-row">
        <div>
          <p className="overline">Coste consolidado</p>
          <h2>Activos con mayor impacto</h2>
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Activo</th>
              <th>Mano de obra</th>
              <th>MRO</th>
              <th>Otros</th>
              <th>Downtime</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.code}>
                <td>
                  <strong>{item.code}</strong>
                  <small>{item.name}</small>
                </td>
                <td>{money.format(item.laborCents / 100)}</td>
                <td>{money.format(item.materialCents / 100)}</td>
                <td>{money.format(item.explicitCents / 100)}</td>
                <td>{formatDuration(item.downtimeMinutes)}</td>
                <td>
                  <strong>{money.format(item.totalCents / 100)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
