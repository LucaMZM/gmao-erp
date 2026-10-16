import foundationMigration from "@/drizzle/0000_ancient_greymalkin.sql?raw";
import notificationScopeMigration from "@/drizzle/0001_purple_the_initiative.sql?raw";
import maintenanceOperationsMigration from "@/drizzle/0002_zippy_lockheed.sql?raw";
import materialHistoryMigration from "@/drizzle/0003_careful_forge.sql?raw";
import preventivePlanningMigration from "@/drizzle/0004_free_patch.sql?raw";
import reliabilityMigration from "@/drizzle/0005_magenta_vindicator.sql?raw";
import procurementMigration from "@/drizzle/0006_peaceful_reptil.sql?raw";
import fieldOperationsMigration from "@/drizzle/0007_luxuriant_ender_wiggin.sql?raw";
import enterpriseGovernanceMigration from "@/drizzle/0008_enterprise_governance.sql?raw";
import enterpriseAuditGuardrailsMigration from "@/drizzle/0009_enterprise_audit_guardrails.sql?raw";
import atomicMutationAssertionsMigration from "@/drizzle/0010_atomic_mutation_assertions.sql?raw";
import pilotImportJobsMigration from "@/drizzle/0011_pilot_import_jobs.sql?raw";
import healthProjectionMigration from "@/drizzle/0012_health_projection.sql?raw";
import preventiveSchedulerMigration from "@/drizzle/0013_preventive_scheduler.sql?raw";
import { getD1 } from "@/db";
import { seedDemoDatabase } from "@/db/seed";
import { seedV1BDatabase } from "@/db/seed-v1b";
import { seedV1CDatabase } from "@/db/seed-v1c";
import { seedV1DDatabase } from "@/db/seed-v1d";
import { seedV2ADatabase } from "@/db/seed-v2a";
import { seedV2BDatabase } from "@/db/seed-v2b";
import { seedCoreAuthorization } from "@/db/seed-v2b";
import { applicationMode } from "@/lib/server/runtime-mode";

const MIGRATIONS = [
  { id: "0000_ancient_greymalkin", sql: foundationMigration },
  { id: "0001_purple_the_initiative", sql: notificationScopeMigration },
  { id: "0002_zippy_lockheed", sql: maintenanceOperationsMigration },
  { id: "0003_careful_forge", sql: materialHistoryMigration },
  { id: "0004_free_patch", sql: preventivePlanningMigration },
  { id: "0005_magenta_vindicator", sql: reliabilityMigration },
  { id: "0006_peaceful_reptil", sql: procurementMigration },
  { id: "0007_luxuriant_ender_wiggin", sql: fieldOperationsMigration },
  { id: "0008_enterprise_governance", sql: enterpriseGovernanceMigration },
  {
    id: "0009_enterprise_audit_guardrails",
    sql: enterpriseAuditGuardrailsMigration,
  },
  {
    id: "0010_atomic_mutation_assertions",
    sql: atomicMutationAssertionsMigration,
  },
  { id: "0011_pilot_import_jobs", sql: pilotImportJobsMigration },
  { id: "0012_health_projection", sql: healthProjectionMigration },
  { id: "0013_preventive_scheduler", sql: preventiveSchedulerMigration },
] as const;
const SCHEMA_VERSION = MIGRATIONS.at(-1)!.id;
let initialization: Promise<void> | null = null;

export async function ensureDatabase(): Promise<void> {
  initialization ??= initialize();
  try {
    await initialization;
  } catch (error) {
    initialization = null;
    throw error;
  }
}

