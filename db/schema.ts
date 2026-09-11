import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const systemState = sqliteTable("system_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("Europe/Madrid"),
    locale: text("locale").notNull().default("es-ES"),
    ...timestamps,
  },
  (table) => [uniqueIndex("uq_organizations_code").on(table.code)],
);

export const sites = sqliteTable(
  "sites",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    city: text("city").notNull(),
    timezone: text("timezone").notNull().default("Europe/Madrid"),
    status: text("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_sites_org_code").on(table.organizationId, table.code),
    index("idx_sites_organization").on(table.organizationId),
  ],
);

export const roles = sqliteTable("roles", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  rank: integer("rank").notNull(),
});

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    initials: text("initials").notNull(),
    jobTitle: text("job_title").notNull(),
    avatarColor: text("avatar_color").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    authProvider: text("auth_provider").notNull().default("LOCAL"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: text("locked_until"),
    lastLoginAt: text("last_login_at"),
    ...timestamps,
  },
  (table) => [uniqueIndex("uq_users_email").on(table.email)],
);

export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    roleKey: text("role_key")
      .notNull()
      .references(() => roles.key, { onDelete: "restrict" }),
    defaultSiteId: text("default_site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_memberships_org_user").on(
      table.organizationId,
      table.userId,
    ),
    index("idx_memberships_user").on(table.userId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    currentSiteId: text("current_site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    expiresAt: text("expires_at").notNull(),
    absoluteExpiresAt: text("absolute_expires_at"),
    idleExpiresAt: text("idle_expires_at"),
    rotatedAt: text("rotated_at"),
    sessionFamilyId: text("session_family_id"),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("uq_sessions_token_hash").on(table.tokenHash),
    index("idx_sessions_user_expires").on(table.userId, table.expiresAt),
  ],
);

export const permissionDefinitions = sqliteTable("permission_definitions", {
  code: text("code").primaryKey(),
  domain: text("domain").notNull(),
  action: text("action").notNull(),
  description: text("description").notNull(),
  sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(false),
});

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleKey: text("role_key")
      .notNull()
      .references(() => roles.key, { onDelete: "cascade" }),
    permissionCode: text("permission_code")
      .notNull()
      .references(() => permissionDefinitions.code, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_role_permission").on(table.roleKey, table.permissionCode),
    index("idx_role_permissions_permission").on(table.permissionCode),
  ],
);

export const functionalLocations = sqliteTable(
  "functional_locations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    parentId: text("parent_id").references(
      (): AnySQLiteColumn => functionalLocations.id,
      { onDelete: "restrict" },
    ),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    status: text("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_locations_site_code").on(table.siteId, table.code),
    index("idx_locations_site_parent").on(table.siteId, table.parentId),
    check(
      "ck_locations_type",
      sql`${table.type} in ('AREA','PRODUCTION_LINE','SYSTEM','ZONE','WAREHOUSE','WORKSHOP','LAB','UTILITY')`,
    ),
  ],
);

export const membershipSiteScopes = sqliteTable(
  "membership_site_scopes",
  {
    id: text("id").primaryKey(),
    membershipId: text("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    fullAreaAccess: integer("full_area_access", { mode: "boolean" })
      .notNull()
      .default(true),
    fullWarehouseAccess: integer("full_warehouse_access", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_membership_site_scope").on(
      table.membershipId,
      table.siteId,
    ),
  ],
);

export const membershipAreaScopes = sqliteTable(
  "membership_area_scopes",
  {
    id: text("id").primaryKey(),
    membershipSiteScopeId: text("membership_site_scope_id")
      .notNull()
      .references(() => membershipSiteScopes.id, { onDelete: "cascade" }),
    functionalLocationId: text("functional_location_id")
      .notNull()
      .references(() => functionalLocations.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_membership_area_scope").on(
      table.membershipSiteScopeId,
      table.functionalLocationId,
    ),
  ],
);

export const productionCalendars = sqliteTable(
  "production_calendars",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    functionalLocationId: text("functional_location_id").references(
      () => functionalLocations.id,
      { onDelete: "restrict" },
    ),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_production_calendar_scope").on(
      table.siteId,
      table.functionalLocationId,
    ),
    index("idx_production_calendar_site_status").on(table.siteId, table.status),
  ],
);

export const productionCalendarWindows = sqliteTable(
  "production_calendar_windows",
  {
    id: text("id").primaryKey(),
    calendarId: text("calendar_id")
      .notNull()
      .references(() => productionCalendars.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    kind: text("kind").notNull().default("PRODUCTION"),
    capacityPercent: integer("capacity_percent").notNull().default(100),
    label: text("label"),
  },
  (table) => [
    index("idx_calendar_windows_day").on(
      table.calendarId,
      table.dayOfWeek,
      table.startMinute,
    ),
    check("ck_calendar_window_day", sql`${table.dayOfWeek} between 0 and 6`),
    check(
      "ck_calendar_window_minutes",
      sql`${table.startMinute} between 0 and 1439 and ${table.endMinute} between 1 and 1440 and ${table.endMinute} > ${table.startMinute}`,
    ),
    check(
      "ck_calendar_window_capacity",
      sql`${table.capacityPercent} between 0 and 100`,
    ),
  ],
);

export const productionCalendarExceptions = sqliteTable(
  "production_calendar_exceptions",
  {
    id: text("id").primaryKey(),
    calendarId: text("calendar_id")
      .notNull()
      .references(() => productionCalendars.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    kind: text("kind").notNull(),
    startMinute: integer("start_minute"),
    endMinute: integer("end_minute"),
    capacityPercent: integer("capacity_percent").notNull().default(0),
    reason: text("reason").notNull(),
  },
  (table) => [
    index("idx_calendar_exceptions_date").on(table.calendarId, table.date),
    check(
      "ck_calendar_exception_capacity",
      sql`${table.capacityPercent} between 0 and 100`,
    ),
  ],
);

export const workShifts = sqliteTable(
  "work_shifts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    team: text("team").notNull(),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    daysMask: text("days_mask").notNull(),
    capacityMinutes: integer("capacity_minutes").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_work_shifts_site_code").on(table.siteId, table.code),
    check("ck_work_shift_capacity", sql`${table.capacityMinutes} > 0`),
  ],
);

export const shiftAssignments = sqliteTable(
  "shift_assignments",
  {
    id: text("id").primaryKey(),
    shiftId: text("shift_id")
      .notNull()
      .references(() => workShifts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    capacityMinutesOverride: integer("capacity_minutes_override"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_shift_assignments_user_dates").on(
      table.userId,
      table.effectiveFrom,
      table.effectiveTo,
    ),
  ],
);

export const workforceAbsences = sqliteTable(
  "workforce_absences",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    kind: text("kind").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_workforce_absence_site_dates").on(
      table.siteId,
      table.startsAt,
      table.endsAt,
    ),
    check(
      "ck_workforce_absence_dates",
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

export const laborRateCards = sqliteTable(
  "labor_rate_cards",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    roleKey: text("role_key").references(() => roles.key, {
      onDelete: "restrict",
    }),
    shiftId: text("shift_id").references(() => workShifts.id, {
      onDelete: "restrict",
    }),
    hourlyRateCents: integer("hourly_rate_cents").notNull(),
    currency: text("currency").notNull().default("EUR"),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_labor_rate_user_dates").on(
      table.userId,
      table.effectiveFrom,
      table.effectiveTo,
    ),
    check("ck_labor_rate_amount", sql`${table.hourlyRateCents} >= 0`),
    check(
      "ck_labor_rate_subject",
      sql`${table.userId} is not null or ${table.roleKey} is not null`,
    ),
  ],
);

export const assetClasses = sqliteTable(
  "asset_classes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    family: text("family").notNull(),
  },
  (table) => [
    uniqueIndex("uq_asset_classes_org_code").on(
      table.organizationId,
      table.code,
    ),
  ],
);

