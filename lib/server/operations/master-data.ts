import { getD1 } from "@/db";
import type { DemoUserSession } from "@/lib/server/auth";
import { ensureDatabase } from "@/lib/server/database";
import { ApiContractError } from "@/lib/server/http";
import { atomicBatch, assertLocationScope } from "./shared";

export type LocationInput = {
  code: string;
  name: string;
  type:
    | "AREA"
    | "PRODUCTION_LINE"
    | "SYSTEM"
    | "ZONE"
    | "WAREHOUSE"
    | "WORKSHOP"
    | "LAB"
    | "UTILITY";
  parentId?: string | null;
  description?: string | null;
  status?: "ACTIVE" | "INACTIVE";
};

export type AssetInput = {
  code: string;
  name: string;
  description: string;
  kind: "EQUIPMENT" | "ASSEMBLY" | "COMPONENT";
  functionalLocationId: string;
  parentAssetId?: string | null;
  assetClassId: string;
  vendorId?: string | null;
  status:
    "OPERATING" | "DEGRADED" | "DOWN" | "MAINTENANCE" | "STANDBY" | "RETIRED";
  criticality: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  commissionedAt?: string | null;
  warrantyUntil?: string | null;
  technicalSummary?: string | null;
};

function manage(session: DemoUserSession) {
  if (!session.permissionCodes.includes("asset.manage"))
    throw new ApiContractError(
      403,
      "ASSET_MANAGE_DENIED",
      "Tu perfil no puede modificar datos maestros de activos.",
    );
}

async function location(session: DemoUserSession, id: string) {
  const row = await getD1()
    .prepare(
      "SELECT id,parent_id AS parentId,status FROM functional_locations WHERE id=? AND organization_id=? AND site_id=?",
    )
    .bind(id, session.organizationId, session.siteId)
    .first<{ id: string; parentId: string | null; status: string }>();
  if (!row)
    throw new ApiContractError(
      404,
      "LOCATION_NOT_FOUND",
      "Ubicación no encontrada en la planta actual.",
    );
  await assertLocationScope(session, id);
  return row;
}

async function asset(session: DemoUserSession, id: string) {
  const row = await getD1()
    .prepare(
      "SELECT id,code,kind,status,functional_location_id AS locationId,updated_at AS updatedAt FROM assets WHERE id=? AND organization_id=? AND site_id=?",
    )
    .bind(id, session.organizationId, session.siteId)
    .first<{
      id: string;
      code: string;
      kind: string;
      status: string;
      locationId: string;
      updatedAt: string;
    }>();
  if (!row)
    throw new ApiContractError(
      404,
      "ASSET_NOT_FOUND",
      "Activo no encontrado en la planta actual.",
    );
  await assertLocationScope(session, row.locationId);
  return row;
}

async function assertAssetReferences(
  session: DemoUserSession,
  input: AssetInput,
) {
  const target = await location(session, input.functionalLocationId);
  if (target.status !== "ACTIVE")
    throw new ApiContractError(
      409,
      "LOCATION_INACTIVE",
      "La ubicación no está activa.",
    );
  if (input.parentAssetId) {
    const parent = await asset(session, input.parentAssetId);
    if (parent.status === "RETIRED")
      throw new ApiContractError(
        409,
        "PARENT_RETIRED",
        "El activo padre está retirado.",
      );
  }
  const db = getD1();
  if (
    !(await db
      .prepare("SELECT id FROM asset_classes WHERE id=? AND organization_id=?")
      .bind(input.assetClassId, session.organizationId)
      .first())
  )
    throw new ApiContractError(
      404,
      "ASSET_CLASS_NOT_FOUND",
      "Clase de activo no encontrada.",
    );
  if (
    input.vendorId &&
    !(await db
      .prepare("SELECT id FROM vendors WHERE id=? AND organization_id=?")
      .bind(input.vendorId, session.organizationId)
      .first())
  )
    throw new ApiContractError(
      404,
      "VENDOR_NOT_FOUND",
      "Proveedor no encontrado.",
    );
}

export async function createAssetClass(
  session: DemoUserSession,
  requestId: string,
  input: { code: string; name: string; family: string },
) {
  manage(session);
  await ensureDatabase();
  const db = getD1(),
    id = `class-${crypto.randomUUID()}`,
    now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO asset_classes (id,organization_id,code,name,family) VALUES (?,?,?,?,?)",
      )
      .bind(id, session.organizationId, input.code, input.name, input.family),
    await audit(
      session,
      requestId,
      "ASSET_CLASS_CREATED",
      "ASSET_CLASS",
      id,
      null,
      input,
      now,
    ),
  ]);
  return { id, code: input.code };
}