async function initialize(): Promise<void> {
  const db = getD1();
  await db.prepare("PRAGMA foreign_keys = ON").run();
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS _mazmi_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)",
    )
    .run();

  await adoptHostedSchema(db);

  for (const migration of MIGRATIONS) {
    const applied = await db
      .prepare("SELECT id FROM _mazmi_migrations WHERE id = ?")
      .bind(migration.id)
      .first<{ id: string }>();
    if (applied) continue;

    if (migration.id === "0010_atomic_mutation_assertions") {
      const incompatible = await db
        .prepare(
          `SELECT 'LABOR' AS domain, user_id AS entity, COUNT(*) AS count FROM labor_sessions WHERE ended_at IS NULL GROUP BY user_id HAVING COUNT(*) > 1
        UNION ALL SELECT 'DOWNTIME', work_order_id, COUNT(*) FROM downtime_events WHERE ended_at IS NULL AND work_order_id IS NOT NULL GROUP BY work_order_id HAVING COUNT(*) > 1`,
        )
        .all();
      if (incompatible.results.length)
        throw new Error(
          `MIGRATION_0010_PREFLIGHT_FAILED: ${JSON.stringify(incompatible.results)}`,
        );
    }

    const statements = migration.sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    await db.batch([
      ...statements.map((statement) => db.prepare(statement)),
      db
        .prepare("INSERT INTO _mazmi_migrations (id, applied_at) VALUES (?, ?)")
        .bind(migration.id, new Date().toISOString()),
    ]);
  }

  if (applicationMode() === "DEMO") {
    await seedDemoDatabase(db);
    await seedV1BDatabase(db);
    await seedV1CDatabase(db);
    await seedV1DDatabase(db);
    await seedV2ADatabase(db);
    await seedV2BDatabase(db);
  }
  await seedCoreAuthorization(db);
}

