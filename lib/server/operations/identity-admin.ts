import { getD1 } from "@/db";
import type { DemoUserSession } from "@/lib/server/auth";
import { derivePasswordHash, randomToken } from "@/lib/server/crypto";
import { ensureDatabase } from "@/lib/server/database";
import { ApiContractError } from "@/lib/server/http";
import { atomicBatch, assertLocationScope } from "./shared";

export type UserScopeInput = {
  fullAreaAccess: boolean;
  areaIds: string[];
  fullWarehouseAccess: boolean;
  warehouseIds: string[];
};
export type UserInput = UserScopeInput & {
  email: string;
  fullName: string;
  jobTitle: string;
  roleKey: string;
  password: string;
};

function authorize(session: DemoUserSession) {
  if (!session.permissionCodes.includes("identity.manage"))
    throw new ApiContractError(
      403,
      "IDENTITY_MANAGE_DENIED",
      "Tu perfil no puede administrar usuarios.",
    );
}

async function validateScope(session: DemoUserSession, scope: UserScopeInput) {
  if (scope.fullAreaAccess && !session.fullAreaAccess)
    throw new ApiContractError(
      403,
      "AREA_SCOPE_ESCALATION",
      "No puedes conceder acceso a todas las áreas.",
    );
  if (scope.fullWarehouseAccess && !session.fullWarehouseAccess)
    throw new ApiContractError(
      403,
      "WAREHOUSE_SCOPE_ESCALATION",
      "No puedes conceder acceso a todos los almacenes.",
    );
  const db = getD1();
  for (const id of new Set(scope.areaIds)) {
    await assertLocationScope(session, id);
    if (
      !(await db
        .prepare(
          "SELECT id FROM functional_locations WHERE id=? AND organization_id=? AND site_id=? AND status='ACTIVE'",
        )
        .bind(id, session.organizationId, session.siteId)
        .first())
    )
      throw new ApiContractError(
        404,
        "AREA_NOT_FOUND",
        "Área no encontrada en la planta.",
      );
  }
  for (const id of new Set(scope.warehouseIds)) {
    if (!session.fullWarehouseAccess && !session.warehouseIds.includes(id))
      throw new ApiContractError(
        403,
        "WAREHOUSE_SCOPE_ESCALATION",
        "El almacén excede tu ámbito.",
      );
    if (
      !(await db
        .prepare(
          "SELECT id FROM warehouses WHERE id=? AND organization_id=? AND site_id=? AND status='ACTIVE'",
        )
        .bind(id, session.organizationId, session.siteId)
        .first())
    )
      throw new ApiContractError(
        404,
        "WAREHOUSE_NOT_FOUND",
        "Almacén no encontrado en la planta.",
      );
  }
}

function scopeStatements(
  db: D1Database,
  scopeId: string,
  scope: UserScopeInput,
  now: string,
) {
  return [
    ...(!scope.fullAreaAccess
      ? [...new Set(scope.areaIds)].map((id) =>
          db
            .prepare(
              "INSERT INTO membership_area_scopes (id,membership_site_scope_id,functional_location_id,created_at) VALUES (?,?,?,?)",
            )
            .bind(`area-scope-${crypto.randomUUID()}`, scopeId, id, now),
        )
      : []),
    ...(!scope.fullWarehouseAccess
      ? [...new Set(scope.warehouseIds)].map((id) =>
          db
            .prepare(
              "INSERT INTO membership_warehouse_scopes (id,membership_site_scope_id,warehouse_id,created_at) VALUES (?,?,?,?)",
            )
            .bind(`warehouse-scope-${crypto.randomUUID()}`, scopeId, id, now),
        )
      : []),
  ];
}