export const vendors = sqliteTable(
  "vendors",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    paymentTerms: text("payment_terms").notNull().default("NET30"),
    currency: text("currency").notNull().default("EUR"),
    leadTimeDays: integer("lead_time_days").notNull().default(7),
    status: text("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_vendors_org_code").on(table.organizationId, table.code),
  ],
);

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    functionalLocationId: text("functional_location_id")
      .notNull()
      .references(() => functionalLocations.id, { onDelete: "restrict" }),
    parentAssetId: text("parent_asset_id").references(
      (): AnySQLiteColumn => assets.id,
      { onDelete: "restrict" },
    ),
    assetClassId: text("asset_class_id")
      .notNull()
      .references(() => assetClasses.id, { onDelete: "restrict" }),
    vendorId: text("vendor_id").references(() => vendors.id, {
      onDelete: "restrict",
    }),
    scanCode: text("scan_code"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    criticality: text("criticality").notNull(),
    healthScore: integer("health_score").notNull(),
    manufacturer: text("manufacturer"),
    model: text("model"),
    serialNumber: text("serial_number"),
    commissionedAt: text("commissioned_at"),
    warrantyUntil: text("warranty_until"),
    nextPmAt: text("next_pm_at"),
    technicalSummary: text("technical_summary"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_assets_site_code").on(table.siteId, table.code),
    uniqueIndex("uq_assets_org_scan_code").on(
      table.organizationId,
      table.scanCode,
    ),
    index("idx_assets_site_status_criticality").on(
      table.siteId,
      table.status,
      table.criticality,
    ),
    index("idx_assets_site_health").on(table.siteId, table.healthScore),
    index("idx_assets_location").on(table.functionalLocationId),
    index("idx_assets_parent").on(table.siteId, table.parentAssetId),
    check("ck_assets_health", sql`${table.healthScore} between 0 and 100`),
    check(
      "ck_assets_kind",
      sql`${table.kind} in ('EQUIPMENT','ASSEMBLY','COMPONENT')`,
    ),
    check(
      "ck_assets_status",
      sql`${table.status} in ('OPERATING','DEGRADED','DOWN','MAINTENANCE','STANDBY','RETIRED')`,
    ),
    check(
      "ck_assets_criticality",
      sql`${table.criticality} in ('CRITICAL','HIGH','MEDIUM','LOW')`,
    ),
  ],
);

export const incidents = sqliteTable(
  "incidents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    functionalLocationId: text("functional_location_id")
      .notNull()
      .references(() => functionalLocations.id, { onDelete: "restrict" }),
    assetId: text("asset_id").references(() => assets.id, {
      onDelete: "restrict",
    }),
    reportedById: text("reported_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    severity: text("severity").notNull(),
    initialImpact: text("initial_impact").notNull(),
    status: text("status").notNull().default("NEW"),
    origin: text("origin").notNull(),
    classification: text("classification"),
    triagePriority: text("triage_priority"),
    reportedAt: text("reported_at").notNull(),
    triagedAt: text("triaged_at"),
    resolvedAt: text("resolved_at"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_incidents_org_number").on(
      table.organizationId,
      table.number,
    ),
    index("idx_incidents_site_status_reported").on(
      table.siteId,
      table.status,
      table.reportedAt,
    ),
    index("idx_incidents_asset_reported").on(table.assetId, table.reportedAt),
    check(
      "ck_incidents_status",
      sql`${table.status} in ('NEW','IN_TRIAGE','ACCEPTED','REJECTED','CONVERTED','CLOSED')`,
    ),
    check(
      "ck_incidents_severity",
      sql`${table.severity} in ('CRITICAL','HIGH','MEDIUM','LOW')`,
    ),
    check(
      "ck_incidents_origin",
      sql`${table.origin} in ('OPERATOR','MAINTENANCE','INSPECTION','CONDITION','SYSTEM')`,
    ),
    check(
      "ck_incidents_impact",
      sql`${table.initialImpact} in ('FULL_STOP','REDUCED_SPEED','QUALITY_RISK','SAFETY_RISK','NO_IMPACT','UNKNOWN')`,
    ),
  ],
);

export const incidentNotes = sqliteTable(
  "incident_notes",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind").notNull().default("NOTE"),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_incident_notes_incident_created").on(
      table.incidentId,
      table.createdAt,
    ),
    check(
      "ck_incident_notes_kind",
      sql`${table.kind} in ('NOTE','INFO_REQUEST','RESPONSE','TRIAGE_DECISION')`,
    ),
  ],
);

export const incidentEvents = sqliteTable(
  "incident_events",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_incident_events_incident_created").on(
      table.incidentId,
      table.createdAt,
    ),
  ],
);

export const skills = sqliteTable(
  "skills",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_skills_org_code").on(table.organizationId, table.code),
  ],
);

export const certifications = sqliteTable(
  "certifications",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    issuingAuthority: text("issuing_authority").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_certifications_org_code").on(
      table.organizationId,
      table.code,
    ),
  ],
);

export const workforceProfiles = sqliteTable(
  "workforce_profiles",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    shiftCode: text("shift_code").notNull(),
    shiftStart: text("shift_start").notNull(),
    shiftEnd: text("shift_end").notNull(),
    dailyCapacityMinutes: integer("daily_capacity_minutes")
      .notNull()
      .default(480),
    availabilityStatus: text("availability_status")
      .notNull()
      .default("AVAILABLE"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_workforce_site_user").on(table.siteId, table.userId),
    index("idx_workforce_site_availability").on(
      table.siteId,
      table.availabilityStatus,
    ),
    check(
      "ck_workforce_capacity",
      sql`${table.dailyCapacityMinutes} between 1 and 1440`,
    ),
    check(
      "ck_workforce_availability",
      sql`${table.availabilityStatus} in ('AVAILABLE','LIMITED','UNAVAILABLE')`,
    ),
  ],
);

export const technicianSkills = sqliteTable(
  "technician_skills",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    level: integer("level").notNull().default(1),
    verifiedAt: text("verified_at"),
  },
  (table) => [
    uniqueIndex("uq_technician_skill").on(table.userId, table.skillId),
    index("idx_technician_skills_skill").on(table.skillId, table.userId),
    check("ck_technician_skill_level", sql`${table.level} between 1 and 5`),
  ],
);

export const technicianCertifications = sqliteTable(
  "technician_certifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    certificationId: text("certification_id")
      .notNull()
      .references(() => certifications.id, { onDelete: "cascade" }),
    issuedAt: text("issued_at").notNull(),
    expiresAt: text("expires_at"),
    status: text("status").notNull().default("VALID"),
  },
  (table) => [
    uniqueIndex("uq_technician_certification").on(
      table.userId,
      table.certificationId,
    ),
    index("idx_technician_certification_expiry").on(
      table.certificationId,
      table.expiresAt,
    ),
    check(
      "ck_technician_certification_status",
      sql`${table.status} in ('VALID','EXPIRED','SUSPENDED')`,
    ),
  ],
);

export const workforceAvailability = sqliteTable(
  "workforce_availability",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_workforce_availability_user_time").on(
      table.userId,
      table.startsAt,
      table.endsAt,
    ),
    check(
      "ck_workforce_availability_kind",
      sql`${table.kind} in ('LEAVE','TRAINING','UNAVAILABLE','OVERTIME')`,
    ),
  ],
);

