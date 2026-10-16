import { getD1 } from "@/db";
import {
  mapCsvRows,
  parseCsv,
  type ColumnMapping,
  type ImportKind,
} from "@/lib/domain/csv-import";
import type { DemoUserSession } from "@/lib/server/auth";
import { ensureDatabase } from "@/lib/server/database";
import { ApiContractError } from "@/lib/server/http";
import { assertLocationScope } from "./shared";
import {
  createAsset,
  updateAsset,
  createLocation,
  updateLocation,
  type AssetInput,
  type LocationInput,
} from "./master-data";
import { saveMroMaster } from "./mro-master";

export type ImportRequest = {
  kind: ImportKind;
  csv: string;
  mapping: ColumnMapping;
  sourceName: string;
};
export type ImportIssue = { row: number; code: string; message: string };
export type ImportPreview = {
  hash: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  rows: Array<{ row: number; identity: string; action: "CREATE" | "UPDATE" }>;
};
type Existing = {
  id: string;
  code: string;
  locationId?: string;
  parentId?: string | null;
};

async function sourceHash(input: ImportRequest) {
  const data = new TextEncoder().encode(
    JSON.stringify([input.kind, input.csv, input.mapping]),
  );
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function required(kind: ImportKind) {
  return kind === "LOCATIONS"
    ? ["code", "name", "type"]
    : kind === "ASSETS"
      ? ["code", "name", "locationCode", "classCode", "criticality"]
      : kind === "PARTS"
        ? ["sku", "name", "categoryCode", "unit"]
        : ["code", "name", "category"];
}
function identity(kind: ImportKind, row: Record<string, string>) {
  return (kind === "PARTS" ? row.sku : row.code)?.trim().toUpperCase() ?? "";
}
async function lookup(
  session: DemoUserSession,
  table:
    | "functional_locations"
    | "assets"
    | "part_categories"
    | "asset_classes"
    | "parts"
    | "vendors",
  column: "code" | "sku",
  codes: string[],
  siteScoped: boolean,
) {
  const found = new Map<string, Existing>();
  for (let index = 0; index < codes.length; index += 300) {
    const chunk = codes.slice(index, index + 300);
    if (!chunk.length) continue;
    const rows = await getD1()
      .prepare(
        `SELECT id,${column} AS code${table === "assets" ? ",functional_location_id AS locationId" : table === "functional_locations" ? ",parent_id AS parentId" : ""} FROM ${table} WHERE organization_id=? ${siteScoped ? "AND site_id=?" : ""} AND ${column} IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(
        session.organizationId,
        ...(siteScoped ? [session.siteId] : []),
        ...chunk,
      )
      .all<Existing>();
    for (const row of rows.results) found.set(row.code.toUpperCase(), row);
  }
  return found;
}
function orderRows(kind: ImportKind, rows: Record<string, string>[]): number[] {
  if (kind !== "LOCATIONS" && kind !== "ASSETS")
    return rows.map((_, index) => index);
  const byCode = new Map<string, number>();
  rows.forEach((row, index) => {
    const code = identity(kind, row);
    if (!byCode.has(code)) byCode.set(code, index);
  });
  const result: number[] = [],
    state = new Map<number, number>();
  const visit = (index: number) => {
    const status = state.get(index);
    if (status === 1) throw new Error("IMPORT_HIERARCHY_CYCLE");
    if (status === 2) return;
    state.set(index, 1);
    const parent = (rows[index].parentCode ?? "").trim().toUpperCase();
    const parentIndex = byCode.get(parent);
    if (parentIndex !== undefined) visit(parentIndex);
    state.set(index, 2);
    result.push(index);
  };
  for (let index = 0; index < rows.length; index++) visit(index);
  return result;
}

export async function previewImport(
  session: DemoUserSession,
  input: ImportRequest,
): Promise<ImportPreview> {
  await ensureDatabase();
  const permission =
    input.kind === "LOCATIONS" || input.kind === "ASSETS"
      ? "asset.manage"
      : "inventory.manage";
  if (!session.permissionCodes.includes(permission))
    throw new ApiContractError(
      403,
      "IMPORT_DENIED",
      "Tu perfil no puede importar estos datos.",
    );
  if (
    (input.kind === "PARTS" || input.kind === "SUPPLIERS") &&
    !session.fullWarehouseAccess
  )
    throw new ApiContractError(
      403,
      "WAREHOUSE_SCOPE_DENIED",
      "El catálogo común requiere acceso completo a almacenes.",
    );
  let table;
  try {
    table = parseCsv(input.csv);
  } catch (error) {
    throw new ApiContractError(
      400,
      String(error).replace("Error: ", ""),
      "El CSV no es válido.",
    );
  }
  for (const field of required(input.kind))
    if (!input.mapping[field] || !table.headers.includes(input.mapping[field]))
      throw new ApiContractError(
        400,
        "IMPORT_MAPPING_INCOMPLETE",
        `Falta mapear ${field}.`,
      );
  let rows: Record<string, string>[];
  try {
    rows = mapCsvRows(table, input.mapping);
  } catch {
    throw new ApiContractError(
      400,
      "IMPORT_MAPPING_INVALID",
      "El mapeo no coincide con las columnas.",
    );
  }
  if (!rows.length)
    throw new ApiContractError(
      400,
      "CSV_EMPTY",
      "El CSV no contiene filas de datos.",
    );
  const errors: ImportIssue[] = [],
    warnings: ImportIssue[] = [],
    seen = new Set<string>();
  const add = (index: number, code: string, message: string) =>
    errors.push({ row: index + 2, code, message });
  const keys = rows.map((row) => identity(input.kind, row));
  const allRefs = (name: string) => [
    ...new Set(
      rows.map((row) => (row[name] ?? "").trim().toUpperCase()).filter(Boolean),
    ),
  ];
  const existing = await lookup(
    session,
    input.kind === "LOCATIONS"
      ? "functional_locations"
      : input.kind === "ASSETS"
        ? "assets"
        : input.kind === "PARTS"
          ? "parts"
          : "vendors",
    input.kind === "PARTS" ? "sku" : "code",
    [...new Set([...keys, ...allRefs("parentCode")])],
    input.kind === "LOCATIONS" || input.kind === "ASSETS",
  );
  const locations =
    input.kind === "ASSETS"
      ? await lookup(
          session,
          "functional_locations",
          "code",
          allRefs("locationCode"),
          true,
        )
      : new Map<string, Existing>();
  const classes =
    input.kind === "ASSETS"
      ? await lookup(
          session,
          "asset_classes",
          "code",
          allRefs("classCode"),
          false,
        )
      : new Map<string, Existing>();
  const categories =
    input.kind === "PARTS"
      ? await lookup(
          session,
          "part_categories",
          "code",
          allRefs("categoryCode"),
          false,
        )
      : new Map<string, Existing>();
  const inFile = new Set(keys);
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index],
      key = keys[index];
    if (!key) add(index, "IDENTITY_MISSING", "Falta el código identificador.");
    if (key && !/^[A-Z0-9][A-Z0-9-]{1,49}$/.test(key))
      add(index, "IDENTITY_INVALID", "Código industrial no válido.");
    if (seen.has(key))
      add(
        index,
        "DUPLICATE_IN_FILE",
        "El código aparece más de una vez en el archivo.",
      );
    seen.add(key);
    if (!row.name?.trim()) add(index, "NAME_REQUIRED", "Falta el nombre.");
    if (input.kind === "LOCATIONS") {
      if (
        ![
          "AREA",
          "PRODUCTION_LINE",
          "SYSTEM",
          "ZONE",
          "WAREHOUSE",
          "WORKSHOP",
          "LAB",
          "UTILITY",
        ].includes(row.type?.toUpperCase())
      )
        add(index, "TYPE_INVALID", "Tipo de ubicación no válido.");
      const parent = (row.parentCode ?? "").toUpperCase();
      if (parent && !existing.has(parent) && !inFile.has(parent))
        add(index, "PARENT_NOT_FOUND", "La ubicación padre no existe.");
      if (!parent && !session.fullAreaAccess)
        add(index, "AREA_SCOPE_DENIED", "No puedes crear ubicaciones raíz.");
    }
    if (input.kind === "ASSETS") {
      if (
        row.kind &&
        !["EQUIPMENT", "ASSEMBLY", "COMPONENT"].includes(row.kind.toUpperCase())
      )
        add(index, "KIND_INVALID", "Tipo de activo no válido.");
      if (!locations.has(row.locationCode?.toUpperCase()))
        add(
          index,
          "LOCATION_NOT_FOUND",
          "La ubicación no existe en la planta.",
        );
      if (!classes.has(row.classCode?.toUpperCase()))
        add(index, "CLASS_NOT_FOUND", "La clase de activo no existe.");
      if (
        !["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(
          row.criticality?.toUpperCase(),
        )
      )
        add(index, "CRITICALITY_INVALID", "Criticidad no válida.");
      const parent = (row.parentCode ?? "").toUpperCase();
      if (parent && !existing.has(parent) && !inFile.has(parent))
        add(index, "PARENT_NOT_FOUND", "El activo padre no existe.");
      const locationId = locations.get(row.locationCode?.toUpperCase())?.id;
      if (locationId) {
        try {
          await assertLocationScope(session, locationId);
        } catch {
          add(index, "AREA_SCOPE_DENIED", "Ubicación fuera de tu ámbito.");
        }
      }
    }
    if (input.kind === "PARTS") {
      if (!categories.has(row.categoryCode?.toUpperCase()))
        add(index, "CATEGORY_NOT_FOUND", "La categoría no existe.");
      if (!row.unit?.trim()) add(index, "UNIT_REQUIRED", "Falta unidad.");
      if (
        row.standardCost &&
        (!Number.isFinite(Number(row.standardCost)) ||
          Number(row.standardCost) < 0)
      )
        add(index, "COST_INVALID", "Coste no válido.");
    }
    if (
      input.kind === "SUPPLIERS" &&
      row.email &&
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)
    )
      add(index, "EMAIL_INVALID", "Email no válido.");
    if (
      input.kind === "SUPPLIERS" &&
      row.leadTimeDays &&
      (!Number.isInteger(Number(row.leadTimeDays)) ||
        Number(row.leadTimeDays) < 0 ||
        Number(row.leadTimeDays) > 365)
    )
      add(index, "LEAD_TIME_INVALID", "Lead time no válido.");
    if (existing.has(key))
      warnings.push({
        row: index + 2,
        code: "WILL_UPDATE",
        message:
          "El registro existente se actualizará; no se borrará historial.",
      });
  }
  try {
    orderRows(input.kind, rows);
  } catch {
    errors.push({
      row: 0,
      code: "HIERARCHY_CYCLE",
      message: "El archivo contiene un ciclo jerárquico.",
    });
  }
  const descriptors = rows.map((row, index) => ({
    row: index + 2,
    identity: keys[index],
    action: existing.has(keys[index])
      ? ("UPDATE" as const)
      : ("CREATE" as const),
  }));
  return {
    hash: await sourceHash(input),
    total: rows.length,
    created: descriptors.filter((row) => row.action === "CREATE").length,
    updated: descriptors.filter((row) => row.action === "UPDATE").length,
    skipped: 0,
    errors,
    warnings,
    rows: descriptors.slice(0, 100),
  };
}

export async function commitImport(
  session: DemoUserSession,
  requestId: string,
  input: ImportRequest,
  expectedHash: string,
) {
  const preview = await previewImport(session, input);
  if (preview.hash !== expectedHash)
    throw new ApiContractError(
      409,
      "IMPORT_CHANGED",
      "El archivo o mapeo cambió tras la validación.",
    );
  if (preview.errors.length)
    throw new ApiContractError(
      422,
      "IMPORT_VALIDATION_FAILED",
      "Resuelve los errores antes de importar.",
    );
  const db = getD1(),
    now = new Date().toISOString();
  const previous = await db
    .prepare(
      "SELECT id,status,summary_json AS summaryJson FROM import_jobs WHERE organization_id=? AND site_id=? AND kind=? AND source_hash=?",
    )
    .bind(session.organizationId, session.siteId, input.kind, preview.hash)
    .first<{ id: string; status: string; summaryJson: string | null }>();
  if (previous?.status === "COMPLETE")
    return JSON.parse(previous.summaryJson ?? "{}");
  if (previous?.status === "RUNNING")
    throw new ApiContractError(
      409,
      "IMPORT_IN_PROGRESS",
      "Esta importación ya está en curso.",
    );
  const jobId = previous?.id ?? `import-${crypto.randomUUID()}`;
  if (previous) {
    const reclaimed = await db
      .prepare(
        "UPDATE import_jobs SET status='RUNNING',updated_at=? WHERE id=? AND status='PARTIAL'",
      )
      .bind(now, jobId)
      .run();
    if (Number(reclaimed.meta.changes) !== 1)
      throw new ApiContractError(
        409,
        "IMPORT_IN_PROGRESS",
        "Esta importación ya está en curso.",
      );
  } else {
    try {
      await db
        .prepare(
          "INSERT INTO import_jobs (id,organization_id,site_id,actor_id,kind,source_hash,source_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'RUNNING',?,?)",
        )
        .bind(
          jobId,
          session.organizationId,
          session.siteId,
          session.userId,
          input.kind,
          preview.hash,
          input.sourceName.slice(0, 200),
          now,
          now,
        )
        .run();
    } catch (error) {
      if (String(error).includes("uq_import_jobs_source"))
        throw new ApiContractError(
          409,
          "IMPORT_IN_PROGRESS",
          "Esta importación ya está en curso.",
        );
      throw error;
    }
  }
  const rows = mapCsvRows(parseCsv(input.csv), input.mapping);
  const ordered = orderRows(input.kind, rows);
  let created = 0,
    updated = 0,
    failed = 0;
  const failures: ImportIssue[] = [];
  for (const index of ordered) {
    const row = rows[index],
      key = identity(input.kind, row);
    try {
      if (input.kind === "LOCATIONS") {
        const current = await lookup(
          session,
          "functional_locations",
          "code",
          [key],
          true,
        );
        const parent = row.parentCode
          ? await lookup(
              session,
              "functional_locations",
              "code",
              [row.parentCode.toUpperCase()],
              true,
            )
          : new Map<string, Existing>();
        const old = current.get(key)
          ? await db
              .prepare(
                "SELECT parent_id AS parentId,description,status FROM functional_locations WHERE id=?",
              )
              .bind(current.get(key)!.id)
              .first<{
                parentId: string | null;
                description: string | null;
                status: "ACTIVE" | "INACTIVE";
              }>()
          : null;
        const payload: LocationInput = {
          code: key,
          name: row.name,
          type: row.type.toUpperCase() as LocationInput["type"],
          parentId: row.parentCode
            ? parent.get(row.parentCode.toUpperCase())?.id
            : (old?.parentId ?? null),
          description: row.description || old?.description || null,
          status: old?.status ?? "ACTIVE",
        };
        if (current.has(key)) {
          await updateLocation(
            session,
            requestId,
            current.get(key)!.id,
            payload,
          );
          updated++;
        } else {
          await createLocation(session, requestId, payload);
          created++;
        }
      } else if (input.kind === "ASSETS") {
        const current = await lookup(session, "assets", "code", [key], true);
        const parent = row.parentCode
          ? await lookup(
              session,
              "assets",
              "code",
              [row.parentCode.toUpperCase()],
              true,
            )
          : new Map<string, Existing>();
        const location = await lookup(
          session,
          "functional_locations",
          "code",
          [row.locationCode.toUpperCase()],
          true,
        );
        const classes = await lookup(
          session,
          "asset_classes",
          "code",
          [row.classCode.toUpperCase()],
          false,
        );
        const old = current.get(key)
          ? await db
              .prepare(
                "SELECT description,kind,status,manufacturer,model,serial_number AS serialNumber,parent_asset_id AS parentId,commissioned_at AS commissionedAt,warranty_until AS warrantyUntil,technical_summary AS technicalSummary,vendor_id AS vendorId FROM assets WHERE id=?",
              )
              .bind(current.get(key)!.id)
              .first<{
                description: string;
                kind: AssetInput["kind"];
                status: AssetInput["status"];
                manufacturer: string | null;
                model: string | null;
                serialNumber: string | null;
                parentId: string | null;
                commissionedAt: string | null;
                warrantyUntil: string | null;
                technicalSummary: string | null;
                vendorId: string | null;
              }>()
          : null;
        const payload: AssetInput = {
          code: key,
          name: row.name,
          description: row.description || old?.description || "",
          kind: (row.kind?.toUpperCase() ||
            old?.kind ||
            "EQUIPMENT") as AssetInput["kind"],
          functionalLocationId: location.get(row.locationCode.toUpperCase())!
            .id,
          parentAssetId: row.parentCode
            ? parent.get(row.parentCode.toUpperCase())?.id
            : (old?.parentId ?? null),
          assetClassId: classes.get(row.classCode.toUpperCase())!.id,
          status: old?.status ?? "OPERATING",
          criticality:
            row.criticality.toUpperCase() as AssetInput["criticality"],
          manufacturer: row.manufacturer || old?.manufacturer || null,
          model: row.model || old?.model || null,
          serialNumber: row.serialNumber || old?.serialNumber || null,
          commissionedAt: old?.commissionedAt ?? null,
          warrantyUntil: old?.warrantyUntil ?? null,
          technicalSummary: old?.technicalSummary ?? null,
          vendorId: old?.vendorId ?? null,
        };
        if (current.has(key)) {
          await updateAsset(session, requestId, current.get(key)!.id, payload);
          updated++;
        } else {
          await createAsset(session, requestId, payload);
          created++;
        }
      } else if (input.kind === "PARTS") {
        const current = await lookup(session, "parts", "sku", [key], false),
          category = await lookup(
            session,
            "part_categories",
            "code",
            [row.categoryCode.toUpperCase()],
            false,
          );
        const old = current.get(key)
          ? await db
              .prepare(
                "SELECT description,manufacturer,manufacturer_ref AS manufacturerRef,standard_cost AS standardCost,currency,status FROM parts WHERE id=?",
              )
              .bind(current.get(key)!.id)
              .first<{
                description: string;
                manufacturer: string | null;
                manufacturerRef: string | null;
                standardCost: number;
                currency: "EUR" | "USD" | "GBP";
                status: "ACTIVE" | "INACTIVE";
              }>()
          : null;
        await saveMroMaster(session, requestId, {
          type: "PART",
          id: current.get(key)?.id,
          sku: key,
          name: row.name,
          description: row.description || old?.description || "",
          categoryId: category.get(row.categoryCode.toUpperCase())!.id,
          unit: row.unit,
          manufacturer: row.manufacturer || old?.manufacturer || null,
          manufacturerRef: row.manufacturerRef || old?.manufacturerRef || null,
          standardCost: row.standardCost
            ? Number(row.standardCost)
            : (old?.standardCost ?? 0),
          currency: old?.currency ?? "EUR",
          status: old?.status ?? "ACTIVE",
        });
        if (current.has(key)) updated++;
        else created++;
      } else {
        const current = await lookup(session, "vendors", "code", [key], false);
        const old = current.get(key)
          ? await db
              .prepare(
                "SELECT contact_name AS contactName,email,phone,address,payment_terms AS paymentTerms,currency,lead_time_days AS leadTimeDays,status FROM vendors WHERE id=?",
              )
              .bind(current.get(key)!.id)
              .first<{
                contactName: string | null;
                email: string | null;
                phone: string | null;
                address: string | null;
                paymentTerms: string;
                currency: "EUR" | "USD" | "GBP";
                leadTimeDays: number;
                status: "ACTIVE" | "INACTIVE";
              }>()
          : null;
        await saveMroMaster(session, requestId, {
          type: "VENDOR",
          id: current.get(key)?.id,
          code: key,
          name: row.name,
          category: row.category,
          contactName: old?.contactName ?? null,
          email: row.email || old?.email || null,
          phone: row.phone || old?.phone || null,
          address: old?.address ?? null,
          paymentTerms: old?.paymentTerms ?? "NET30",
          currency: old?.currency ?? "EUR",
          leadTimeDays: row.leadTimeDays
            ? Number(row.leadTimeDays)
            : (old?.leadTimeDays ?? 7),
          status: old?.status ?? "ACTIVE",
        });
        if (current.has(key)) updated++;
        else created++;
      }
    } catch (error) {
      failed++;
      failures.push({
        row: index + 2,
        code: "ROW_FAILED",
        message: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }
  const summary = {
    jobId,
    total: rows.length,
    created,
    updated,
    skipped: 0,
    failed,
    warnings: preview.warnings.length,
    failures,
  };
  const finished = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE import_jobs SET status=?,summary_json=?,updated_at=? WHERE id=?",
      )
      .bind(
        failed ? "PARTIAL" : "COMPLETE",
        JSON.stringify(summary),
        finished,
        jobId,
      ),
    db
      .prepare(
        "INSERT INTO audit_entries (id,organization_id,site_id,actor_id,action,entity_type,entity_id,new_value,request_id,outcome,created_at) VALUES (?,?,?,?, 'IMPORT_FINISHED','IMPORT_JOB',?,?,?,? ,?)",
      )
      .bind(
        `audit-${crypto.randomUUID()}`,
        session.organizationId,
        session.siteId,
        session.userId,
        jobId,
        JSON.stringify(summary),
        requestId,
        failed ? "FAILURE" : "SUCCESS",
        finished,
      ),
  ]);
  return summary;
}
