import { notFound } from "next/navigation";
import Link from "next/link";
import { getD1 } from "@/db";
import { LaborRateForm } from "@/components/governance/labor-rate-form";
import { PageHeader } from "@/components/ui/page-header";
import { requireDemoSession } from "@/lib/server/auth";
import { formatDateTime } from "@/lib/presentation";

export const dynamic = "force-dynamic";

export default async function LaborRatesPage() {
  const session = await requireDemoSession();
  if (!session.permissionCodes.includes("identity.manage")) notFound();
  const db = getD1();
  const users = (
    await db
      .prepare(
        `SELECT DISTINCT user.id,user.full_name AS name FROM users user
     INNER JOIN memberships membership ON membership.user_id=user.id
     WHERE membership.organization_id=? AND membership.status='ACTIVE' AND user.status='ACTIVE'
     ORDER BY user.full_name LIMIT 200`,
      )
      .bind(session.organizationId)
      .all<{ id: string; name: string }>()
  ).results;
  const rates = (
    await db
      .prepare(
        `SELECT rate.id,user.full_name AS name,rate.hourly_rate_cents AS cents,
       rate.effective_from AS effectiveFrom,rate.currency
     FROM labor_rate_cards rate JOIN users user ON user.id=rate.user_id
     WHERE rate.organization_id=? AND rate.user_id IS NOT NULL
     ORDER BY rate.effective_from DESC,user.full_name LIMIT 100`,
      )
      .bind(session.organizationId)
      .all<{
        id: string;
        name: string;
        cents: number;
        effectiveFrom: string;
        currency: string;
      }>()
  ).results;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`${session.siteCode} · Gobierno`}
        title="Tarifas de mano de obra"
        description="Vigencias append-only. El coste de sesiones ya registradas permanece congelado."
        actions={
          <Link className="secondary-button" href="/governance">
            Volver
          </Link>
        }
      />
      <div className="detail-layout">
        <section className="data-panel detail-main-column">
          <h2>Nueva vigencia</h2>
          <LaborRateForm users={users} />
        </section>
        <aside className="data-panel detail-side-column">
          <h2>Últimas tarifas</h2>
          <div className="list-stack">
            {rates.map((rate) => (
              <div className="governance-row" key={rate.id}>
                <span>
                  <strong>{rate.name}</strong>
                  <small>Desde {formatDateTime(rate.effectiveFrom)}</small>
                </span>
                <b>
                  {new Intl.NumberFormat("es-ES", {
                    style: "currency",
                    currency: rate.currency,
                  }).format(rate.cents / 100)}
                  /h
                </b>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
