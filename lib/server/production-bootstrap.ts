import { getD1 } from "@/db";
import { derivePasswordHash, hashToken, randomToken } from "./crypto";
import { ensureDatabase } from "./database";
import { ApiContractError } from "./http";
import { applicationMode } from "./runtime-mode";

export type InitialSetup = {
  organizationCode: string;
  organizationName: string;
  siteCode: string;
  siteName: string;
  siteShortName: string;
  city: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
};

export async function productionNeedsSetup(): Promise<boolean> {
  if (applicationMode() !== "PRODUCTION") return false;
  await ensureDatabase();
  const row = await getD1()
    .prepare("SELECT COUNT(*) AS count FROM organizations")
    .first<{ count: number }>();
  return Number(row?.count ?? 0) === 0;
}

/** The token is a private Worker secret, never persisted or returned. */
export async function bootstrapProduction(
  input: InitialSetup,
  presentedToken: string,
  configuredToken: string | undefined,
): Promise<void> {
  if (applicationMode() !== "PRODUCTION")
    throw new ApiContractError(
      404,
      "SETUP_UNAVAILABLE",
      "El aprovisionamiento no está disponible.",
    );
  if (!configuredToken || configuredToken.length < 32)
    throw new ApiContractError(
      503,
      "SETUP_NOT_CONFIGURED",
      "Configura un secreto de aprovisionamiento seguro.",
    );
  if (
    !presentedToken ||
    (await hashToken(presentedToken)) !== (await hashToken(configuredToken))
  )
    throw new ApiContractError(
      403,
      "SETUP_TOKEN_INVALID",
      "Credencial de aprovisionamiento incorrecta.",
    );
  await ensureDatabase();
  if (!(await productionNeedsSetup()))
    throw new ApiContractError(
      409,
      "ALREADY_PROVISIONED",
      "La organización inicial ya existe.",
    );

  const db = getD1();
  const now = new Date().toISOString();
  const organizationId = `org-${crypto.randomUUID()}`;
  const siteId = `site-${crypto.randomUUID()}`;
  const userId = `user-${crypto.randomUUID()}`;
  const membershipId = `membership-${crypto.randomUUID()}`;
  const passwordSalt = randomToken(16);
  const passwordHash = await derivePasswordHash(
    input.adminPassword,
    passwordSalt,
  );
  const initials = input.adminName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO organizations (id,code,name,timezone,locale,created_at,updated_at) SELECT ?,?,?,'Europe/Madrid','es-ES',?,? WHERE NOT EXISTS (SELECT 1 FROM organizations)",
        )
        .bind(
          organizationId,
          input.organizationCode,
          input.organizationName,
          now,
          now,
        ),
      db.prepare(
        "INSERT INTO _mutation_assertions (affected_rows) SELECT changes() WHERE changes() <> 1",
      ),
      db
        .prepare(
          "INSERT INTO sites (id,organization_id,code,name,short_name,city,timezone,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'Europe/Madrid','ACTIVE',?,?)",
        )
        .bind(
          siteId,
          organizationId,
          input.siteCode,
          input.siteName,
          input.siteShortName,
          input.city,
          now,
          now,
        ),
      db
        .prepare(
          "INSERT INTO users (id,email,full_name,initials,job_title,avatar_color,password_hash,password_salt,status,auth_provider,failed_login_count,created_at,updated_at) VALUES (?,?,?,?,?,'graphite',?,?,'ACTIVE','LOCAL',0,?,?)",
        )
        .bind(
          userId,
          input.adminEmail.toLowerCase(),
          input.adminName,
          initials,
          "Administrador",
          passwordHash,
          passwordSalt,
          now,
          now,
        ),
      db
        .prepare(
          "INSERT INTO memberships (id,organization_id,user_id,role_key,default_site_id,status,created_at,updated_at) VALUES (?,?,?,'ADMIN',?,'ACTIVE',?,?)",
        )
        .bind(membershipId, organizationId, userId, siteId, now, now),
      db
        .prepare(
          "INSERT INTO membership_site_scopes (id,membership_id,site_id,full_area_access,full_warehouse_access,created_at) VALUES (?,?,?,1,1,?)",
        )
        .bind(`scope-${crypto.randomUUID()}`, membershipId, siteId, now),
      db
        .prepare(
          "INSERT INTO audit_entries (id,organization_id,site_id,actor_id,action,entity_type,entity_id,outcome,created_at) VALUES (?,?,?,?, 'INITIAL_BOOTSTRAP','ORGANIZATION',?,'SUCCESS',?)",
        )
        .bind(
          `audit-${crypto.randomUUID()}`,
          organizationId,
          siteId,
          userId,
          organizationId,
          now,
        ),
    ]);
  } catch (error) {
    if (String(error).includes("ck_atomic_mutation_applied"))
      throw new ApiContractError(
        409,
        "ALREADY_PROVISIONED",
        "La organización inicial ya existe.",
      );
    throw error;
  }
}
