import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getD1 } from "@/db";
import { ensureDatabase } from "./database";
import { hashToken, randomToken, verifyPassword } from "./crypto";
import { ApiContractError } from "./http";
import type { EnterprisePermission } from "@/lib/domain/governance";
import { nextLoginFailureState } from "@/lib/domain/auth-security";

export const SESSION_COOKIE = "mazmi_session";
const DEFAULT_POLICY = {
  sessionHours: 12,
  idleMinutes: 120,
  absoluteHours: 24,
  rotationMinutes: 60,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
};

export type DemoUserSession = {
  sessionId: string;
  membershipId: string;
  userId: string;
  email: string;
  fullName: string;
  initials: string;
  jobTitle: string;
  avatarColor: string;
  roleKey: string;
  roleName: string;
  organizationId: string;
  organizationName: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  siteShortName: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  idleExpiresAt: string;
  rotatedAt: string | null;
  permissionCodes: EnterprisePermission[];
  fullAreaAccess: boolean;
  fullWarehouseAccess: boolean;
  areaIds: string[];
  warehouseIds: string[];
  sites: Array<{
    id: string;
    code: string;
    name: string;
    shortName: string;
    city: string;
  }>;
};

type SessionRow = Omit<
  DemoUserSession,
  | "sites"
  | "permissionCodes"
  | "fullAreaAccess"
  | "fullWarehouseAccess"
  | "areaIds"
  | "warehouseIds"
>;

type AuthPolicy = typeof DEFAULT_POLICY;

async function getAuthPolicy(organizationId: string): Promise<AuthPolicy> {
  return (
    (await getD1()
      .prepare(
        `SELECT session_hours AS sessionHours, idle_minutes AS idleMinutes,
          absolute_hours AS absoluteHours, rotation_minutes AS rotationMinutes,
          max_failed_attempts AS maxFailedAttempts, lockout_minutes AS lockoutMinutes
         FROM authentication_policies WHERE organization_id = ?`,
      )
      .bind(organizationId)
      .first<AuthPolicy>()) ?? DEFAULT_POLICY
  );
}