export const meters = sqliteTable(
  "meters",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    readingType: text("reading_type").notNull().default("CUMULATIVE"),
    lastValue: real("last_value"),
    lastReadingAt: text("last_reading_at"),
    status: text("status").notNull().default("ACTIVE"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_meters_site_code").on(table.siteId, table.code),
    index("idx_meters_asset_status").on(table.assetId, table.status),
    check(
      "ck_meter_reading_type",
      sql`${table.readingType} in ('CUMULATIVE','GAUGE')`,
    ),
    check("ck_meter_status", sql`${table.status} in ('ACTIVE','INACTIVE')`),
  ],
);

export const meterReadings = sqliteTable(
  "meter_readings",
  {
    id: text("id").primaryKey(),
    meterId: text("meter_id")
      .notNull()
      .references(() => meters.id, { onDelete: "cascade" }),
    recordedById: text("recorded_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    value: real("value").notNull(),
    recordedAt: text("recorded_at").notNull(),
    source: text("source").notNull().default("MANUAL"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_meter_reading_time").on(table.meterId, table.recordedAt),
    index("idx_meter_readings_meter_time").on(table.meterId, table.recordedAt),
    check("ck_meter_reading_value", sql`${table.value} >= 0`),
    check(
      "ck_meter_reading_source",
      sql`${table.source} in ('MANUAL','IMPORT','SYSTEM')`,
    ),
  ],
);

export const maintenancePlans = sqliteTable(
  "maintenance_plans",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    functionalLocationId: text("functional_location_id")
      .notNull()
      .references(() => functionalLocations.id, { onDelete: "restrict" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    meterId: text("meter_id").references(() => meters.id, {
      onDelete: "restrict",
    }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    criticality: text("criticality").notNull(),
    priority: text("priority").notNull().default("P4_NORMAL"),
    estimatedMinutes: integer("estimated_minutes").notNull().default(60),
    triggerMode: text("trigger_mode").notNull(),
    calendarUnit: text("calendar_unit"),
    calendarInterval: integer("calendar_interval"),
    calendarAnchorAt: text("calendar_anchor_at"),
    calendarNextAt: text("calendar_next_at"),
    meterInterval: real("meter_interval"),
    meterThreshold: real("meter_threshold"),
    leadDays: integer("lead_days").notNull().default(7),
    status: text("status").notNull().default("ACTIVE"),
    lastExecutedAt: text("last_executed_at"),
    lastGeneratedAt: text("last_generated_at"),
    nextDueAt: text("next_due_at"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_maintenance_plans_site_code").on(table.siteId, table.code),
    index("idx_maintenance_plans_site_due").on(
      table.siteId,
      table.status,
      table.nextDueAt,
    ),
    index("idx_maintenance_plans_meter").on(table.meterId, table.status),
    check(
      "ck_maintenance_plan_trigger",
      sql`${table.triggerMode} in ('CALENDAR','METER','WHICHEVER_FIRST')`,
    ),
    check(
      "ck_maintenance_plan_calendar_unit",
      sql`${table.calendarUnit} is null or ${table.calendarUnit} in ('DAY','WEEK','MONTH')`,
    ),
    check(
      "ck_maintenance_plan_status",
      sql`${table.status} in ('ACTIVE','INACTIVE')`,
    ),
    check("ck_maintenance_plan_duration", sql`${table.estimatedMinutes} > 0`),
  ],
);

export const maintenancePlanTasks = sqliteTable(
  "maintenance_plan_tasks",
  {
    id: text("id").primaryKey(),
    maintenancePlanId: text("maintenance_plan_id")
      .notNull()
      .references(() => maintenancePlans.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    required: integer("required", { mode: "boolean" }).notNull().default(true),
    responseType: text("response_type").notNull().default("CHECKBOX"),
    unit: text("unit"),
    minimumValue: real("minimum_value"),
    maximumValue: real("maximum_value"),
    meterId: text("meter_id").references(() => meters.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    uniqueIndex("uq_maintenance_plan_task_sequence").on(
      table.maintenancePlanId,
      table.sequence,
    ),
    check(
      "ck_maintenance_plan_task_response_type",
      sql`${table.responseType} in ('CHECKBOX','CONFIRMATION','TEXT','NUMBER','READING','PASS_FAIL')`,
    ),
    check(
      "ck_maintenance_plan_task_range",
      sql`${table.minimumValue} is null or ${table.maximumValue} is null or ${table.maximumValue} >= ${table.minimumValue}`,
    ),
  ],
);

export const maintenancePlanSkills = sqliteTable(
  "maintenance_plan_skills",
  {
    id: text("id").primaryKey(),
    maintenancePlanId: text("maintenance_plan_id")
      .notNull()
      .references(() => maintenancePlans.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "restrict" }),
    minimumLevel: integer("minimum_level").notNull().default(1),
  },
  (table) => [
    uniqueIndex("uq_maintenance_plan_skill").on(
      table.maintenancePlanId,
      table.skillId,
    ),
    check(
      "ck_maintenance_plan_skill_level",
      sql`${table.minimumLevel} between 1 and 5`,
    ),
  ],
);

export const maintenancePlanCertifications = sqliteTable(
  "maintenance_plan_certifications",
  {
    id: text("id").primaryKey(),
    maintenancePlanId: text("maintenance_plan_id")
      .notNull()
      .references(() => maintenancePlans.id, { onDelete: "cascade" }),
    certificationId: text("certification_id")
      .notNull()
      .references(() => certifications.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("uq_maintenance_plan_certification").on(
      table.maintenancePlanId,
      table.certificationId,
    ),
  ],
);

export const failureModes = sqliteTable(
  "failure_modes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    defaultEffect: text("default_effect"),
    status: text("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_failure_modes_org_code").on(
      table.organizationId,
      table.code,
    ),
    index("idx_failure_modes_org_category").on(
      table.organizationId,
      table.category,
    ),
    check(
      "ck_failure_modes_status",
      sql`${table.status} in ('ACTIVE','INACTIVE')`,
    ),
  ],
);

export const workOrders = sqliteTable(
  "work_orders",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    assetId: text("asset_id").references(() => assets.id, {
      onDelete: "restrict",
    }),
    functionalLocationId: text("functional_location_id")
      .notNull()
      .references(() => functionalLocations.id, { onDelete: "restrict" }),
    requestedById: text("requested_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    incidentId: text("incident_id").references(() => incidents.id, {
      onDelete: "restrict",
    }),
    maintenancePlanId: text("maintenance_plan_id").references(
      () => maintenancePlans.id,
      { onDelete: "restrict" },
    ),
    maintenanceWindowKey: text("maintenance_window_key"),
    preventiveDueAt: text("preventive_due_at"),
    failureModeId: text("failure_mode_id").references(() => failureModes.id, {
      onDelete: "restrict",
    }),
    number: text("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull(),
    priority: text("priority").notNull(),
    type: text("type").notNull(),
    source: text("source").notNull(),
    requestedAt: text("requested_at").notNull(),
    dueAt: text("due_at"),
    plannedStart: text("planned_start"),
    plannedEnd: text("planned_end"),
    actualStart: text("actual_start"),
    actualEnd: text("actual_end"),
    completedAt: text("completed_at"),
    closedAt: text("closed_at"),
    cancelledAt: text("cancelled_at"),
    estimatedMinutes: integer("estimated_minutes").notNull().default(60),
    downtimeMinutes: integer("downtime_minutes").notNull().default(0),
    diagnosis: text("diagnosis"),
    solution: text("solution"),
    failureMode: text("failure_mode"),
    failureCause: text("failure_cause"),
    failureEffect: text("failure_effect"),
    productionImpact: text("production_impact").notNull().default("NONE"),
    safetyLevel: text("safety_level").notNull().default("STANDARD"),
    safetySummary: text("safety_summary"),
    ppeRequired: text("ppe_required"),
    precautions: text("precautions"),
    isolationRequired: integer("isolation_required", { mode: "boolean" })
      .notNull()
      .default(false),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_work_orders_org_number").on(
      table.organizationId,
      table.number,
    ),
    uniqueIndex("uq_work_orders_incident").on(table.incidentId),
    uniqueIndex("uq_work_orders_plan_window").on(
      table.maintenancePlanId,
      table.maintenanceWindowKey,
    ),
    index("idx_work_orders_site_status_due").on(
      table.siteId,
      table.status,
      table.dueAt,
    ),
    index("idx_work_orders_asset_created").on(table.assetId, table.createdAt),
    index("idx_work_orders_site_failure_requested").on(
      table.siteId,
      table.failureModeId,
      table.requestedAt,
    ),
    index("idx_work_orders_site_planned").on(table.siteId, table.plannedStart),
    check(
      "ck_work_orders_status",
      sql`${table.status} in ('REQUESTED','TRIAGE','APPROVED','PLANNED','SCHEDULED','ASSIGNED','IN_PROGRESS','PAUSED','WAITING_PART','WAITING_VENDOR','COMPLETED','CLOSED','CANCELLED')`,
    ),
    check(
      "ck_work_orders_priority",
      sql`${table.priority} in ('P1_EMERGENCY','P2_URGENT','P3_HIGH','P4_NORMAL','P5_LOW')`,
    ),
    check(
      "ck_work_orders_type",
      sql`${table.type} in ('CORRECTIVE','PREVENTIVE','INSPECTION','PREDICTIVE','CALIBRATION','IMPROVEMENT')`,
    ),
    check(
      "ck_work_orders_safety_level",
      sql`${table.safetyLevel} in ('STANDARD','CAUTION','CRITICAL')`,
    ),
  ],
);

export const workOrderTasks = sqliteTable(
  "work_order_tasks",
  {
    id: text("id").primaryKey(),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    sourceTaskId: text("source_task_id").references(
      () => maintenancePlanTasks.id,
      { onDelete: "restrict" },
    ),
    sequence: integer("sequence").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    required: integer("required", { mode: "boolean" }).notNull().default(true),
    responseType: text("response_type").notNull().default("CHECKBOX"),
    unit: text("unit"),
    minimumValue: real("minimum_value"),
    maximumValue: real("maximum_value"),
    meterId: text("meter_id").references(() => meters.id, {
      onDelete: "restrict",
    }),
    responseValue: text("response_value"),
    responseStatus: text("response_status").notNull().default("PENDING"),
    respondedAt: text("responded_at"),
    respondedById: text("responded_by_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    completedAt: text("completed_at"),
    completedById: text("completed_by_id").references(() => users.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    uniqueIndex("uq_work_order_task_sequence").on(
      table.workOrderId,
      table.sequence,
    ),
    index("idx_work_order_tasks_order").on(table.workOrderId),
    index("idx_work_order_tasks_meter").on(table.meterId),
    check(
      "ck_work_order_task_response_type",
      sql`${table.responseType} in ('CHECKBOX','CONFIRMATION','TEXT','NUMBER','READING','PASS_FAIL')`,
    ),
    check(
      "ck_work_order_task_response_status",
      sql`${table.responseStatus} in ('PENDING','COMPLETED','PASS','FAIL')`,
    ),
    check(
      "ck_work_order_task_range",
      sql`${table.minimumValue} is null or ${table.maximumValue} is null or ${table.maximumValue} >= ${table.minimumValue}`,
    ),
  ],
);

export const workOrderSafetyAcknowledgements = sqliteTable(
  "work_order_safety_acknowledgements",
  {
    id: text("id").primaryKey(),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    acknowledgedAt: text("acknowledged_at").notNull(),
    safetySnapshot: text("safety_snapshot").notNull(),
  },
  (table) => [
    uniqueIndex("uq_work_order_safety_user").on(
      table.workOrderId,
      table.userId,
    ),
  ],
);

export const workOrderMeasurements = sqliteTable(
  "work_order_measurements",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => workOrderTasks.id, {
      onDelete: "restrict",
    }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    meterId: text("meter_id").references(() => meters.id, {
      onDelete: "restrict",
    }),
    meterReadingId: text("meter_reading_id").references(
      () => meterReadings.id,
      { onDelete: "restrict" },
    ),
    label: text("label").notNull(),
    unit: text("unit").notNull(),
    value: real("value").notNull(),
    minimumValue: real("minimum_value"),
    maximumValue: real("maximum_value"),
    result: text("result").notNull(),
    note: text("note"),
    recordedById: text("recorded_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    recordedAt: text("recorded_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_work_order_measurements_order_time").on(
      table.workOrderId,
      table.recordedAt,
    ),
    index("idx_work_order_measurements_meter_time").on(
      table.meterId,
      table.recordedAt,
    ),
    check(
      "ck_work_order_measurement_result",
      sql`${table.result} in ('IN_RANGE','OUT_OF_RANGE','INFORMATIONAL')`,
    ),
    check(
      "ck_work_order_measurement_range",
      sql`${table.minimumValue} is null or ${table.maximumValue} is null or ${table.maximumValue} >= ${table.minimumValue}`,
    ),
  ],
);

export const shiftHandovers = sqliteTable(
  "shift_handovers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    fromShift: text("from_shift").notNull(),
    toShift: text("to_shift").notNull(),
    summary: text("summary").notNull(),
    risks: text("risks"),
    partsPending: text("parts_pending"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_shift_handovers_site_created").on(table.siteId, table.createdAt),
  ],
);

export const shiftHandoverWorkOrders = sqliteTable(
  "shift_handover_work_orders",
  {
    id: text("id").primaryKey(),
    handoverId: text("handover_id")
      .notNull()
      .references(() => shiftHandovers.id, { onDelete: "cascade" }),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "restrict" }),
    statusSnapshot: text("status_snapshot").notNull(),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_shift_handover_work_order").on(
      table.handoverId,
      table.workOrderId,
    ),
  ],
);

export const workOrderSkillRequirements = sqliteTable(
  "work_order_skill_requirements",
  {
    id: text("id").primaryKey(),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "restrict" }),
    minimumLevel: integer("minimum_level").notNull().default(1),
  },
  (table) => [
    uniqueIndex("uq_work_order_skill").on(table.workOrderId, table.skillId),
  ],
);