async function assertParentChain(
  table: "functional_locations" | "assets",
  id: string,
  parentId: string | null | undefined,
) {
  if (!parentId) return;
  if (id === parentId)
    throw new ApiContractError(
      409,
      "HIERARCHY_CYCLE",
      "Un elemento no puede ser su propio padre.",
    );
  const column = table === "assets" ? "parent_asset_id" : "parent_id";
  const cycle = await getD1()
    .prepare(
      `WITH RECURSIVE ancestors(id,parent_id) AS (
    SELECT id,${column} FROM ${table} WHERE id=?
    UNION SELECT parent.id,parent.${column} FROM ${table} parent JOIN ancestors child ON parent.id=child.parent_id
  ) SELECT id FROM ancestors WHERE id=? LIMIT 1`,
    )
    .bind(parentId, id)
    .first();
  if (cycle)
    throw new ApiContractError(
      409,
      "HIERARCHY_CYCLE",
      "El cambio formaría un ciclo en la jerarquía.",
    );
}

async function audit(
  session: DemoUserSession,
  requestId: string,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  now: string,
) {
  return getD1()
    .prepare(
      "INSERT INTO audit_entries (id,organization_id,site_id,actor_id,action,entity_type,entity_id,previous_value,new_value,request_id,outcome,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'SUCCESS',?)",
    )
    .bind(
      `audit-${crypto.randomUUID()}`,
      session.organizationId,
      session.siteId,
      session.userId,
      action,
      entityType,
      entityId,
      before === null ? null : JSON.stringify(before),
      JSON.stringify(after),
      requestId,
      now,
    );
}

export async function createLocation(
  session: DemoUserSession,
  requestId: string,
  input: LocationInput,
) {
  manage(session);
  await ensureDatabase();
  if (input.parentId) {
    const parent = await location(session, input.parentId);
    if (parent.status !== "ACTIVE")
      throw new ApiContractError(
        409,
        "PARENT_INACTIVE",
        "La ubicación padre no está activa.",
      );
  } else if (!session.fullAreaAccess) {
    throw new ApiContractError(
      403,
      "AREA_SCOPE_DENIED",
      "No puedes crear una ubicación raíz fuera de tu área.",
    );
  }
  const db = getD1(),
    id = `loc-${crypto.randomUUID()}`,
    now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO functional_locations (id,organization_id,site_id,parent_id,code,name,type,description,sort_order,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?,?)",
        )
        .bind(
          id,
          session.organizationId,
          session.siteId,
          input.parentId ?? null,
          input.code,
          input.name,
          input.type,
          input.description ?? null,
          input.status ?? "ACTIVE",
          now,
          now,
        ),
      await audit(
        session,
        requestId,
        "LOCATION_CREATED",
        "FUNCTIONAL_LOCATION",
        id,
        null,
        input,
        now,
      ),
    ]);
  } catch (error) {
    if (String(error).includes("uq_locations_site_code"))
      throw new ApiContractError(
        409,
        "LOCATION_CODE_EXISTS",
        "El código de ubicación ya existe en la planta.",
      );
    throw error;
  }
  return { id, code: input.code };
}

export async function updateLocation(
  session: DemoUserSession,
  requestId: string,
  id: string,
  input: LocationInput,
) {
  manage(session);
  await ensureDatabase();
  const before = await location(session, id);
  if (input.parentId) {
    const parent = await location(session, input.parentId);
    if (parent.status !== "ACTIVE")
      throw new ApiContractError(
        409,
        "PARENT_INACTIVE",
        "La ubicación padre no está activa.",
      );
  } else if (!session.fullAreaAccess)
    throw new ApiContractError(
      403,
      "AREA_SCOPE_DENIED",
      "No puedes mover una ubicación a la raíz.",
    );
  await assertParentChain("functional_locations", id, input.parentId);
  const db = getD1(),
    now = new Date().toISOString();
  if (input.status === "INACTIVE") {
    const related = await db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM functional_locations WHERE parent_id=? AND status='ACTIVE') + (SELECT COUNT(*) FROM assets WHERE functional_location_id=? AND status!='RETIRED') AS count",
      )
      .bind(id, id)
      .first<{ count: number }>();
    if (Number(related?.count ?? 0) > 0)
      throw new ApiContractError(
        409,
        "LOCATION_IN_USE",
        "Retira primero ubicaciones hijas y activos vinculados.",
      );
  }
  await atomicBatch(db, [
    db
      .prepare(
        "UPDATE functional_locations SET parent_id=?,code=?,name=?,type=?,description=?,status=?,updated_at=? WHERE id=? AND organization_id=? AND site_id=?",
      )
      .bind(
        input.parentId ?? null,
        input.code,
        input.name,
        input.type,
        input.description ?? null,
        input.status ?? "ACTIVE",
        now,
        id,
        session.organizationId,
        session.siteId,
      ),
    await audit(
      session,
      requestId,
      "LOCATION_UPDATED",
      "FUNCTIONAL_LOCATION",
      id,
      before,
      input,
      now,
    ),
  ]);
  return { id, code: input.code };
}

