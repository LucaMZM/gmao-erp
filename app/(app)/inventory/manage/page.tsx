import Link from "next/link";
import { notFound } from "next/navigation";
import { getD1 } from "@/db";
import { MroMasterForms } from "@/components/inventory/mro-master-forms";
import { InitialPhysicalCountForm } from "@/components/inventory/physical-count-form";
import { PageHeader } from "@/components/ui/page-header";
import { requireDemoSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export default async function ManageInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    part?: string;
    vendor?: string;
    warehouse?: string;
    bin?: string;
  }>;
}) {
  const session = await requireDemoSession();
  if (!session.permissionCodes.includes("inventory.manage")) notFound();
  const db = getD1(),
    search = await searchParams;
  const categories = (
    await db
      .prepare(
        "SELECT id,code,name FROM part_categories WHERE organization_id=? ORDER BY code LIMIT 300",
      )
      .bind(session.organizationId)
      .all<{ id: string; code: string; name: string }>()
  ).results;
  const parts = (
    await db
      .prepare(
        "SELECT id,sku,name FROM parts WHERE organization_id=? ORDER BY sku LIMIT 300",
      )
      .bind(session.organizationId)
      .all<{ id: string; sku: string; name: string }>()
  ).results;
  const vendors = (
    await db
      .prepare(
        "SELECT id,code,name FROM vendors WHERE organization_id=? ORDER BY name LIMIT 300",
      )
      .bind(session.organizationId)
      .all<{ id: string; code: string; name: string }>()
  ).results;
  const warehouses = (
    await db
      .prepare(
        `SELECT id,code,name FROM warehouses WHERE organization_id=? AND site_id=? ${session.fullWarehouseAccess ? "" : `AND id IN (${session.warehouseIds.map(() => "?").join(",") || "NULL"})`} ORDER BY code LIMIT 300`,
      )
      .bind(
        session.organizationId,
        session.siteId,
        ...(session.fullWarehouseAccess ? [] : session.warehouseIds),
      )
      .all<{ id: string; code: string; name: string }>()
  ).results;
  const bins = (
    await db
      .prepare(
        `SELECT bin.id,bin.code,bin.description,bin.warehouse_id AS warehouseId FROM warehouse_bins bin JOIN warehouses wh ON wh.id=bin.warehouse_id WHERE wh.organization_id=? AND wh.site_id=? ${session.fullWarehouseAccess ? "" : `AND wh.id IN (${session.warehouseIds.map(() => "?").join(",") || "NULL"})`} ORDER BY wh.code,bin.code LIMIT 300`,
      )
      .bind(
        session.organizationId,
        session.siteId,
        ...(session.fullWarehouseAccess ? [] : session.warehouseIds),
      )
      .all<{
        id: string;
        code: string;
        description: string;
        warehouseId: string;
      }>()
  ).results;
  const countableParts = (
    await db
      .prepare(
        `SELECT part.id,part.sku,part.name FROM parts part
       JOIN part_site_policies policy ON policy.part_id=part.id AND policy.site_id=?
       WHERE part.organization_id=? AND part.status='ACTIVE' ORDER BY part.sku LIMIT 300`,
      )
      .bind(session.siteId, session.organizationId)
      .all<{ id: string; sku: string; name: string }>()
  ).results;
  const selectedPart = search.part
    ? await db
        .prepare("SELECT * FROM parts WHERE id=? AND organization_id=?")
        .bind(search.part, session.organizationId)
        .first<Record<string, string | number | null>>()
    : null;
  const selectedVendor = search.vendor
    ? await db
        .prepare("SELECT * FROM vendors WHERE id=? AND organization_id=?")
        .bind(search.vendor, session.organizationId)
        .first<Record<string, string | number | null>>()
    : null;
  const selectedWarehouse =
    search.warehouse && warehouses.some((row) => row.id === search.warehouse)
      ? await db
          .prepare(
            "SELECT * FROM warehouses WHERE id=? AND organization_id=? AND site_id=?",
          )
          .bind(search.warehouse, session.organizationId, session.siteId)
          .first<Record<string, string | number | null>>()
      : null;
  const selectedBin =
    search.bin && bins.some((row) => row.id === search.bin)
      ? await db
          .prepare("SELECT * FROM warehouse_bins WHERE id=?")
          .bind(search.bin)
          .first<Record<string, string | number | null>>()
      : null;
  if (
    (search.part && !selectedPart) ||
    (search.vendor && !selectedVendor) ||
    (search.warehouse && !selectedWarehouse) ||
    (search.bin && !selectedBin)
  )
    notFound();
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`${session.siteCode} · Datos maestros MRO`}
        title="Administrar recambios"
        description="Catálogo, proveedores, almacenes y políticas. El saldo físico solo cambia al registrar un conteo con movimiento."
        actions={
          <>
            <Link className="secondary-button" href="/imports">
              Import Center
            </Link>
            <Link className="secondary-button" href="/inventory">
              Volver a inventario
            </Link>
          </>
        }
      />
      <MroMasterForms
        key={`${search.part ?? ""}:${search.vendor ?? ""}:${search.warehouse ?? ""}:${search.bin ?? ""}`}
        categories={categories}
        parts={parts}
        vendors={vendors}
        warehouses={warehouses}
        bins={bins}
        selectedPart={selectedPart}
        selectedVendor={selectedVendor}
        selectedWarehouse={selectedWarehouse}
        selectedBin={selectedBin}
        fullWarehouseAccess={session.fullWarehouseAccess}
      />
      <InitialPhysicalCountForm parts={countableParts} bins={bins} />
    </div>
  );
}