export const workOrderCertificationRequirements = sqliteTable(
  "work_order_certification_requirements",
  {
    id: text("id").primaryKey(),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    certificationId: text("certification_id")
      .notNull()
      .references(() => certifications.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("uq_work_order_certification").on(
      table.workOrderId,
      table.certificationId,
    ),
  ],
);

export const workOrderAssignments = sqliteTable(
  "work_order_assignments",
  {
    id: text("id").primaryKey(),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    assignmentRole: text("assignment_role").notNull().default("LEAD"),
    assignedAt: text("assigned_at").notNull(),
    unassignedAt: text("unassigned_at"),
  },
  (table) => [
    uniqueIndex("uq_work_order_assignments").on(
      table.workOrderId,
      table.userId,
    ),
    index("idx_assignments_user_active").on(table.userId, table.unassignedAt),
  ],
);

export const workOrderEvents = sqliteTable(
  "work_order_events",
  {
    id: text("id").primaryKey(),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_work_order_events_order_created").on(
      table.workOrderId,
      table.createdAt,
    ),
  ],
);

export const laborSessions = sqliteTable(
  "labor_sessions",
  {
    id: text("id").primaryKey(),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    minutes: integer("minutes").notNull().default(0),
    status: text("status").notNull().default("ACTIVE"),
    endedById: text("ended_by_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    note: text("note"),
    hourlyRateCentsSnapshot: integer("hourly_rate_cents_snapshot"),
    laborCostCents: integer("labor_cost_cents"),
    currencySnapshot: text("currency_snapshot"),
  },
  (table) => [
    index("idx_labor_work_order").on(table.workOrderId),
    index("idx_labor_user_active").on(table.userId, table.endedAt),
    uniqueIndex("uq_labor_one_active_user")
      .on(table.userId)
      .where(sql`${table.endedAt} is null`),
    check("ck_labor_minutes", sql`${table.minutes} >= 0`),
    check(
      "ck_labor_status",
      sql`${table.status} in ('ACTIVE','PAUSED','STOPPED')`,
    ),
    check(
      "ck_labor_costs",
      sql`(${table.hourlyRateCentsSnapshot} is null or ${table.hourlyRateCentsSnapshot} >= 0) and (${table.laborCostCents} is null or ${table.laborCostCents} >= 0)`,
    ),
  ],
);

export const downtimeEvents = sqliteTable(
  "downtime_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    workOrderId: text("work_order_id").references(() => workOrders.id, {
      onDelete: "restrict",
    }),
    functionalLocationId: text("functional_location_id").references(
      () => functionalLocations.id,
      { onDelete: "restrict" },
    ),
    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    endedById: text("ended_by_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    durationMinutes: integer("duration_minutes").notNull(),
    kind: text("kind").notNull(),
    productionImpact: text("production_impact").notNull(),
    cause: text("cause"),
    ...timestamps,
  },
  (table) => [
    index("idx_downtime_site_started").on(table.siteId, table.startedAt),
    index("idx_downtime_asset_started").on(table.assetId, table.startedAt),
    uniqueIndex("uq_downtime_one_active_order")
      .on(table.workOrderId)
      .where(
        sql`${table.endedAt} is null and ${table.workOrderId} is not null`,
      ),
    check("ck_downtime_duration", sql`${table.durationMinutes} >= 0`),
  ],
);

