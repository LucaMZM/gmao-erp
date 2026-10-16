import { getD1 } from "@/db";
import type { DemoUserSession } from "@/lib/server/auth";
import { ensureDatabase } from "@/lib/server/database";
import { ApiContractError } from "@/lib/server/http";
import { assertWarehouseScope, atomicBatch } from "./shared";

export type MroMasterInput =
  | { type: "CATEGORY"; code: string; name: string; parentId?: string | null }
  | {
      type: "PART";
      id?: string;
      sku: string;
      name: string;
      description: string;
      categoryId: string;
      unit: string;
      manufacturer?: string | null;
      manufacturerRef?: string | null;
      standardCost: number;
      currency: "EUR" | "USD" | "GBP";
      status: "ACTIVE" | "INACTIVE";
    }
  | {
      type: "WAREHOUSE";
      id?: string;
      code: string;
      name: string;
      status: "ACTIVE" | "INACTIVE";
    }
  | {
      type: "BIN";
      id?: string;
      warehouseId: string;
      zoneId?: string | null;
      code: string;
      description: string;
      status: "ACTIVE" | "INACTIVE";
    }
  | {
      type: "VENDOR";
      id?: string;
      code: string;
      name: string;
      category: string;
      contactName?: string | null;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      paymentTerms: string;
      currency: "EUR" | "USD" | "GBP";
      leadTimeDays: number;
      status: "ACTIVE" | "INACTIVE";
    }
  | {
      type: "POLICY";
      partId: string;
      primaryVendorId?: string | null;
      critical: boolean;
      minStock: number;
      maxStock: number;
      reorderPoint: number;
      leadTimeDays: number;
    }
  | {
      type: "OFFER";
      partId: string;
      vendorId: string;
      vendorSku: string;
      manufacturer?: string | null;
      unitPrice: number;
      currency: "EUR" | "USD" | "GBP";
      minimumOrderQuantity: number;
      leadTimeDays: number;
      preferred: boolean;
      validUntil?: string | null;
    }
  | {
      type: "SUBSTITUTE";
      partId: string;
      substitutePartId: string;
      note?: string | null;
      approvalStatus: "APPROVED" | "PENDING" | "REJECTED";
    };

function authorize(session: DemoUserSession) {
  if (!session.permissionCodes.includes("inventory.manage"))
    throw new ApiContractError(
      403,
      "MRO_MASTER_DENIED",
      "Tu perfil no puede administrar el catálogo MRO.",
    );
}
async function part(session: DemoUserSession, id: string) {
  const row = await getD1()
    .prepare("SELECT id FROM parts WHERE id=? AND organization_id=?")
    .bind(id, session.organizationId)
    .first();
  if (!row)
    throw new ApiContractError(
      404,
      "PART_NOT_FOUND",
      "Recambio no encontrado.",
    );
}
async function vendor(session: DemoUserSession, id: string) {
  const row = await getD1()
    .prepare("SELECT id FROM vendors WHERE id=? AND organization_id=?")
    .bind(id, session.organizationId)
    .first();
  if (!row)
    throw new ApiContractError(
      404,
      "VENDOR_NOT_FOUND",
      "Proveedor no encontrado.",
    );
}
async function warehouse(session: DemoUserSession, id: string) {
  const row = await getD1()
    .prepare(
      "SELECT id,status FROM warehouses WHERE id=? AND organization_id=? AND site_id=?",
    )
    .bind(id, session.organizationId, session.siteId)
    .first<{ id: string; status: string }>();
  if (!row)
    throw new ApiContractError(
      404,
      "WAREHOUSE_NOT_FOUND",
      "Almacén no encontrado en la planta.",
    );
  assertWarehouseScope(session, id);
  return row;
}
function audit(
  db: D1Database,
  session: DemoUserSession,
  requestId: string,
  type: string,
  id: string,
  input: MroMasterInput,
  now: string,
) {
  return db
    .prepare(
      "INSERT INTO audit_entries (id,organization_id,site_id,actor_id,action,entity_type,entity_id,new_value,request_id,outcome,created_at) VALUES (?,?,?,?,?,?,?, ?,?,'SUCCESS',?)",
    )
    .bind(
      `audit-${crypto.randomUUID()}`,
      session.organizationId,
      session.siteId,
      session.userId,
      `${type}_MASTER_SAVED`,
      type,
      id,
      JSON.stringify(input),
      requestId,
      now,
    );
}