async function adoptHostedSchema(db: ReturnType<typeof getD1>): Promise<void> {
  // Sites applies packaged D1 migrations before the Worker starts. Its migration
  // ledger is separate from Mazmi's, so a freshly hosted database can contain the
  // complete schema while `_mazmi_migrations` is still empty. Adopt only an exact
  // final-schema fingerprint; a partial schema must continue to fail loudly.
  const [domainTables, notificationScope, auditGuardrails] = await db.batch([
    db.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table' AND name IN (
         'organizations',
         'incidents',
         'work_order_part_usages',
         'maintenance_plans',
         'root_cause_analyses',
         'purchase_requisitions',
         'shift_handovers',
         'permission_definitions'
       )`,
    ),
    db.prepare(
      "SELECT COUNT(*) AS count FROM pragma_table_info('notifications') WHERE name = 'site_id'",
    ),
    db.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE (type = 'trigger' AND name IN (
         'trg_audit_entries_append_only_update',
         'trg_audit_entries_append_only_delete'
       )) OR (type = 'index' AND name = 'production_calendars_site_default_unique')`,
    ),
  ]);

  const hasCompleteHostedSchema =
    Number(
      (domainTables.results?.[0] as { count?: number } | undefined)?.count ?? 0,
    ) === 8 &&
    Number(
      (notificationScope.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ) === 1 &&
    Number(
      (auditGuardrails.results?.[0] as { count?: number } | undefined)?.count ??
        0,
    ) === 3;

  if (!hasCompleteHostedSchema) return;

  // On an upgrade Sites can apply 0010 before the application sees it, while
  // Mazmi's ledger still ends at 0009. Never claim an absent schema delta.
  const guards = await db
    .prepare(
      `SELECT name,sql FROM sqlite_master WHERE name IN ('_mutation_assertions','uq_labor_one_active_user','uq_downtime_one_active_order','trg_work_order_finalization_guard','trg_material_final_order_guard','trg_downtime_final_order_guard')`,
    )
    .all<{ name: string; sql: string }>();
  if (guards.results.length > 0 && guards.results.length !== 6)
    throw new Error("MIGRATION_0010_PARTIAL_HOSTED_SCHEMA");
  const hasAtomicGuards = guards.results.length === 6;
  const normalizeGuard = (sql: string) =>
    sql
      .replace(/--[^\n]*/g, "")
      .replaceAll("`", "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/;$/, "");
  if (hasAtomicGuards) {
    const expected = atomicMutationAssertionsMigration
      .split("--> statement-breakpoint")
      .map(normalizeGuard);
    for (const guard of guards.results) {
      if (!expected.includes(normalizeGuard(guard.sql)))
        throw new Error(`MIGRATION_0010_SCHEMA_MISMATCH: ${guard.name}`);
    }
  } else if (
    await db
      .prepare(
        "SELECT id FROM _mazmi_migrations WHERE id='0010_atomic_mutation_assertions'",
      )
      .first()
  ) {
    throw new Error(
      "MIGRATION_0010_SCHEMA_MISMATCH: ledger claims missing guards",
    );
  }

  const importObjects = await db
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE name IN ('import_jobs','uq_import_jobs_source','idx_import_jobs_site_created')",
    )
    .all<{ name: string; sql: string }>();
  if (importObjects.results.length > 0 && importObjects.results.length !== 3)
    throw new Error("MIGRATION_0011_PARTIAL_HOSTED_SCHEMA");
  const hasImportJobs = importObjects.results.length === 3;
  if (hasImportJobs) {
    const expected = pilotImportJobsMigration
      .split("--> statement-breakpoint")
      .map(normalizeGuard);
    for (const object of importObjects.results) {
      if (!expected.includes(normalizeGuard(object.sql)))
        throw new Error(`MIGRATION_0011_SCHEMA_MISMATCH: ${object.name}`);
    }
  } else if (
    await db
      .prepare(
        "SELECT id FROM _mazmi_migrations WHERE id='0011_pilot_import_jobs'",
      )
      .first()
  ) {
    throw new Error(
      "MIGRATION_0011_SCHEMA_MISMATCH: ledger claims missing import jobs",
    );
  }

  const healthObjects = await db
    .prepare(
      `SELECT name,sql FROM sqlite_master WHERE name IN (
        'health_dirty_assets','idx_health_dirty_site',
        'trg_health_asset_insert','trg_health_asset_update',
        'trg_health_work_insert','trg_health_work_update',
        'trg_health_incident_insert','trg_health_incident_update',
        'trg_health_downtime_insert','trg_health_downtime_update')`,
    )
    .all<{ name: string; sql: string }>();
  if (healthObjects.results.length > 0 && healthObjects.results.length !== 10)
    throw new Error("MIGRATION_0012_PARTIAL_HOSTED_SCHEMA");
  const hasHealthProjection = healthObjects.results.length === 10;
  const computedColumn = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM pragma_table_info('assets') WHERE name='health_computed_at'",
    )
    .first<{ count: number }>();
  if (hasHealthProjection !== (Number(computedColumn?.count ?? 0) === 1))
    throw new Error("MIGRATION_0012_PARTIAL_HOSTED_SCHEMA");
  if (hasHealthProjection) {
    const expected = healthProjectionMigration
      .split("--> statement-breakpoint")
      .map(normalizeGuard)
      .filter((statement) => statement.startsWith("CREATE"));
    for (const object of healthObjects.results) {
      if (!expected.includes(normalizeGuard(object.sql)))
        throw new Error(`MIGRATION_0012_SCHEMA_MISMATCH: ${object.name}`);
    }
  } else if (
    await db
      .prepare(
        "SELECT id FROM _mazmi_migrations WHERE id='0012_health_projection'",
      )
      .first()
  ) {
    throw new Error(
      "MIGRATION_0012_SCHEMA_MISMATCH: ledger claims missing projection",
    );
  }

  const schedulerObjects = await db
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE name IN ('scheduler_runs','idx_scheduler_runs_job_started')",
    )
    .all<{ name: string; sql: string }>();
  if (
    schedulerObjects.results.length > 0 &&
    schedulerObjects.results.length !== 2
  )
    throw new Error("MIGRATION_0013_PARTIAL_HOSTED_SCHEMA");
  const hasScheduler = schedulerObjects.results.length === 2;
  if (hasScheduler) {
    const expected = preventiveSchedulerMigration
      .split("--> statement-breakpoint")
      .map(normalizeGuard);
    for (const object of schedulerObjects.results) {
      if (!expected.includes(normalizeGuard(object.sql)))
        throw new Error(`MIGRATION_0013_SCHEMA_MISMATCH: ${object.name}`);
    }
  } else if (
    await db
      .prepare(
        "SELECT id FROM _mazmi_migrations WHERE id='0013_preventive_scheduler'",
      )
      .first()
  ) {
    throw new Error(
      "MIGRATION_0013_SCHEMA_MISMATCH: ledger claims missing scheduler",
    );
  }

  const appliedAt = new Date().toISOString();
  await db.batch(
    MIGRATIONS.filter(
      (migration) =>
        migration.id < "0010" ||
        (migration.id < "0011" && hasAtomicGuards) ||
        (migration.id === "0011_pilot_import_jobs" && hasImportJobs) ||
        (migration.id === "0012_health_projection" && hasHealthProjection) ||
        (migration.id === "0013_preventive_scheduler" && hasScheduler),
    ).map((migration) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO _mazmi_migrations (id, applied_at) VALUES (?, ?)",
        )
        .bind(migration.id, appliedAt),
    ),
  );
}