export const partCategories = sqliteTable(
  "part_categories",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    parentId: text("parent_id").references(
      (): AnySQLiteColumn => partCategories.id,
      { onDelete: "restrict" },
    ),
    code: text("code").notNull(),
    name: text("name").notNull(),
  },
  (table) => [
    uniqueIndex("uq_part_categories_org_code").on(
      table.organizationId,
      table.code,
    ),
  ],
);

export const parts = sqliteTable(
  "parts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => partCategories.id, { onDelete: "restrict" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    unit: text("unit").notNull(),
    manufacturer: text("manufacturer"),
    manufacturerRef: text("manufacturer_ref"),
    standardCost: real("standard_cost").notNull(),
    currency: text("currency").notNull().default("EUR"),
    status: text("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_parts_org_sku").on(table.organizationId, table.sku),
    index("idx_parts_category").on(table.categoryId),
  ],
);

export const partVendorOffers = sqliteTable(
  "part_vendor_offers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    vendorId: text("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "restrict" }),
    vendorSku: text("vendor_sku").notNull(),
    manufacturer: text("manufacturer"),
    unitPrice: real("unit_price").notNull(),
    currency: text("currency").notNull().default("EUR"),
    minimumOrderQuantity: real("minimum_order_quantity").notNull().default(1),
    leadTimeDays: integer("lead_time_days").notNull(),
    preferred: integer("preferred", { mode: "boolean" })
      .notNull()
      .default(false),
    priceAt: text("price_at").notNull(),
    validUntil: text("valid_until"),
    status: text("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_part_vendor_offer_reference").on(
      table.partId,
      table.vendorId,
      table.vendorSku,
      table.priceAt,
    ),
    index("idx_part_vendor_offer_part_status").on(table.partId, table.status),
    check("ck_part_vendor_offer_price", sql`${table.unitPrice} >= 0`),
    check("ck_part_vendor_offer_moq", sql`${table.minimumOrderQuantity} > 0`),
    check("ck_part_vendor_offer_lead", sql`${table.leadTimeDays} >= 0`),
    check(
      "ck_part_vendor_offer_status",
      sql`${table.status} in ('ACTIVE','INACTIVE')`,
    ),
  ],
);

export const partSubstitutes = sqliteTable(
  "part_substitutes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    substitutePartId: text("substitute_part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    approvalStatus: text("approval_status").notNull().default("APPROVED"),
    note: text("note"),
    approvedById: text("approved_by_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    approvedAt: text("approved_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_part_substitute").on(table.partId, table.substitutePartId),
    check(
      "ck_part_substitute_distinct",
      sql`${table.partId} <> ${table.substitutePartId}`,
    ),
    check(
      "ck_part_substitute_status",
      sql`${table.approvalStatus} in ('APPROVED','PENDING','REJECTED')`,
    ),
  ],
);

export const maintenancePlanMaterials = sqliteTable(
  "maintenance_plan_materials",
  {
    id: text("id").primaryKey(),
    maintenancePlanId: text("maintenance_plan_id")
      .notNull()
      .references(() => maintenancePlans.id, { onDelete: "cascade" }),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    quantity: real("quantity").notNull(),
  },
  (table) => [
    uniqueIndex("uq_maintenance_plan_material").on(
      table.maintenancePlanId,
      table.partId,
    ),
    check("ck_maintenance_plan_material_quantity", sql`${table.quantity} > 0`),
  ],
);

export const warehouses = sqliteTable(
  "warehouses",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_warehouses_site_code").on(table.siteId, table.code),
  ],
);

export const membershipWarehouseScopes = sqliteTable(
  "membership_warehouse_scopes",
  {
    id: text("id").primaryKey(),
    membershipSiteScopeId: text("membership_site_scope_id")
      .notNull()
      .references(() => membershipSiteScopes.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_membership_warehouse_scope").on(
      table.membershipSiteScopeId,
      table.warehouseId,
    ),
  ],
);

export const warehouseZones = sqliteTable(
  "warehouse_zones",
  {
    id: text("id").primaryKey(),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("ACTIVE"),
  },
  (table) => [
    uniqueIndex("uq_warehouse_zone_code").on(table.warehouseId, table.code),
  ],
);

export const warehouseBins = sqliteTable(
  "warehouse_bins",
  {
    id: text("id").primaryKey(),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    zoneId: text("zone_id").references(() => warehouseZones.id, {
      onDelete: "restrict",
    }),
    code: text("code").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("ACTIVE"),
  },
  (table) => [
    uniqueIndex("uq_bins_warehouse_code").on(table.warehouseId, table.code),
  ],
);

export const partSitePolicies = sqliteTable(
  "part_site_policies",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    primaryVendorId: text("primary_vendor_id").references(() => vendors.id, {
      onDelete: "restrict",
    }),
    critical: integer("critical", { mode: "boolean" }).notNull().default(false),
    minStock: real("min_stock").notNull(),
    maxStock: real("max_stock").notNull(),
    reorderPoint: real("reorder_point").notNull(),
    leadTimeDays: integer("lead_time_days").notNull(),
    averageCost: real("average_cost").notNull(),
  },
  (table) => [
    uniqueIndex("uq_part_site_policy").on(table.partId, table.siteId),
    index("idx_part_site_policy_site_critical").on(
      table.siteId,
      table.critical,
    ),
  ],
);

