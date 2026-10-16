import Link from "next/link";
import { notFound } from "next/navigation";
import { getD1 } from "@/db";
import { MasterDataForms } from "@/components/assets/master-data-forms";
import { PageHeader } from "@/components/ui/page-header";
import { requireDemoSession } from "@/lib/server/auth";
import {
  locationScopePredicate,
  tenantScope,
} from "@/lib/server/repositories/shared";

export const dynamic = "force-dynamic";

export default async function ManageAssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ asset?: string; location?: string }>;
}) {
  const session = await requireDemoSession();
  if (!session.permissionCodes.includes("asset.manage")) notFound();
  const search = await searchParams;
  const db = getD1();
  const areaScope = locationScopePredicate(tenantScope(session), "id");
  const locations = (
    await db
      .prepare(
        `SELECT id,code,name,type,parent_id AS parentId,status,description FROM functional_locations WHERE organization_id=? AND site_id=? AND ${areaScope.sql} ORDER BY code LIMIT 300`,
      )
      .bind(session.organizationId, session.siteId, ...areaScope.params)
      .all<{
        id: string;
        code: string;
        name: string;
        type: string;
        parentId: string | null;
        status: string;
        description: string | null;
      }>()
  ).results;
  const classes = (
    await db
      .prepare(
        "SELECT id,code,name,family FROM asset_classes WHERE organization_id=? ORDER BY code LIMIT 300",
      )
      .bind(session.organizationId)
      .all<{ id: string; code: string; name: string; family: string }>()
  ).results;
  const vendors = (
    await db
      .prepare(
        "SELECT id,code,name FROM vendors WHERE organization_id=? AND status='ACTIVE' ORDER BY name LIMIT 300",
      )
      .bind(session.organizationId)
      .all<{ id: string; code: string; name: string }>()
  ).results;
  const assets = (
    await db
      .prepare(
        `SELECT id,code,name,functional_location_id AS functionalLocationId FROM assets WHERE organization_id=? AND site_id=? AND status!='RETIRED' AND ${locationScopePredicate(tenantScope(session), "functional_location_id").sql} ORDER BY code LIMIT 300`,
      )
      .bind(
        session.organizationId,
        session.siteId,
        ...locationScopePredicate(
          tenantScope(session),
          "functional_location_id",
        ).params,
      )
      .all<{
        id: string;
        code: string;
        name: string;
        functionalLocationId: string;
      }>()
  ).results;
  const selectedAsset = search.asset
    ? await db
        .prepare(
          "SELECT * FROM assets WHERE id=? AND organization_id=? AND site_id=?",
        )
        .bind(search.asset, session.organizationId, session.siteId)
        .first<Record<string, string | null>>()
    : null;
  const selectedLocation = search.location
    ? locations.find((row) => row.id === search.location)
    : null;
  if (
    search.asset &&
    (!selectedAsset ||
      !locations.some(
        (item) => item.id === selectedAsset.functional_location_id,
      ))
  )
    notFound();
  if (search.location && !selectedLocation) notFound();
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`${session.siteCode} · Datos maestros`}
        title="Administrar activos"
        description="Ubicaciones, clases y equipos con jerarquía y trazabilidad. Las retiradas conservan el historial."
        actions={
          <>
            <Link className="secondary-button" href="/imports">
              Import Center
            </Link>
            <Link className="secondary-button" href="/assets">
              Volver a activos
            </Link>
          </>
        }
      />
      <MasterDataForms
        key={`${selectedAsset?.id ?? "new"}:${selectedLocation?.id ?? "new"}`}
        locations={locations}
        classes={classes}
        vendors={vendors}
        assets={assets}
        selectedAsset={selectedAsset}
        selectedLocation={selectedLocation ?? null}
      />
    </div>
  );
}