export async function saveMroMaster(
  session: DemoUserSession,
  requestId: string,
  input: MroMasterInput,
) {
  authorize(session);
  await ensureDatabase();
  if (
    !session.fullWarehouseAccess &&
    input.type !== "WAREHOUSE" &&
    input.type !== "BIN"
  )
    throw new ApiContractError(
      403,
      "WAREHOUSE_SCOPE_DENIED",
      "Los datos de catálogo comunes requieren acceso completo a los almacenes de la planta.",
    );
  const db = getD1(),
    now = new Date().toISOString();
  let id: string, statement: D1PreparedStatement;
  switch (input.type) {
    case "CATEGORY": {
      if (
        input.parentId &&
        !(await db
          .prepare(
            "SELECT id FROM part_categories WHERE id=? AND organization_id=?",
          )
          .bind(input.parentId, session.organizationId)
          .first())
      )
        throw new ApiContractError(
          404,
          "CATEGORY_NOT_FOUND",
          "Categoría padre no encontrada.",
        );
      id = `category-${crypto.randomUUID()}`;
      statement = db
        .prepare(
          "INSERT INTO part_categories (id,organization_id,parent_id,code,name) VALUES (?,?,?,?,?)",
        )
        .bind(
          id,
          session.organizationId,
          input.parentId ?? null,
          input.code,
          input.name,
        );
      break;
    }
    case "PART": {
      if (
        !(await db
          .prepare(
            "SELECT id FROM part_categories WHERE id=? AND organization_id=?",
          )
          .bind(input.categoryId, session.organizationId)
          .first())
      )
        throw new ApiContractError(
          404,
          "CATEGORY_NOT_FOUND",
          "Categoría no encontrada.",
        );
      id = input.id ?? `part-${crypto.randomUUID()}`;
      if (input.id) {
        await part(session, id);
        statement = db
          .prepare(
            "UPDATE parts SET sku=?,name=?,description=?,category_id=?,unit=?,manufacturer=?,manufacturer_ref=?,standard_cost=?,currency=?,status=?,updated_at=? WHERE id=? AND organization_id=?",
          )
          .bind(
            input.sku,
            input.name,
            input.description,
            input.categoryId,
            input.unit,
            input.manufacturer ?? null,
            input.manufacturerRef ?? null,
            input.standardCost,
            input.currency,
            input.status,
            now,
            id,
            session.organizationId,
          );
      } else
        statement = db
          .prepare(
            "INSERT INTO parts (id,organization_id,category_id,sku,name,description,unit,manufacturer,manufacturer_ref,standard_cost,currency,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            session.organizationId,
            input.categoryId,
            input.sku,
            input.name,
            input.description,
            input.unit,
            input.manufacturer ?? null,
            input.manufacturerRef ?? null,
            input.standardCost,
            input.currency,
            input.status,
            now,
            now,
          );
      break;
    }
    case "WAREHOUSE": {
      id = input.id ?? `warehouse-${crypto.randomUUID()}`;
      if (input.id) {
        await warehouse(session, id);
        if (input.status === "INACTIVE") {
          const stock = await db
            .prepare(
              "SELECT COUNT(*) AS count FROM stock_levels stock JOIN warehouse_bins bin ON bin.id=stock.bin_id WHERE bin.warehouse_id=? AND (stock.on_hand>0 OR stock.reserved>0 OR stock.on_order>0)",
            )
            .bind(id)
            .first<{ count: number }>();
          if (Number(stock?.count ?? 0) > 0)
            throw new ApiContractError(
              409,
              "WAREHOUSE_HAS_STOCK",
              "Vacía o traslada el stock antes de desactivar el almacén.",
            );
        }
        statement = db
          .prepare(
            "UPDATE warehouses SET code=?,name=?,status=?,updated_at=? WHERE id=? AND organization_id=? AND site_id=?",
          )
          .bind(
            input.code,
            input.name,
            input.status,
            now,
            id,
            session.organizationId,
            session.siteId,
          );
      } else {
        if (!session.fullWarehouseAccess)
          throw new ApiContractError(
            403,
            "WAREHOUSE_SCOPE_DENIED",
            "Solo un administrador de todos los almacenes puede crear uno.",
          );
        statement = db
          .prepare(
            "INSERT INTO warehouses (id,organization_id,site_id,code,name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            session.organizationId,
            session.siteId,
            input.code,
            input.name,
            input.status,
            now,
            now,
          );
      }
      break;
    }
    case "BIN": {
      const owner = await warehouse(session, input.warehouseId);
      if (owner.status !== "ACTIVE")
        throw new ApiContractError(
          409,
          "WAREHOUSE_INACTIVE",
          "El almacén no está activo.",
        );
      if (
        input.zoneId &&
        !(await db
          .prepare(
            "SELECT id FROM warehouse_zones WHERE id=? AND warehouse_id=?",
          )
          .bind(input.zoneId, input.warehouseId)
          .first())
      )
        throw new ApiContractError(
          404,
          "ZONE_NOT_FOUND",
          "Zona no encontrada.",
        );
      id = input.id ?? `bin-${crypto.randomUUID()}`;
      if (input.id) {
        const original = await db
          .prepare(
            "SELECT id FROM warehouse_bins WHERE id=? AND warehouse_id=?",
          )
          .bind(id, input.warehouseId)
          .first();
        if (!original)
          throw new ApiContractError(
            404,
            "BIN_NOT_FOUND",
            "Ubicación física no encontrada.",
          );
        if (input.status === "INACTIVE") {
          const stock = await db
            .prepare(
              "SELECT COUNT(*) AS count FROM stock_levels WHERE bin_id=? AND (on_hand>0 OR reserved>0 OR on_order>0)",
            )
            .bind(id)
            .first<{ count: number }>();
          if (Number(stock?.count ?? 0) > 0)
            throw new ApiContractError(
              409,
              "BIN_HAS_STOCK",
              "Vacía la ubicación antes de desactivarla.",
            );
        }
        statement = db
          .prepare(
            "UPDATE warehouse_bins SET code=?,description=?,zone_id=?,status=? WHERE id=? AND warehouse_id=?",
          )
          .bind(
            input.code,
            input.description,
            input.zoneId ?? null,
            input.status,
            id,
            input.warehouseId,
          );
      } else
        statement = db
          .prepare(
            "INSERT INTO warehouse_bins (id,warehouse_id,zone_id,code,description,status) VALUES (?,?,?,?,?,?)",
          )
          .bind(
            id,
            input.warehouseId,
            input.zoneId ?? null,
            input.code,
            input.description,
            input.status,
          );
      break;
    }
    case "VENDOR": {
      id = input.id ?? `vendor-${crypto.randomUUID()}`;
      if (input.id) {
        await vendor(session, id);
        statement = db
          .prepare(
            "UPDATE vendors SET code=?,name=?,category=?,contact_name=?,email=?,phone=?,address=?,payment_terms=?,currency=?,lead_time_days=?,status=?,updated_at=? WHERE id=? AND organization_id=?",
          )
          .bind(
            input.code,
            input.name,
            input.category,
            input.contactName ?? null,
            input.email ?? null,
            input.phone ?? null,
            input.address ?? null,
            input.paymentTerms,
            input.currency,
            input.leadTimeDays,
            input.status,
            now,
            id,
            session.organizationId,
          );
      } else
        statement = db
          .prepare(
            "INSERT INTO vendors (id,organization_id,code,name,category,contact_name,email,phone,address,payment_terms,currency,lead_time_days,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            session.organizationId,
            input.code,
            input.name,
            input.category,
            input.contactName ?? null,
            input.email ?? null,
            input.phone ?? null,
            input.address ?? null,
            input.paymentTerms,
            input.currency,
            input.leadTimeDays,
            input.status,
            now,
            now,
          );
      break;
    }
    case "POLICY": {
      await part(session, input.partId);
      if (input.primaryVendorId) await vendor(session, input.primaryVendorId);
      if (
        input.maxStock < input.minStock ||
        input.reorderPoint > input.maxStock
      )
        throw new ApiContractError(
          400,
          "POLICY_RANGE_INVALID",
          "Mínimo, máximo y punto de reposición son incoherentes.",
        );
      id = `policy-${input.partId}-${session.siteId}`;
      statement = db
        .prepare(
          `INSERT INTO part_site_policies (id,part_id,site_id,primary_vendor_id,critical,min_stock,max_stock,reorder_point,lead_time_days,average_cost)
        VALUES (?,?,?,?,?,?,?,?,?,(SELECT standard_cost FROM parts WHERE id=?))
        ON CONFLICT(part_id,site_id) DO UPDATE SET primary_vendor_id=excluded.primary_vendor_id,critical=excluded.critical,min_stock=excluded.min_stock,max_stock=excluded.max_stock,reorder_point=excluded.reorder_point,lead_time_days=excluded.lead_time_days`,
        )
        .bind(
          id,
          input.partId,
          session.siteId,
          input.primaryVendorId ?? null,
          Number(input.critical),
          input.minStock,
          input.maxStock,
          input.reorderPoint,
          input.leadTimeDays,
          input.partId,
        );
      break;
    }
    case "OFFER": {
      await part(session, input.partId);
      await vendor(session, input.vendorId);
      id = `offer-${crypto.randomUUID()}`;
      statement = db
        .prepare(
          "INSERT INTO part_vendor_offers (id,organization_id,part_id,vendor_id,vendor_sku,manufacturer,unit_price,currency,minimum_order_quantity,lead_time_days,preferred,price_at,valid_until,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)",
        )
        .bind(
          id,
          session.organizationId,
          input.partId,
          input.vendorId,
          input.vendorSku,
          input.manufacturer ?? null,
          input.unitPrice,
          input.currency,
          input.minimumOrderQuantity,
          input.leadTimeDays,
          Number(input.preferred),
          now,
          input.validUntil ?? null,
          now,
          now,
        );
      break;
    }
    case "SUBSTITUTE": {
      await part(session, input.partId);
      await part(session, input.substitutePartId);
      if (input.partId === input.substitutePartId)
        throw new ApiContractError(
          400,
          "SELF_SUBSTITUTE",
          "Un recambio no puede sustituirse a sí mismo.",
        );
      id = `substitute-${crypto.randomUUID()}`;
      statement = db
        .prepare(
          `INSERT INTO part_substitutes (id,organization_id,part_id,substitute_part_id,approval_status,note,approved_by_id,approved_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(part_id,substitute_part_id) DO UPDATE SET approval_status=excluded.approval_status,note=excluded.note,approved_by_id=excluded.approved_by_id,approved_at=excluded.approved_at,updated_at=excluded.updated_at`,
        )
        .bind(
          id,
          session.organizationId,
          input.partId,
          input.substitutePartId,
          input.approvalStatus,
          input.note ?? null,
          input.approvalStatus === "APPROVED" ? session.userId : null,
          input.approvalStatus === "APPROVED" ? now : null,
          now,
          now,
        );
      break;
    }
  }
  await atomicBatch(db, [
    statement,
    audit(db, session, requestId, input.type, id, input, now),
  ]);
  return { id, type: input.type };
}