export const stockLevels = sqliteTable(
  "stock_levels",
  {
    id: text("id").primaryKey(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    binId: text("bin_id")
      .notNull()
      .references(() => warehouseBins.id, { onDelete: "restrict" }),
    onHand: real("on_hand").notNull().default(0),
    reserved: real("reserved").notNull().default(0),
    onOrder: real("on_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_stock_part_bin").on(table.partId, table.binId),
    index("idx_stock_site_part").on(table.siteId, table.partId),
    check(
      "ck_stock_nonnegative",
      sql`${table.onHand} >= 0 and ${table.reserved} >= 0 and ${table.onOrder} >= 0 and ${table.reserved} <= ${table.onHand}`,
    ),
  ],
);

export const purchaseRequisitions = sqliteTable(
  "purchase_requisitions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    workOrderId: text("work_order_id").references(() => workOrders.id, {
      onDelete: "restrict",
    }),
    number: text("number").notNull(),
    origin: text("origin").notNull(),
    urgency: text("urgency").notNull().default("ROUTINE"),
    needBy: text("need_by"),
    justification: text("justification").notNull(),
    status: text("status").notNull().default("DRAFT"),
    requestedById: text("requested_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedById: text("approved_by_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    approvedAt: text("approved_at"),
    decisionReason: text("decision_reason"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_purchase_requisition_org_number").on(
      table.organizationId,
      table.number,
    ),
    index("idx_purchase_requisition_site_status").on(
      table.siteId,
      table.status,
      table.needBy,
    ),
    index("idx_purchase_requisition_work_order").on(table.workOrderId),
    check(
      "ck_purchase_requisition_origin",
      sql`${table.origin} in ('WORK_ORDER','LOW_STOCK','STOCKOUT','MANUAL','PLANNING')`,
    ),
    check(
      "ck_purchase_requisition_urgency",
      sql`${table.urgency} in ('ROUTINE','HIGH','CRITICAL')`,
    ),
    check(
      "ck_purchase_requisition_status",
      sql`${table.status} in ('DRAFT','SUBMITTED','APPROVED','REJECTED','CONVERTED','CANCELLED')`,
    ),
  ],
);

export const purchaseRequisitionLines = sqliteTable(
  "purchase_requisition_lines",
  {
    id: text("id").primaryKey(),
    purchaseRequisitionId: text("purchase_requisition_id")
      .notNull()
      .references(() => purchaseRequisitions.id, { onDelete: "cascade" }),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    quantity: real("quantity").notNull(),
    availableSnapshot: real("available_snapshot").notNull(),
    onOrderSnapshot: real("on_order_snapshot").notNull(),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_purchase_requisition_line_part").on(
      table.purchaseRequisitionId,
      table.partId,
    ),
    check("ck_purchase_requisition_line_quantity", sql`${table.quantity} > 0`),
  ],
);

export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    requisitionId: text("requisition_id")
      .notNull()
      .references(() => purchaseRequisitions.id, { onDelete: "restrict" }),
    vendorId: text("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "restrict" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    destinationBinId: text("destination_bin_id")
      .notNull()
      .references(() => warehouseBins.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    status: text("status").notNull().default("DRAFT"),
    currency: text("currency").notNull().default("EUR"),
    orderedAt: text("ordered_at"),
    expectedAt: text("expected_at"),
    sentAt: text("sent_at"),
    receivedAt: text("received_at"),
    cancelledAt: text("cancelled_at"),
    subtotal: real("subtotal").notNull(),
    taxRate: real("tax_rate").notNull().default(21),
    taxAmount: real("tax_amount").notNull(),
    total: real("total").notNull(),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedById: text("approved_by_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_purchase_order_org_number").on(
      table.organizationId,
      table.number,
    ),
    uniqueIndex("uq_purchase_order_requisition").on(table.requisitionId),
    index("idx_purchase_order_site_status_expected").on(
      table.siteId,
      table.status,
      table.expectedAt,
    ),
    check(
      "ck_purchase_order_status",
      sql`${table.status} in ('DRAFT','APPROVED','SENT','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')`,
    ),
    check(
      "ck_purchase_order_totals",
      sql`${table.subtotal} >= 0 and ${table.taxRate} >= 0 and ${table.taxAmount} >= 0 and ${table.total} >= 0`,
    ),
  ],
);

export const purchaseOrderLines = sqliteTable(
  "purchase_order_lines",
  {
    id: text("id").primaryKey(),
    purchaseOrderId: text("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    vendorOfferId: text("vendor_offer_id").references(
      () => partVendorOffers.id,
      { onDelete: "restrict" },
    ),
    vendorSkuSnapshot: text("vendor_sku_snapshot").notNull(),
    descriptionSnapshot: text("description_snapshot").notNull(),
    orderedQuantity: real("ordered_quantity").notNull(),
    receivedQuantity: real("received_quantity").notNull().default(0),
    unitPriceSnapshot: real("unit_price_snapshot").notNull(),
    lineTotal: real("line_total").notNull(),
  },
  (table) => [
    uniqueIndex("uq_purchase_order_line_part").on(
      table.purchaseOrderId,
      table.partId,
    ),
    check(
      "ck_purchase_order_line_quantities",
      sql`${table.orderedQuantity} > 0 and ${table.receivedQuantity} >= 0 and ${table.receivedQuantity} <= ${table.orderedQuantity}`,
    ),
    check(
      "ck_purchase_order_line_cost",
      sql`${table.unitPriceSnapshot} >= 0 and ${table.lineTotal} >= 0`,
    ),
  ],
);

export const goodsReceipts = sqliteTable(
  "goods_receipts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    purchaseOrderId: text("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "restrict" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    externalReference: text("external_reference"),
    receivedById: text("received_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    receivedAt: text("received_at").notNull(),
    status: text("status").notNull().default("POSTED"),
    totalCost: real("total_cost").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_goods_receipt_org_number").on(
      table.organizationId,
      table.number,
    ),
    uniqueIndex("uq_goods_receipt_idempotency").on(
      table.organizationId,
      table.siteId,
      table.idempotencyKey,
    ),
    index("idx_goods_receipt_order_received").on(
      table.purchaseOrderId,
      table.receivedAt,
    ),
  ],
);

export const goodsReceiptLines = sqliteTable(
  "goods_receipt_lines",
  {
    id: text("id").primaryKey(),
    goodsReceiptId: text("goods_receipt_id")
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: "cascade" }),
    purchaseOrderLineId: text("purchase_order_line_id")
      .notNull()
      .references(() => purchaseOrderLines.id, { onDelete: "restrict" }),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    binId: text("bin_id")
      .notNull()
      .references(() => warehouseBins.id, { onDelete: "restrict" }),
    quantity: real("quantity").notNull(),
    unitCostSnapshot: real("unit_cost_snapshot").notNull(),
    totalCost: real("total_cost").notNull(),
  },
  (table) => [
    uniqueIndex("uq_goods_receipt_line_order_line").on(
      table.goodsReceiptId,
      table.purchaseOrderLineId,
    ),
    check("ck_goods_receipt_line_quantity", sql`${table.quantity} > 0`),
    check(
      "ck_goods_receipt_line_cost",
      sql`${table.unitCostSnapshot} >= 0 and ${table.totalCost} >= 0`,
    ),
  ],
);

export const stockTransfers = sqliteTable(
  "stock_transfers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    fromWarehouseId: text("from_warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    toWarehouseId: text("to_warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    requestedById: text("requested_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("CREATED"),
    note: text("note"),
    shippedAt: text("shipped_at"),
    receivedAt: text("received_at"),
    cancelledAt: text("cancelled_at"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_stock_transfer_org_number").on(
      table.organizationId,
      table.number,
    ),
    index("idx_stock_transfer_site_status").on(table.siteId, table.status),
    check(
      "ck_stock_transfer_status",
      sql`${table.status} in ('CREATED','IN_TRANSIT','RECEIVED','CANCELLED')`,
    ),
  ],
);