export async function createManagedUser(
  session: DemoUserSession,
  requestId: string,
  input: UserInput,
) {
  authorize(session);
  await ensureDatabase();
  await validateScope(session, input);
  const db = getD1();
  if (
    !(await db
      .prepare("SELECT key FROM roles WHERE key=?")
      .bind(input.roleKey)
      .first())
  )
    throw new ApiContractError(400, "ROLE_NOT_FOUND", "Rol no disponible.");
  const now = new Date().toISOString(),
    userId = `user-${crypto.randomUUID()}`,
    membershipId = `membership-${crypto.randomUUID()}`,
    scopeId = `scope-${crypto.randomUUID()}`;
  const salt = randomToken(16),
    hash = await derivePasswordHash(input.password, salt);
  const initials = input.fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO users (id,email,full_name,initials,job_title,avatar_color,password_hash,password_salt,status,auth_provider,failed_login_count,created_at,updated_at) VALUES (?,?,?,?,?,'graphite',?,?,'ACTIVE','LOCAL',0,?,?)",
        )
        .bind(
          userId,
          input.email.toLowerCase(),
          input.fullName,
          initials,
          input.jobTitle,
          hash,
          salt,
          now,
          now,
        ),
      db
        .prepare(
          "INSERT INTO memberships (id,organization_id,user_id,role_key,default_site_id,status,created_at,updated_at) VALUES (?,?,?,?,?,'ACTIVE',?,?)",
        )
        .bind(
          membershipId,
          session.organizationId,
          userId,
          input.roleKey,
          session.siteId,
          now,
          now,
        ),
      db
        .prepare(
          "INSERT INTO membership_site_scopes (id,membership_id,site_id,full_area_access,full_warehouse_access,created_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          scopeId,
          membershipId,
          session.siteId,
          Number(input.fullAreaAccess),
          Number(input.fullWarehouseAccess),
          now,
        ),
      ...scopeStatements(db, scopeId, input, now),
      db
        .prepare(
          "INSERT INTO audit_entries (id,organization_id,site_id,actor_id,action,entity_type,entity_id,new_value,request_id,outcome,created_at) VALUES (?,?,?,?, 'USER_PROVISIONED','USER',?,?,?,'SUCCESS',?)",
        )
        .bind(
          `audit-${crypto.randomUUID()}`,
          session.organizationId,
          session.siteId,
          session.userId,
          userId,
          JSON.stringify({
            email: input.email,
            roleKey: input.roleKey,
            scope: input.fullAreaAccess ? "ALL_AREAS" : input.areaIds,
          }),
          requestId,
          now,
        ),
    ]);
  } catch (error) {
    if (String(error).includes("uq_users_email"))
      throw new ApiContractError(
        409,
        "EMAIL_EXISTS",
        "El email ya está registrado.",
      );
    throw error;
  }
  return { id: userId, email: input.email.toLowerCase() };
}