export async function createAsset(
  session: DemoUserSession,
  requestId: string,
  input: AssetInput,
) {
  manage(session);
  await ensureDatabase();
  await assertAssetReferences(session, input);
  const db = getD1();
  const id = `asset-${crypto.randomUUID()}`,
    now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO assets (id,organization_id,site_id,functional_location_id,parent_asset_id,asset_class_id,vendor_id,scan_code,code,name,description,kind,status,criticality,health_score,manufacturer,model,serial_number,commissioned_at,warranty_until,next_pm_at,technical_summary,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?,?, ?,100,?,?,?,?,?,NULL,?,?,?)`,
      )
      .bind(
        id,
        session.organizationId,
        session.siteId,
        input.functionalLocationId,
        input.parentAssetId ?? null,
        input.assetClassId,
        input.vendorId ?? null,
        input.code,
        input.name,
        input.description,
        input.kind,
        input.status,
        input.criticality,
        input.manufacturer ?? null,
        input.model ?? null,
        input.serialNumber ?? null,
        input.commissionedAt ?? null,
        input.warrantyUntil ?? null,
        input.technicalSummary ?? null,
        now,
        now,
      ),
    await audit(
      session,
      requestId,
      "ASSET_CREATED",
      "ASSET",
      id,
      null,
      input,
      now,
    ),
  ]);
  return { id, code: input.code };
}

export async function updateAsset(
  session: DemoUserSession,
  requestId: string,
  id: string,
  input: AssetInput,
) {
  manage(session);
  await ensureDatabase();
  const before = await asset(session, id);
  await assertAssetReferences(session, input);
  await assertParentChain("assets", id, input.parentAssetId);
  const db = getD1(),
    now = new Date().toISOString();
  if (input.status === "RETIRED") {
    const related = await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM assets WHERE parent_asset_id=? AND status!='RETIRED') + (SELECT COUNT(*) FROM work_orders WHERE asset_id=? AND status NOT IN ('CLOSED','CANCELLED','COMPLETED')) AS count`,
      )
      .bind(id, id)
      .first<{ count: number }>();
    if (Number(related?.count ?? 0) > 0)
      throw new ApiContractError(
        409,
        "ASSET_IN_USE",
        "Resuelve antes los activos hijos y trabajos abiertos.",
      );
  }
  await atomicBatch(db, [
    db
      .prepare(
        `UPDATE assets SET functional_location_id=?,parent_asset_id=?,asset_class_id=?,vendor_id=?,code=?,name=?,description=?,kind=?,status=?,criticality=?,manufacturer=?,model=?,serial_number=?,commissioned_at=?,warranty_until=?,technical_summary=?,updated_at=?
      WHERE id=? AND organization_id=? AND site_id=? AND updated_at=?`,
      )
      .bind(
        input.functionalLocationId,
        input.parentAssetId ?? null,
        input.assetClassId,
        input.vendorId ?? null,
        input.code,
        input.name,
        input.description,
        input.kind,
        input.status,
        input.criticality,
        input.manufacturer ?? null,
        input.model ?? null,
        input.serialNumber ?? null,
        input.commissionedAt ?? null,
        input.warrantyUntil ?? null,
        input.technicalSummary ?? null,
        now,
        id,
        session.organizationId,
        session.siteId,
        before.updatedAt,
      ),
    await audit(
      session,
      requestId,
      "ASSET_UPDATED",
      "ASSET",
      id,
      before,
      input,
      now,
    ),
  ]);
  return { id, code: input.code };
}