export const stockTransferLines = sqliteTable(
  "stock_transfer_lines",
  {
    id: text("id").primaryKey(),
    stockTransferId: text("stock_transfer_id")
      .notNull()
      .references(() => stockTransfers.id, { onDelete: "cascade" }),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    fromBinId: text("from_bin_id")
      .notNull()
      .references(() => warehouseBins.id, { onDelete: "restrict" }),
    toBinId: text("to_bin_id")
      .notNull()
      .references(() => warehouseBins.id, { onDelete: "restrict" }),
    quantity: real("quantity").notNull(),
    unitCostSnapshot: real("unit_cost_snapshot").notNull(),
  },
  (table) => [
    uniqueIndex("uq_stock_transfer_line").on(
      table.stockTransferId,
      table.partId,
      table.fromBinId,
      table.toBinId,
    ),
    check("ck_stock_transfer_line_quantity", sql`${table.quantity} > 0`),
    check(
      "ck_stock_transfer_line_bins",
      sql`${table.fromBinId} <> ${table.toBinId}`,
    ),
  ],
);

export const procurementEvents = sqliteTable(
  "procurement_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_procurement_event_entity_created").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    index("idx_procurement_event_site_created").on(
      table.siteId,
      table.createdAt,
    ),
  ],
);

export const inventoryMovements = sqliteTable(
  "inventory_movements",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    binId: text("bin_id")
      .notNull()
      .references(() => warehouseBins.id, { onDelete: "restrict" }),
    workOrderId: text("work_order_id").references(() => workOrders.id, {
      onDelete: "restrict",
    }),
    purchaseOrderId: text("purchase_order_id").references(
      () => purchaseOrders.id,
      { onDelete: "restrict" },
    ),
    goodsReceiptId: text("goods_receipt_id").references(
      () => goodsReceipts.id,
      { onDelete: "restrict" },
    ),
    stockTransferId: text("stock_transfer_id").references(
      () => stockTransfers.id,
      { onDelete: "restrict" },
    ),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    movementType: text("movement_type").notNull(),
    reference: text("reference").notNull(),
    reason: text("reason").notNull(),
    deltaOnHand: real("delta_on_hand").notNull().default(0),
    deltaReserved: real("delta_reserved").notNull().default(0),
    deltaOnOrder: real("delta_on_order").notNull().default(0),
    unitCost: real("unit_cost").notNull(),
    occurredAt: text("occurred_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_movements_part_occurred").on(table.partId, table.occurredAt),
    index("idx_movements_work_order").on(table.workOrderId),
    index("idx_movements_purchase_order").on(table.purchaseOrderId),
    index("idx_movements_receipt").on(table.goodsReceiptId),
    index("idx_movements_transfer").on(table.stockTransferId),
    check(
      "ck_movement_type",
      sql`${table.movementType} in ('RECEIPT','ISSUE','RESERVE','RELEASE','TRANSFER','ADJUSTMENT','RETURN','ORDER','CONSUMPTION')`,
    ),
  ],
);

export const assetPartCompatibilities = sqliteTable(
  "asset_part_compatibilities",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    relation: text("relation").notNull().default("COMPATIBLE"),
    recommendedQuantity: real("recommended_quantity").notNull().default(1),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_asset_part_compatibility").on(table.assetId, table.partId),
  ],
);

export const workOrderPartUsages = sqliteTable(
  "work_order_part_usages",
  {
    id: text("id").primaryKey(),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "restrict" }),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    movementId: text("movement_id")
      .notNull()
      .references(() => inventoryMovements.id, { onDelete: "restrict" }),
    usageType: text("usage_type").notNull().default("CONSUMPTION"),
    quantity: real("quantity").notNull(),
    unitCostSnapshot: real("unit_cost_snapshot").notNull(),
    totalCost: real("total_cost").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_part_usage_work_order").on(table.workOrderId),
    check(
      "ck_part_usage_type",
      sql`${table.usageType} in ('CONSUMPTION','RETURN')`,
    ),
  ],
);

export const workOrderMaterials = sqliteTable(
  "work_order_materials",
  {
    id: text("id").primaryKey(),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "restrict" }),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    binId: text("bin_id")
      .notNull()
      .references(() => warehouseBins.id, { onDelete: "restrict" }),
    plannedQuantity: real("planned_quantity").notNull().default(0),
    reservedQuantity: real("reserved_quantity").notNull().default(0),
    consumedQuantity: real("consumed_quantity").notNull().default(0),
    returnedQuantity: real("returned_quantity").notNull().default(0),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_work_order_material_part_bin").on(
      table.workOrderId,
      table.partId,
      table.binId,
    ),
    index("idx_work_order_materials_order").on(table.workOrderId),
    check(
      "ck_work_order_material_quantities",
      sql`${table.plannedQuantity} >= 0 and ${table.reservedQuantity} >= 0 and ${table.consumedQuantity} >= 0 and ${table.returnedQuantity} >= 0 and ${table.returnedQuantity} <= ${table.consumedQuantity}`,
    ),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    siteId: text("site_id").references(() => sites.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    severity: text("severity").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_notifications_user_site_read").on(
      table.userId,
      table.siteId,
      table.readAt,
    ),
  ],
);

export const auditEntries = sqliteTable(
  "audit_entries",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id").references(() => sites.id, {
      onDelete: "restrict",
    }),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    previousValue: text("previous_value"),
    newValue: text("new_value"),
    requestId: text("request_id"),
    contextJson: text("context_json"),
    outcome: text("outcome").notNull().default("SUCCESS"),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_audit_entity_created").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    index("idx_audit_org_created").on(table.organizationId, table.createdAt),
    index("idx_audit_site_action_created").on(
      table.siteId,
      table.action,
      table.createdAt,
    ),
  ],
);

export const workOrderCostItems = sqliteTable(
  "work_order_cost_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("EUR"),
    vendorId: text("vendor_id").references(() => vendors.id, {
      onDelete: "restrict",
    }),
    recordedById: text("recorded_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [
    index("idx_work_order_cost_items_order").on(
      table.workOrderId,
      table.recordedAt,
    ),
    check("ck_work_order_cost_item_amount", sql`${table.amountCents} >= 0`),
  ],
);

export const authenticationPolicies = sqliteTable(
  "authentication_policies",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sessionHours: integer("session_hours").notNull().default(12),
    idleMinutes: integer("idle_minutes").notNull().default(120),
    absoluteHours: integer("absolute_hours").notNull().default(24),
    rotationMinutes: integer("rotation_minutes").notNull().default(60),
    maxFailedAttempts: integer("max_failed_attempts").notNull().default(5),
    lockoutMinutes: integer("lockout_minutes").notNull().default(15),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "ck_auth_session_hours",
      sql`${table.sessionHours} between 1 and 168`,
    ),
    check("ck_auth_idle_minutes", sql`${table.idleMinutes} between 5 and 1440`),
    check(
      "ck_auth_absolute_hours",
      sql`${table.absoluteHours} between 1 and 720`,
    ),
    check(
      "ck_auth_rotation_minutes",
      sql`${table.rotationMinutes} between 5 and 1440`,
    ),
    check(
      "ck_auth_failed_attempts",
      sql`${table.maxFailedAttempts} between 2 and 20`,
    ),
  ],
);

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    normalizedEmail: text("normalized_email").notNull(),
    succeeded: integer("succeeded", { mode: "boolean" }).notNull(),
    failureReason: text("failure_reason"),
    requestId: text("request_id").notNull(),
    attemptedAt: text("attempted_at").notNull(),
  },
  (table) => [
    index("idx_login_attempts_email_time").on(
      table.normalizedEmail,
      table.attemptedAt,
    ),
  ],
);

export const savedViews = sqliteTable(
  "saved_views",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    siteId: text("site_id").references(() => sites.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    name: text("name").notNull(),
    filtersJson: text("filters_json").notNull(),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_saved_views_user_resource_name").on(
      table.userId,
      table.resource,
      table.name,
    ),
  ],
);