export async function databaseHealth(): Promise<{
  status: "ok";
  schemaVersion: string;
  assets: number;
  workOrders: number;
  parts: number;
  rootCauseAnalyses: number;
  reliabilityAuditEntries: number;
  purchaseRequisitions: number;
  purchaseOrders: number;
  goodsReceipts: number;
  procurementAuditEntries: number;
  foreignKeyViolations: number;
  stockInvariantViolations: number;
  reliabilityInvariantViolations: number;
  procurementInvariantViolations: number;
  onOrderInvariantViolations: number;
  transferInvariantViolations: number;
  fieldEvidenceItems: number;
  shiftHandovers: number;
  workOrderMeasurements: number;
  fieldInvariantViolations: number;
  assetsWithoutScanCode: number;
  productionCalendars: number;
  scopedMemberships: number;
  pricedLaborSessions: number;
  v2bAuditEntries: number;
  governanceInvariantViolations: number;
  scopeInvariantViolations: number;
}> {
  await ensureDatabase();
  const db = getD1();
  const [
    assetCount,
    orderCount,
    partCount,
    rcaCount,
    reliabilityAuditCount,
    requisitionCount,
    purchaseOrderCount,
    goodsReceiptCount,
    procurementAuditCount,
    foreignKeyCheck,
    stockCheck,
    reliabilityInvariantCheck,
    procurementInvariantCheck,
    onOrderInvariantCheck,
    transferInvariantCheck,
    fieldEvidenceCount,
    handoverCount,
    measurementCount,
    fieldInvariantCheck,
    assetScanCheck,
    productionCalendarCount,
    scopedMembershipCount,
    pricedLaborCount,
    v2bAuditCount,
    governanceInvariantCheck,
    scopeInvariantCheck,
  ] = await db.batch([
    db.prepare("SELECT COUNT(*) AS count FROM assets"),
    db.prepare("SELECT COUNT(*) AS count FROM work_orders"),
    db.prepare("SELECT COUNT(*) AS count FROM parts"),
    db.prepare("SELECT COUNT(*) AS count FROM root_cause_analyses"),
    db.prepare(
      "SELECT COUNT(*) AS count FROM audit_entries WHERE entity_type = 'ROOT_CAUSE_ANALYSIS'",
    ),
    db.prepare("SELECT COUNT(*) AS count FROM purchase_requisitions"),
    db.prepare("SELECT COUNT(*) AS count FROM purchase_orders"),
    db.prepare("SELECT COUNT(*) AS count FROM goods_receipts"),
    db.prepare(
      "SELECT COUNT(*) AS count FROM audit_entries WHERE entity_type IN ('PURCHASE_REQUISITION','PURCHASE_ORDER','GOODS_RECEIPT','STOCK_TRANSFER')",
    ),
    db.prepare("SELECT COUNT(*) AS count FROM pragma_foreign_key_check"),
    db.prepare(
      "SELECT COUNT(*) AS count FROM stock_levels WHERE on_hand < 0 OR reserved < 0 OR on_order < 0 OR reserved > on_hand",
    ),
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM root_cause_analyses rca
       WHERE (rca.status = 'CLOSED' AND (rca.root_cause IS NULL OR TRIM(rca.root_cause) = ''))
          OR (rca.status IN ('CLOSED','CANCELLED') AND EXISTS (
            SELECT 1 FROM rca_actions action
            WHERE action.root_cause_analysis_id = rca.id
              AND action.status IN ('OPEN','IN_PROGRESS')
          ))`,
    ),
    db.prepare(
      `SELECT COUNT(*) AS count FROM purchase_orders po
       WHERE (po.status = 'RECEIVED' AND EXISTS (
         SELECT 1 FROM purchase_order_lines line WHERE line.purchase_order_id = po.id
           AND ABS(line.received_quantity - line.ordered_quantity) > 0.0001
       )) OR (po.status = 'PARTIALLY_RECEIVED' AND NOT EXISTS (
         SELECT 1 FROM purchase_order_lines line WHERE line.purchase_order_id = po.id
           AND line.received_quantity > 0 AND line.received_quantity < line.ordered_quantity
       )) OR (po.status = 'CANCELLED' AND EXISTS (
         SELECT 1 FROM goods_receipts receipt WHERE receipt.purchase_order_id = po.id
       ))`,
    ),
    db.prepare(
      `SELECT COUNT(*) AS count FROM (
        WITH expected AS (
          SELECT line.part_id, po.site_id, po.destination_bin_id AS bin_id,
            SUM(line.ordered_quantity - line.received_quantity) AS quantity
          FROM purchase_order_lines line
          INNER JOIN purchase_orders po ON po.id = line.purchase_order_id
          WHERE po.status IN ('SENT','PARTIALLY_RECEIVED')
          GROUP BY line.part_id, po.site_id, po.destination_bin_id
        ), projection_keys AS (
          SELECT part_id, site_id, bin_id FROM expected
          UNION
          SELECT part_id, site_id, bin_id FROM stock_levels WHERE on_order <> 0
        )
        SELECT projection_keys.part_id, projection_keys.site_id,
          projection_keys.bin_id,
          COALESCE(stock.on_order, 0) AS projected,
          COALESCE(expected.quantity, 0) AS expected
        FROM projection_keys
        LEFT JOIN stock_levels stock
          ON stock.part_id = projection_keys.part_id
         AND stock.site_id = projection_keys.site_id
         AND stock.bin_id = projection_keys.bin_id
        LEFT JOIN expected
          ON expected.part_id = projection_keys.part_id
         AND expected.site_id = projection_keys.site_id
         AND expected.bin_id = projection_keys.bin_id
      ) balances WHERE ABS(projected - expected) > 0.0001`,
    ),
    db.prepare(
      `SELECT COUNT(*) AS count FROM stock_transfers transfer
       WHERE (transfer.status = 'RECEIVED' AND ABS(COALESCE((
         SELECT SUM(movement.delta_on_hand) FROM inventory_movements movement
         WHERE movement.stock_transfer_id = transfer.id), 0)) > 0.0001)
       OR (transfer.status = 'CANCELLED' AND EXISTS (
         SELECT 1 FROM inventory_movements movement
         WHERE movement.stock_transfer_id = transfer.id))`,
    ),
    db.prepare("SELECT COUNT(*) AS count FROM evidence_items"),
    db.prepare("SELECT COUNT(*) AS count FROM shift_handovers"),
    db.prepare("SELECT COUNT(*) AS count FROM work_order_measurements"),
    db.prepare(
      `SELECT COUNT(*) AS count FROM (
        SELECT task.id FROM work_order_tasks task
        WHERE (task.response_status IN ('COMPLETED','PASS') AND task.completed_at IS NULL)
          OR (task.response_status = 'FAIL' AND task.required = 1 AND task.completed_at IS NOT NULL)
        UNION ALL
        SELECT measurement.id FROM work_order_measurements measurement
        INNER JOIN work_orders work_order ON work_order.id = measurement.work_order_id
        WHERE measurement.organization_id <> work_order.organization_id
          OR measurement.site_id <> work_order.site_id
          OR measurement.asset_id <> work_order.asset_id
        UNION ALL
        SELECT evidence.id FROM evidence_items evidence
        LEFT JOIN work_orders work_order ON work_order.id = evidence.work_order_id
        WHERE work_order.id IS NOT NULL AND (
          evidence.organization_id <> work_order.organization_id
          OR evidence.site_id <> work_order.site_id
          OR evidence.asset_id <> work_order.asset_id)
      ) violations`,
    ),
    db.prepare(
      "SELECT COUNT(*) AS count FROM assets WHERE scan_code IS NULL OR TRIM(scan_code) = ''",
    ),
    db.prepare(
      "SELECT COUNT(*) AS count FROM production_calendars WHERE status = 'ACTIVE'",
    ),
    db.prepare(
      "SELECT COUNT(DISTINCT membership_id) AS count FROM membership_site_scopes",
    ),
    db.prepare(
      "SELECT COUNT(*) AS count FROM labor_sessions WHERE hourly_rate_cents_snapshot IS NOT NULL",
    ),
    db.prepare(
      "SELECT COUNT(*) AS count FROM audit_entries WHERE action IN ('LOGIN_SUCCEEDED','LOGIN_FAILED','LOGIN_LOCKOUT','LOGIN_BLOCKED','LOGOUT','SITE_SCOPE_SWITCHED','ACCESS_SCOPE_CONFIGURED','ACCESS_DENIED')",
    ),
    db.prepare(
      `SELECT COUNT(*) AS count FROM (
        SELECT labor.id FROM labor_sessions labor
        WHERE labor.ended_at IS NOT NULL AND (labor.labor_cost_cents IS NULL OR labor.hourly_rate_cents_snapshot IS NULL)
        UNION ALL
        SELECT cost.id FROM work_order_cost_items cost
        INNER JOIN work_orders wo ON wo.id = cost.work_order_id
        WHERE cost.organization_id <> wo.organization_id OR cost.site_id <> wo.site_id
        UNION ALL
        SELECT evidence.id FROM evidence_items evidence
        WHERE evidence.storage_provider = 'R2' AND evidence.created_at >= '2026-09-08T00:00:00.000Z'
          AND (evidence.safe_file_name IS NULL OR evidence.checksum_sha256 IS NULL)
      ) violations`,
    ),
    db.prepare(
      `SELECT COUNT(*) AS count FROM (
        SELECT site_scope.id FROM membership_site_scopes site_scope
        INNER JOIN memberships membership ON membership.id = site_scope.membership_id
        INNER JOIN sites site ON site.id = site_scope.site_id
        WHERE membership.organization_id <> site.organization_id
        UNION ALL
        SELECT area_scope.id FROM membership_area_scopes area_scope
        INNER JOIN membership_site_scopes site_scope ON site_scope.id = area_scope.membership_site_scope_id
        INNER JOIN functional_locations location ON location.id = area_scope.functional_location_id
        WHERE site_scope.site_id <> location.site_id
        UNION ALL
        SELECT warehouse_scope.id FROM membership_warehouse_scopes warehouse_scope
        INNER JOIN membership_site_scopes site_scope ON site_scope.id = warehouse_scope.membership_site_scope_id
        INNER JOIN warehouses warehouse ON warehouse.id = warehouse_scope.warehouse_id
        WHERE site_scope.site_id <> warehouse.site_id
      ) violations`,
    ),
  ]);
  return {
    status: "ok",
    schemaVersion: SCHEMA_VERSION,
    assets: Number(
      (assetCount.results?.[0] as { count?: number } | undefined)?.count ?? 0,
    ),
    workOrders: Number(
      (orderCount.results?.[0] as { count?: number } | undefined)?.count ?? 0,
    ),
    parts: Number(
      (partCount.results?.[0] as { count?: number } | undefined)?.count ?? 0,
    ),
    rootCauseAnalyses: Number(
      (rcaCount.results?.[0] as { count?: number } | undefined)?.count ?? 0,
    ),
    reliabilityAuditEntries: Number(
      (reliabilityAuditCount.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    purchaseRequisitions: Number(
      (requisitionCount.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    purchaseOrders: Number(
      (purchaseOrderCount.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    goodsReceipts: Number(
      (goodsReceiptCount.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    procurementAuditEntries: Number(
      (procurementAuditCount.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    foreignKeyViolations: Number(
      (foreignKeyCheck.results?.[0] as { count?: number } | undefined)?.count ??
        0,
    ),
    stockInvariantViolations: Number(
      (stockCheck.results?.[0] as { count?: number } | undefined)?.count ?? 0,
    ),
    reliabilityInvariantViolations: Number(
      (reliabilityInvariantCheck.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    procurementInvariantViolations: Number(
      (procurementInvariantCheck.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    onOrderInvariantViolations: Number(
      (onOrderInvariantCheck.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    transferInvariantViolations: Number(
      (transferInvariantCheck.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    fieldEvidenceItems: Number(
      (fieldEvidenceCount.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    shiftHandovers: Number(
      (handoverCount.results?.[0] as { count?: number } | undefined)?.count ??
        0,
    ),
    workOrderMeasurements: Number(
      (measurementCount.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    fieldInvariantViolations: Number(
      (fieldInvariantCheck.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    assetsWithoutScanCode: Number(
      (assetScanCheck.results?.[0] as { count?: number } | undefined)?.count ??
        0,
    ),
    productionCalendars: Number(
      (productionCalendarCount.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    scopedMemberships: Number(
      (scopedMembershipCount.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    pricedLaborSessions: Number(
      (pricedLaborCount.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    v2bAuditEntries: Number(
      (v2bAuditCount.results?.[0] as { count?: number } | undefined)?.count ??
        0,
    ),
    governanceInvariantViolations: Number(
      (governanceInvariantCheck.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
    scopeInvariantViolations: Number(
      (scopeInvariantCheck.results?.[0] as { count?: number } | undefined)
        ?.count ?? 0,
    ),
  };
}
