import { notFound } from "next/navigation";
import Link from "next/link";
import { getD1 } from "@/db";
import { UserAdminForm } from "@/components/governance/user-admin-form";
import { PageHeader } from "@/components/ui/page-header";
import { requireDemoSession } from "@/lib/server/auth";
import {
  locationScopePredicate,
  tenantScope,
} from "@/lib/server/repositories/shared";

export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const session = await requireDemoSession();
  if (!session.permissionCodes.includes("identity.manage")) notFound();
  const db = getD1(),
    scope = tenantScope(session);
  const userRows = (
    await db
      .prepare(
        `SELECT u.id,u.email,u.full_name AS fullName,u.job_title AS jobTitle,m.role_key AS roleKey,m.status,
      site_scope.id AS scopeId,site_scope.full_area_access AS fullAreaAccess,site_scope.full_warehouse_access AS fullWarehouseAccess
      FROM users u JOIN memberships m ON m.user_id=u.id AND m.organization_id=?
      JOIN membership_site_scopes site_scope ON site_scope.membership_id=m.id AND site_scope.site_id=?
      ORDER BY u.full_name LIMIT 200`,
      )
      .bind(session.organizationId, session.siteId)
      .all<{
        id: string;
        email: string;
        fullName: string;
        jobTitle: string;
        roleKey: string;
        status: string;
        scopeId: string;
        fullAreaAccess: number;
        fullWarehouseAccess: number;
      }>()
  ).results;
  const areaPredicate = locationScopePredicate(scope, "id");
  const areas = (
    await db
      .prepare(
        `SELECT id,code,name FROM functional_locations WHERE organization_id=? AND site_id=? AND type='AREA' AND status='ACTIVE' AND ${areaPredicate.sql} ORDER BY code LIMIT 200`,
      )
      .bind(session.organizationId, session.siteId, ...areaPredicate.params)
      .all<{ id: string; code: string; name: string }>()
  ).results;
  const warehouses = (
    await db
      .prepare(
        `SELECT id,code,name FROM warehouses WHERE organization_id=? AND site_id=? AND status='ACTIVE' ${session.fullWarehouseAccess ? "" : `AND id IN (${session.warehouseIds.map(() => "?").join(",") || "NULL"})`} ORDER BY code LIMIT 200`,
      )
      .bind(
        session.organizationId,
        session.siteId,
        ...(session.fullWarehouseAccess ? [] : session.warehouseIds),
      )
      .all<{ id: string; code: string; name: string }>()
  ).results;
  const roles = (
    await db
      .prepare("SELECT key,name FROM roles ORDER BY rank")
      .all<{ key: string; name: string }>()
  ).results;
  const { user } = await searchParams;
  const selected = userRows.find((item) => item.id === user) ?? null;
  if (user && !selected) notFound();
  const selectedAreas = selected
    ? (
        await db
          .prepare(
            "SELECT functional_location_id AS id FROM membership_area_scopes WHERE membership_site_scope_id=?",
          )
          .bind(selected.scopeId)
          .all<{ id: string }>()
      ).results.map((row) => row.id)
    : [];
  const selectedWarehouses = selected
    ? (
        await db
          .prepare(
            "SELECT warehouse_id AS id FROM membership_warehouse_scopes WHERE membership_site_scope_id=?",
          )
          .bind(selected.scopeId)
          .all<{ id: string }>()
      ).results.map((row) => row.id)
    : [];
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`${session.siteCode} · Identidad`}
        title="Usuarios y acceso"
        description="Roles y ámbitos efectivos por planta. Los cambios revocan sesiones cuando corresponde."
        actions={
          <Link className="secondary-button" href="/governance">
            Volver a Gobierno
          </Link>
        }
      />
      <div className="detail-layout">
        <div className="detail-main-column">
          <section className="data-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Acceso a planta</p>
                <h2>
                  {selected ? `Editar ${selected.fullName}` : "Crear usuario"}
                </h2>
              </div>
            </div>
            <UserAdminForm
              key={selected?.id ?? "new"}
              selected={selected}
              selectedAreas={selectedAreas}
              selectedWarehouses={selectedWarehouses}
              roles={roles}
              areas={areas}
              warehouses={warehouses}
              allowFullArea={session.fullAreaAccess}
              allowFullWarehouse={session.fullWarehouseAccess}
            />
          </section>
        </div>
        <aside className="detail-side-column">
          <section className="data-panel">
            <div className="panel-title-row">
              <div>
                <p className="overline">Miembros</p>
                <h2>Usuarios de esta planta</h2>
              </div>
            </div>
            <div className="list-stack">
              {userRows.map((row) => (
                <Link
                  key={row.id}
                  href={`/governance/users?user=${encodeURIComponent(row.id)}`}
                >
                  {row.fullName} · {row.roleKey} · {row.status}
                </Link>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