export const operationIdempotency = sqliteTable(
  "operation_idempotency",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    operation: text("operation").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    responseJson: text("response_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_operation_idempotency_scope_key").on(
      table.organizationId,
      table.actorId,
      table.idempotencyKey,
    ),
  ],
);

export const requestActivity = sqliteTable(
  "request_activity",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    siteId: text("site_id").references(() => sites.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    outcome: text("outcome").notNull(),
    errorClassification: text("error_classification"),
    durationMs: integer("duration_ms"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_request_activity_request").on(table.requestId),
    index("idx_request_activity_scope_created").on(
      table.siteId,
      table.createdAt,
    ),
  ],
);

export const rootCauseAnalyses = sqliteTable(
  "root_cause_analyses",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    sourceWorkOrderId: text("source_work_order_id").references(
      () => workOrders.id,
      { onDelete: "restrict" },
    ),
    failureModeId: text("failure_mode_id").references(() => failureModes.id, {
      onDelete: "restrict",
    }),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    problem: text("problem").notNull(),
    impact: text("impact").notNull(),
    immediateCause: text("immediate_cause"),
    rootCause: text("root_cause"),
    status: text("status").notNull().default("DRAFT"),
    targetAt: text("target_at"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_rca_org_number").on(table.organizationId, table.number),
    index("idx_rca_site_status_target").on(
      table.siteId,
      table.status,
      table.targetAt,
    ),
    index("idx_rca_asset_created").on(table.assetId, table.createdAt),
    check(
      "ck_rca_status",
      sql`${table.status} in ('DRAFT','INVESTIGATING','ACTIONS_DEFINED','VERIFICATION','CLOSED','CANCELLED')`,
    ),
  ],
);

export const rcaEvidence = sqliteTable(
  "rca_evidence",
  {
    id: text("id").primaryKey(),
    rootCauseAnalysisId: text("root_cause_analysis_id")
      .notNull()
      .references(() => rootCauseAnalyses.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("OBSERVATION"),
    description: text("description").notNull(),
    sourceReference: text("source_reference"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_rca_evidence_rca_created").on(
      table.rootCauseAnalysisId,
      table.createdAt,
    ),
    check(
      "ck_rca_evidence_kind",
      sql`${table.kind} in ('OBSERVATION','MEASUREMENT','DOCUMENT','PHOTO','WORK_ORDER')`,
    ),
  ],
);

export const rcaWhys = sqliteTable(
  "rca_whys",
  {
    id: text("id").primaryKey(),
    rootCauseAnalysisId: text("root_cause_analysis_id")
      .notNull()
      .references(() => rootCauseAnalyses.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
  },
  (table) => [
    uniqueIndex("uq_rca_why_sequence").on(
      table.rootCauseAnalysisId,
      table.sequence,
    ),
    check("ck_rca_why_sequence", sql`${table.sequence} between 1 and 5`),
  ],
);

export const rcaActions = sqliteTable(
  "rca_actions",
  {
    id: text("id").primaryKey(),
    rootCauseAnalysisId: text("root_cause_analysis_id")
      .notNull()
      .references(() => rootCauseAnalyses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    actionType: text("action_type").notNull(),
    status: text("status").notNull().default("OPEN"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    targetAt: text("target_at"),
    linkedWorkOrderId: text("linked_work_order_id").references(
      () => workOrders.id,
      { onDelete: "restrict" },
    ),
    linkedMaintenancePlanId: text("linked_maintenance_plan_id").references(
      () => maintenancePlans.id,
      { onDelete: "restrict" },
    ),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_rca_actions_rca_status").on(
      table.rootCauseAnalysisId,
      table.status,
    ),
    check(
      "ck_rca_action_type",
      sql`${table.actionType} in ('CREATE_WORK_ORDER','UPDATE_MAINTENANCE_PLAN','INSPECTION','TRAINING','TECHNICAL_CHANGE')`,
    ),
    check(
      "ck_rca_action_status",
      sql`${table.status} in ('OPEN','IN_PROGRESS','DONE','CANCELLED')`,
    ),
  ],
);

export const rcaEvents = sqliteTable(
  "rca_events",
  {
    id: text("id").primaryKey(),
    rootCauseAnalysisId: text("root_cause_analysis_id")
      .notNull()
      .references(() => rootCauseAnalyses.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_rca_events_rca_created").on(
      table.rootCauseAnalysisId,
      table.createdAt,
    ),
  ],
);

export const evidenceItems = sqliteTable(
  "evidence_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    workOrderId: text("work_order_id").references(() => workOrders.id, {
      onDelete: "cascade",
    }),
    incidentId: text("incident_id").references(() => incidents.id, {
      onDelete: "cascade",
    }),
    assetId: text("asset_id").references(() => assets.id, {
      onDelete: "restrict",
    }),
    rootCauseAnalysisId: text("root_cause_analysis_id").references(
      () => rootCauseAnalyses.id,
      { onDelete: "cascade" },
    ),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    stage: text("stage").notNull().default("GENERAL"),
    description: text("description").notNull(),
    storageProvider: text("storage_provider").notNull().default("NONE"),
    storageKey: text("storage_key"),
    fileName: text("file_name"),
    safeFileName: text("safe_file_name"),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes"),
    checksumSha256: text("checksum_sha256"),
    retentionUntil: text("retention_until"),
    scanStatus: text("scan_status").notNull().default("NOT_CONFIGURED"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_evidence_work_order_created").on(
      table.workOrderId,
      table.createdAt,
    ),
    index("idx_evidence_asset_created").on(table.assetId, table.createdAt),
    index("idx_evidence_incident_created").on(
      table.incidentId,
      table.createdAt,
    ),
    index("idx_evidence_rca_created").on(
      table.rootCauseAnalysisId,
      table.createdAt,
    ),
    index("idx_evidence_scope_created").on(
      table.organizationId,
      table.siteId,
      table.createdAt,
    ),
    check(
      "ck_evidence_kind",
      sql`${table.kind} in ('PHOTO','DOCUMENT','NOTE')`,
    ),
    check(
      "ck_evidence_stage",
      sql`${table.stage} in ('BEFORE','DURING','AFTER','GENERAL')`,
    ),
    check(
      "ck_evidence_provider",
      sql`${table.storageProvider} in ('NONE','R2')`,
    ),
    check(
      "ck_evidence_entity",
      sql`${table.workOrderId} is not null or ${table.incidentId} is not null or ${table.assetId} is not null or ${table.rootCauseAnalysisId} is not null`,
    ),
    check(
      "ck_evidence_file_metadata",
      sql`(${table.kind} = 'NOTE' and ${table.storageKey} is null) or (${table.kind} <> 'NOTE' and ${table.storageProvider} = 'R2' and ${table.storageKey} is not null and ${table.sizeBytes} > 0)`,
    ),
  ],
);

export type Asset = typeof assets.$inferSelect;
// Empty by design: failed CAS assertions violate this constraint and roll back
// the entire D1 batch. Never use this table as application state.
export const mutationAssertions = sqliteTable(
  "_mutation_assertions",
  {
    affectedRows: integer("affected_rows").notNull(),
  },
  (table) => [
    check("ck_atomic_mutation_applied", sql`${table.affectedRows} = 1`),
  ],
);
export type WorkOrder = typeof workOrders.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type Part = typeof parts.$inferSelect;
export type User = typeof users.$inferSelect;
export type MaintenancePlan = typeof maintenancePlans.$inferSelect;
export type Meter = typeof meters.$inferSelect;
export type FailureMode = typeof failureModes.$inferSelect;
export type RootCauseAnalysis = typeof rootCauseAnalyses.$inferSelect;