export async function updateManagedUser(
  session: DemoUserSession,
  requestId: string,
  userId: string,
  input: { roleKey: string; status: "ACTIVE" | "INACTIVE" } & UserScopeInput,
) {
  authorize(session);
  await ensureDatabase();
  await validateScope(session, input);
  const db = getD1();
  if (
    !(await db
      .prepare("SELECT key FROM roles WHERE key=?")
      .bind(input.roleKey)
      .first())
  )
    throw new ApiContractError(400, "ROLE_NOT_FOUND", "Rol no disponible.");
  const before = await db
    .prepare(
      `SELECT m.id AS membershipId,m.role_key AS roleKey,m.status,m.updated_at AS updatedAt,s.id AS scopeId
    FROM memberships m LEFT JOIN membership_site_scopes s ON s.membership_id=m.id AND s.site_id=?
    WHERE m.organization_id=? AND m.user_id=?`,
    )
    .bind(session.siteId, session.organizationId, userId)
    .first<{
      membershipId: string;
      roleKey: string;
      status: string;
      updatedAt: string;
      scopeId: string | null;
    }>();
  if (!before)
    throw new ApiContractError(
      404,
      "USER_NOT_FOUND",
      "Usuario no encontrado en la organización.",
    );
  if (!session.fullAreaAccess || !session.fullWarehouseAccess) {
    if (!before.scopeId)
      throw new ApiContractError(
        403,
        "TARGET_SCOPE_DENIED",
        "No puedes administrar un usuario fuera de tu planta.",
      );
    const targetScope = await db
      .prepare(
        "SELECT full_area_access AS fullAreaAccess,full_warehouse_access AS fullWarehouseAccess FROM membership_site_scopes WHERE id=?",
      )
      .bind(before.scopeId)
      .first<{ fullAreaAccess: number; fullWarehouseAccess: number }>();
    if (
      (!session.fullAreaAccess && targetScope?.fullAreaAccess) ||
      (!session.fullWarehouseAccess && targetScope?.fullWarehouseAccess)
    )
      throw new ApiContractError(
        403,
        "TARGET_SCOPE_DENIED",
        "El usuario tiene acceso fuera de tu ámbito.",
      );
    const targetAreas = (
      await db
        .prepare(
          "SELECT functional_location_id AS id FROM membership_area_scopes WHERE membership_site_scope_id=?",
        )
        .bind(before.scopeId)
        .all<{ id: string }>()
    ).results;
    const targetWarehouses = (
      await db
        .prepare(
          "SELECT warehouse_id AS id FROM membership_warehouse_scopes WHERE membership_site_scope_id=?",
        )
        .bind(before.scopeId)
        .all<{ id: string }>()
    ).results;
    for (const { id } of targetAreas) await assertLocationScope(session, id);
    if (
      !session.fullWarehouseAccess &&
      targetWarehouses.some(({ id }) => !session.warehouseIds.includes(id))
    )
      throw new ApiContractError(
        403,
        "TARGET_SCOPE_DENIED",
        "El usuario tiene acceso fuera de tu ámbito.",
      );
  }
  if (
    userId === session.userId &&
    (input.status !== "ACTIVE" || input.roleKey !== before.roleKey)
  )
    throw new ApiContractError(
      409,
      "SELF_LOCKOUT",
      "No puedes retirar tu propio acceso de administración.",
    );
  if (
    before.roleKey === "ADMIN" &&
    (input.roleKey !== "ADMIN" || input.status !== "ACTIVE")
  ) {
    const count = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM memberships WHERE organization_id=? AND role_key='ADMIN' AND status='ACTIVE'",
      )
      .bind(session.organizationId)
      .first<{ count: number }>();
    if (Number(count?.count ?? 0) <= 1)
      throw new ApiContractError(
        409,
        "LAST_ADMIN",
        "La organización necesita un administrador activo.",
      );
  }
  const now = new Date().toISOString(),
    scopeId = before.scopeId ?? `scope-${crypto.randomUUID()}`;
  await atomicBatch(db, [
    db
      .prepare(
        "UPDATE memberships SET role_key=?,status=?,updated_at=? WHERE id=? AND updated_at=?",
      )
      .bind(
        input.roleKey,
        input.status,
        now,
        before.membershipId,
        before.updatedAt,
      ),
    db
      .prepare(
        "INSERT INTO membership_site_scopes (id,membership_id,site_id,full_area_access,full_warehouse_access,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(membership_id,site_id) DO UPDATE SET full_area_access=excluded.full_area_access,full_warehouse_access=excluded.full_warehouse_access",
      )
      .bind(
        scopeId,
        before.membershipId,
        session.siteId,
        Number(input.fullAreaAccess),
        Number(input.fullWarehouseAccess),
        now,
      ),
    db
      .prepare(
        "DELETE FROM membership_area_scopes WHERE membership_site_scope_id=?",
      )
      .bind(scopeId),
    db
      .prepare(
        "DELETE FROM membership_warehouse_scopes WHERE membership_site_scope_id=?",
      )
      .bind(scopeId),
    ...scopeStatements(db, scopeId, input, now),
    db
      .prepare(
        "INSERT INTO audit_entries (id,organization_id,site_id,actor_id,action,entity_type,entity_id,previous_value,new_value,request_id,outcome,created_at) VALUES (?,?,?,?, 'USER_ACCESS_UPDATED','USER',?,?,?,?,'SUCCESS',?)",
      )
      .bind(
        `audit-${crypto.randomUUID()}`,
        session.organizationId,
        session.siteId,
        session.userId,
        userId,
        JSON.stringify(before),
        JSON.stringify(input),
        requestId,
        now,
      ),
    ...(input.status === "INACTIVE" || input.roleKey !== before.roleKey
      ? [
          db
            .prepare(
              "UPDATE sessions SET revoked_at=? WHERE user_id=? AND organization_id=? AND revoked_at IS NULL",
            )
            .bind(now, userId, session.organizationId),
        ]
      : []),
  ]);
  return { id: userId, status: input.status };
}