async function appendAuthAudit(input: {
  organizationId: string;
  siteId?: string | null;
  actorId?: string | null;
  action: string;
  requestId: string;
  outcome: "SUCCESS" | "DENIED" | "FAILURE";
  errorCode?: string | null;
  context?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  await getD1()
    .prepare(
      `INSERT INTO audit_entries
       (id, organization_id, site_id, actor_id, action, entity_type, entity_id,
        previous_value, new_value, request_id, context_json, outcome, error_code, created_at)
       VALUES (?, ?, ?, ?, ?, 'SESSION', ?, NULL, NULL, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `audit-auth-${crypto.randomUUID()}`,
      input.organizationId,
      input.siteId ?? null,
      input.actorId ?? null,
      input.action,
      input.actorId ?? "anonymous",
      input.requestId,
      JSON.stringify(input.context ?? {}),
      input.outcome,
      input.errorCode ?? null,
      now,
    )
    .run();
}

export async function auditDeniedAccess(
  session: DemoUserSession,
  requestId: string,
  errorCode: string,
) {
  await appendAuthAudit({
    organizationId: session.organizationId,
    siteId: session.siteId,
    actorId: session.userId,
    action: "ACCESS_DENIED",
    requestId,
    outcome: "DENIED",
    errorCode,
    context: { roleKey: session.roleKey },
  });
}

export async function getCurrentSession(): Promise<DemoUserSession | null> {
  await ensureDatabase();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = await hashToken(token);
  const row = await getD1()
    .prepare(
      `
    SELECT
      s.id AS sessionId,
      m.id AS membershipId,
      u.id AS userId,
      u.email,
      u.full_name AS fullName,
      u.initials,
      u.job_title AS jobTitle,
      u.avatar_color AS avatarColor,
      m.role_key AS roleKey,
      r.name AS roleName,
      s.organization_id AS organizationId,
      o.name AS organizationName,
      s.current_site_id AS siteId,
      site.code AS siteCode,
      site.name AS siteName,
      site.short_name AS siteShortName,
      s.expires_at AS expiresAt,
      COALESCE(s.absolute_expires_at, s.expires_at) AS absoluteExpiresAt,
      COALESCE(s.idle_expires_at, s.expires_at) AS idleExpiresAt,
      s.rotated_at AS rotatedAt
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    INNER JOIN memberships m ON m.user_id = u.id AND m.organization_id = s.organization_id
    INNER JOIN roles r ON r.key = m.role_key
    INNER JOIN organizations o ON o.id = s.organization_id
    INNER JOIN sites site ON site.id = s.current_site_id AND site.organization_id = s.organization_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
      AND COALESCE(s.absolute_expires_at, s.expires_at) > ?
      AND COALESCE(s.idle_expires_at, s.expires_at) > ?
      AND u.status = 'ACTIVE'
      AND m.status = 'ACTIVE'
    LIMIT 1
  `,
    )
    .bind(
      tokenHash,
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .first<SessionRow>();

  if (!row) return null;
  const scopedSites = await getD1()
    .prepare(
      `
    SELECT id, code, name, short_name AS shortName, city
    FROM sites site
    WHERE site.organization_id = ? AND site.status = 'ACTIVE'
      AND EXISTS (
        SELECT 1 FROM membership_site_scopes scope
        WHERE scope.membership_id = ? AND scope.site_id = site.id
      )
    ORDER BY site.name
  `,
    )
    .bind(row.organizationId, row.membershipId)
    .all<DemoUserSession["sites"][number]>();
  const sites = scopedSites.results ?? [];
  if (!sites.some((site) => site.id === row.siteId)) return null;

  const [permissionResult, siteScope, areaResult, warehouseResult] =
    await Promise.all([
      getD1()
        .prepare(
          "SELECT permission_code AS code FROM role_permissions WHERE role_key = ? ORDER BY permission_code",
        )
        .bind(row.roleKey)
        .all<{ code: EnterprisePermission }>(),
      getD1()
        .prepare(
          `SELECT id, full_area_access AS fullAreaAccess,
            full_warehouse_access AS fullWarehouseAccess
           FROM membership_site_scopes WHERE membership_id = ? AND site_id = ?`,
        )
        .bind(row.membershipId, row.siteId)
        .first<{
          id: string;
          fullAreaAccess: number;
          fullWarehouseAccess: number;
        }>(),
      getD1()
        .prepare(
          `SELECT area.functional_location_id AS id
           FROM membership_area_scopes area
           INNER JOIN membership_site_scopes site_scope
             ON site_scope.id = area.membership_site_scope_id
           WHERE site_scope.membership_id = ? AND site_scope.site_id = ?`,
        )
        .bind(row.membershipId, row.siteId)
        .all<{ id: string }>(),
      getD1()
        .prepare(
          `SELECT warehouse.warehouse_id AS id
           FROM membership_warehouse_scopes warehouse
           INNER JOIN membership_site_scopes site_scope
             ON site_scope.id = warehouse.membership_site_scope_id
           WHERE site_scope.membership_id = ? AND site_scope.site_id = ?`,
        )
        .bind(row.membershipId, row.siteId)
        .all<{ id: string }>(),
    ]);
  if (!siteScope) return null;
  const policy = await getAuthPolicy(row.organizationId);
  const now = new Date();
  const idleExpiresAt = new Date(
    now.getTime() + policy.idleMinutes * 60_000,
  ).toISOString();
  await getD1()
    .prepare(
      "UPDATE sessions SET last_seen_at = ?, idle_expires_at = MIN(?, COALESCE(absolute_expires_at, expires_at)) WHERE id = ? AND revoked_at IS NULL",
    )
    .bind(now.toISOString(), idleExpiresAt, row.sessionId)
    .run();

  return {
    ...row,
    sites,
    permissionCodes: (permissionResult.results ?? []).map((item) => item.code),
    fullAreaAccess: Boolean(siteScope.fullAreaAccess),
    fullWarehouseAccess: Boolean(siteScope.fullWarehouseAccess),
    areaIds: (areaResult.results ?? []).map((item) => item.id),
    warehouseIds: (warehouseResult.results ?? []).map((item) => item.id),
  };
}

export async function requireDemoSession(): Promise<DemoUserSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/");
  return session;
}

export async function requireApiSession(): Promise<DemoUserSession> {
  const session = await getCurrentSession();
  if (!session) {
    throw new ApiContractError(401, "UNAUTHORIZED", "Sesión requerida.");
  }
  await rotateSessionIfDue(session);
  return session;
}

export async function createDemoSession(
  email: string,
  password: string,
  requestId = crypto.randomUUID(),
): Promise<DemoUserSession | null> {
  await ensureDatabase();
  const normalizedEmail = email.trim().toLowerCase();
  const user = await getD1()
    .prepare(
      `
    SELECT
      u.id AS userId,
      u.password_hash AS passwordHash,
      u.password_salt AS passwordSalt,
      m.organization_id AS organizationId,
      m.default_site_id AS defaultSiteId,
      u.failed_login_count AS failedLoginCount,
      u.locked_until AS lockedUntil
    FROM users u
    INNER JOIN memberships m ON m.user_id = u.id
    WHERE u.email = ? AND u.status = 'ACTIVE' AND m.status = 'ACTIVE'
    LIMIT 1
  `,
    )
    .bind(normalizedEmail)
    .first<{
      userId: string;
      passwordHash: string;
      passwordSalt: string;
      organizationId: string;
      defaultSiteId: string;
      failedLoginCount: number;
      lockedUntil: string | null;
    }>();

  const now = new Date();
  if (user?.lockedUntil && user.lockedUntil > now.toISOString()) {
    await appendAuthAudit({
      organizationId: user.organizationId,
      siteId: user.defaultSiteId,
      actorId: user.userId,
      action: "LOGIN_BLOCKED",
      requestId,
      outcome: "DENIED",
      errorCode: "ACCOUNT_TEMPORARILY_LOCKED",
    });
    return null;
  }

  const valid =
    user &&
    (await verifyPassword(password, user.passwordSalt, user.passwordHash));
  if (!user || !valid) {
    await getD1()
      .prepare(
        `INSERT INTO login_attempts
         (id, organization_id, normalized_email, succeeded, failure_reason, request_id, attempted_at)
         VALUES (?, ?, ?, 0, 'INVALID_CREDENTIALS', ?, ?)`,
      )
      .bind(
        `login-attempt-${crypto.randomUUID()}`,
        user?.organizationId ?? null,
        normalizedEmail,
        requestId,
        now.toISOString(),
      )
      .run();
    if (user) {
      const policy = await getAuthPolicy(user.organizationId);
      const nextFailure = nextLoginFailureState(
        user.failedLoginCount,
        now,
        policy,
      );
      const failed = nextFailure.failedAttempts;
      const lockedUntil = nextFailure.lockedUntil;
      await getD1()
        .prepare(
          "UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?",
        )
        .bind(failed, lockedUntil, now.toISOString(), user.userId)
        .run();
      await appendAuthAudit({
        organizationId: user.organizationId,
        siteId: user.defaultSiteId,
        actorId: user.userId,
        action: lockedUntil ? "LOGIN_LOCKOUT" : "LOGIN_FAILED",
        requestId,
        outcome: "DENIED",
        errorCode: lockedUntil
          ? "ACCOUNT_TEMPORARILY_LOCKED"
          : "INVALID_CREDENTIALS",
      });
    }
    return null;
  }

  const policy = await getAuthPolicy(user.organizationId);

  const token = randomToken();
  const tokenHash = await hashToken(token);
  const expires = new Date(
    now.getTime() + policy.sessionHours * 60 * 60 * 1000,
  );
  const absoluteExpires = new Date(
    now.getTime() + policy.absoluteHours * 60 * 60 * 1000,
  );
  const idleExpires = new Date(now.getTime() + policy.idleMinutes * 60_000);
  const sessionId = `session-${randomToken(12)}`;
  const cookieStore = await cookies();
  const previousToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (previousToken) {
    await getD1()
      .prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?")
      .bind(now.toISOString(), await hashToken(previousToken))
      .run();
  }
  await getD1().batch([
    getD1()
      .prepare(
        `
      INSERT INTO sessions (
        id, token_hash, user_id, organization_id, current_site_id,
        expires_at, absolute_expires_at, idle_expires_at, rotated_at,
        session_family_id, created_at, last_seen_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `,
      )
      .bind(
        sessionId,
        tokenHash,
        user.userId,
        user.organizationId,
        user.defaultSiteId,
        expires.toISOString(),
        absoluteExpires.toISOString(),
        idleExpires.toISOString(),
        now.toISOString(),
        sessionId,
        now.toISOString(),
        now.toISOString(),
      ),
    getD1()
      .prepare(
        "UPDATE users SET last_login_at = ?, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
      )
      .bind(now.toISOString(), now.toISOString(), user.userId),
    getD1()
      .prepare(
        `INSERT INTO login_attempts
         (id, organization_id, normalized_email, succeeded, failure_reason, request_id, attempted_at)
         VALUES (?, ?, ?, 1, NULL, ?, ?)`,
      )
      .bind(
        `login-attempt-${crypto.randomUUID()}`,
        user.organizationId,
        normalizedEmail,
        requestId,
        now.toISOString(),
      ),
  ]);

  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });

  await appendAuthAudit({
    organizationId: user.organizationId,
    siteId: user.defaultSiteId,
    actorId: user.userId,
    action: "LOGIN_SUCCEEDED",
    requestId,
    outcome: "SUCCESS",
    context: { provider: "LOCAL" },
  });

  return getCurrentSession();
}

async function rotateSessionIfDue(session: DemoUserSession): Promise<void> {
  const policy = await getAuthPolicy(session.organizationId);
  const rotatedAt = new Date(session.rotatedAt ?? session.expiresAt).getTime();
  if (Date.now() - rotatedAt < policy.rotationMinutes * 60_000) return;
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const now = new Date();
  const result = await getD1()
    .prepare(
      `UPDATE sessions SET token_hash = ?, rotated_at = ?, last_seen_at = ?
       WHERE id = ? AND revoked_at IS NULL AND token_hash <> ?`,
    )
    .bind(
      tokenHash,
      now.toISOString(),
      now.toISOString(),
      session.sessionId,
      tokenHash,
    )
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) return;
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(session.expiresAt),
  });
}

export async function destroyDemoSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = await hashToken(token);
    await ensureDatabase();
    const session = await getD1()
      .prepare(
        "SELECT id, user_id AS userId, organization_id AS organizationId, current_site_id AS siteId FROM sessions WHERE token_hash = ?",
      )
      .bind(tokenHash)
      .first<{
        id: string;
        userId: string;
        organizationId: string;
        siteId: string;
      }>();
    await getD1()
      .prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?")
      .bind(new Date().toISOString(), tokenHash)
      .run();
    if (session) {
      await appendAuthAudit({
        organizationId: session.organizationId,
        siteId: session.siteId,
        actorId: session.userId,
        action: "LOGOUT",
        requestId: crypto.randomUUID(),
        outcome: "SUCCESS",
      });
    }
  }
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function switchCurrentSite(
  siteId: string,
  requestId = crypto.randomUUID(),
): Promise<"CHANGED" | "UNAUTHORIZED" | "FORBIDDEN"> {
  const session = await getCurrentSession();
  if (!session) return "UNAUTHORIZED";
  const allowed = session.sites.some((site) => site.id === siteId);
  if (!allowed) {
    await appendAuthAudit({
      organizationId: session.organizationId,
      siteId: session.siteId,
      actorId: session.userId,
      action: "ACCESS_DENIED",
      requestId,
      outcome: "DENIED",
      errorCode: "SITE_SCOPE_DENIED",
      context: { requestedSiteId: siteId },
    });
    return "FORBIDDEN";
  }
  await getD1()
    .prepare(
      "UPDATE sessions SET current_site_id = ?, last_seen_at = ? WHERE id = ?",
    )
    .bind(siteId, new Date().toISOString(), session.sessionId)
    .run();
  await appendAuthAudit({
    organizationId: session.organizationId,
    siteId,
    actorId: session.userId,
    action: "SITE_SCOPE_SWITCHED",
    requestId,
    outcome: "SUCCESS",
    context: { previousSiteId: session.siteId, nextSiteId: siteId },
  });
  return "CHANGED";
}

export async function assertSameOrigin(): Promise<void> {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  if (!origin) return;
  const host = requestHeaders.get("host");
  if (!host) {
    throw new ApiContractError(
      403,
      "ORIGIN_REJECTED",
      "No se ha podido verificar el origen de la petición.",
    );
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiContractError(
      403,
      "ORIGIN_REJECTED",
      "El origen de la petición no es válido.",
    );
  }
  if (originHost !== host) {
    throw new ApiContractError(
      403,
      "ORIGIN_REJECTED",
      "El origen de la petición no está permitido.",
    );
  }
}
