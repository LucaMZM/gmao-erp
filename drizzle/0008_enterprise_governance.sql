ALTER TABLE `users` ADD `auth_provider` text DEFAULT 'LOCAL' NOT NULL CHECK (`auth_provider` in ('LOCAL','OIDC','SAML'));
--> statement-breakpoint
ALTER TABLE `users` ADD `failed_login_count` integer DEFAULT 0 NOT NULL CHECK (`failed_login_count` >= 0);
--> statement-breakpoint
ALTER TABLE `users` ADD `locked_until` text;
--> statement-breakpoint
ALTER TABLE `sessions` ADD `absolute_expires_at` text;
--> statement-breakpoint
ALTER TABLE `sessions` ADD `idle_expires_at` text;
--> statement-breakpoint
ALTER TABLE `sessions` ADD `rotated_at` text;
--> statement-breakpoint
ALTER TABLE `sessions` ADD `session_family_id` text;
--> statement-breakpoint
UPDATE `sessions` SET `absolute_expires_at` = `expires_at`, `idle_expires_at` = `expires_at`, `session_family_id` = `id` WHERE `absolute_expires_at` IS NULL;
--> statement-breakpoint
CREATE TABLE `permission_definitions` (
	`code` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`action` text NOT NULL,
	`description` text NOT NULL,
	`sensitive` integer DEFAULT false NOT NULL CHECK (`sensitive` in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_key` text NOT NULL,
	`permission_code` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY (`role_key`,`permission_code`),
	FOREIGN KEY (`role_key`) REFERENCES `roles`(`key`) ON DELETE cascade,
	FOREIGN KEY (`permission_code`) REFERENCES `permission_definitions`(`code`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_role_permissions_permission` ON `role_permissions` (`permission_code`);
--> statement-breakpoint
CREATE TABLE `membership_site_scopes` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`site_id` text NOT NULL,
	`full_area_access` integer DEFAULT true NOT NULL CHECK (`full_area_access` in (0, 1)),
	`full_warehouse_access` integer DEFAULT true NOT NULL CHECK (`full_warehouse_access` in (0, 1)),
	`created_at` text NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_membership_site_scope` ON `membership_site_scopes` (`membership_id`,`site_id`);
--> statement-breakpoint
CREATE TABLE `membership_area_scopes` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_site_scope_id` text NOT NULL,
	`functional_location_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`membership_site_scope_id`) REFERENCES `membership_site_scopes`(`id`) ON DELETE cascade,
	FOREIGN KEY (`functional_location_id`) REFERENCES `functional_locations`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_membership_area_scope` ON `membership_area_scopes` (`membership_site_scope_id`,`functional_location_id`);
--> statement-breakpoint
CREATE TABLE `membership_warehouse_scopes` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_site_scope_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`membership_site_scope_id`) REFERENCES `membership_site_scopes`(`id`) ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_membership_warehouse_scope` ON `membership_warehouse_scopes` (`membership_site_scope_id`,`warehouse_id`);
--> statement-breakpoint
CREATE TABLE `production_calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`functional_location_id` text,
	`name` text NOT NULL,
	`timezone` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL CHECK (`status` in ('ACTIVE','INACTIVE')),
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE restrict,
	FOREIGN KEY (`functional_location_id`) REFERENCES `functional_locations`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_production_calendar_scope` ON `production_calendars` (`site_id`,`functional_location_id`);
--> statement-breakpoint
CREATE INDEX `idx_production_calendar_site_status` ON `production_calendars` (`site_id`,`status`);
--> statement-breakpoint
CREATE TABLE `production_calendar_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar_id` text NOT NULL,
	`day_of_week` integer NOT NULL CHECK (`day_of_week` between 0 and 6),
	`start_minute` integer NOT NULL CHECK (`start_minute` between 0 and 1439),
	`end_minute` integer NOT NULL CHECK (`end_minute` between 1 and 1440),
	`kind` text DEFAULT 'PRODUCTION' NOT NULL CHECK (`kind` in ('PRODUCTION','PLANNED_STOP','NON_PRODUCTION')),
	`capacity_percent` integer DEFAULT 100 NOT NULL CHECK (`capacity_percent` between 0 and 100),
	`label` text,
	FOREIGN KEY (`calendar_id`) REFERENCES `production_calendars`(`id`) ON DELETE cascade,
	CHECK (`end_minute` > `start_minute`)
);
--> statement-breakpoint
CREATE INDEX `idx_calendar_windows_day` ON `production_calendar_windows` (`calendar_id`,`day_of_week`,`start_minute`);
--> statement-breakpoint
CREATE TABLE `production_calendar_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar_id` text NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL CHECK (`kind` in ('HOLIDAY','PLANNED_STOP','NON_PRODUCTION','EXTRA_PRODUCTION')),
	`start_minute` integer,
	`end_minute` integer,
	`capacity_percent` integer DEFAULT 0 NOT NULL CHECK (`capacity_percent` between 0 and 100),
	`reason` text NOT NULL,
	FOREIGN KEY (`calendar_id`) REFERENCES `production_calendars`(`id`) ON DELETE cascade,
	CHECK (`start_minute` is null or (`start_minute` between 0 and 1439 and `end_minute` between 1 and 1440 and `end_minute` > `start_minute`))
);
--> statement-breakpoint
CREATE INDEX `idx_calendar_exceptions_date` ON `production_calendar_exceptions` (`calendar_id`,`date`);
--> statement-breakpoint
CREATE TABLE `work_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`team` text NOT NULL,
	`start_minute` integer NOT NULL CHECK (`start_minute` between 0 and 1439),
	`end_minute` integer NOT NULL CHECK (`end_minute` between 1 and 1440),
	`days_mask` text NOT NULL,
	`capacity_minutes` integer NOT NULL CHECK (`capacity_minutes` > 0),
	`status` text DEFAULT 'ACTIVE' NOT NULL CHECK (`status` in ('ACTIVE','INACTIVE')),
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_shifts_site_code` ON `work_shifts` (`site_id`,`code`);
--> statement-breakpoint
CREATE TABLE `shift_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`shift_id` text NOT NULL,
	`user_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`capacity_minutes_override` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `work_shifts`(`id`) ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict,
	CHECK (`effective_to` is null or `effective_to` >= `effective_from`),
	CHECK (`capacity_minutes_override` is null or `capacity_minutes_override` > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_shift_assignments_user_dates` ON `shift_assignments` (`user_id`,`effective_from`,`effective_to`);
--> statement-breakpoint
CREATE TABLE `workforce_absences` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`kind` text NOT NULL CHECK (`kind` in ('LEAVE','SICK','TRAINING','UNAVAILABLE')),
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict,
	CHECK (`ends_at` > `starts_at`)
);
--> statement-breakpoint
CREATE INDEX `idx_workforce_absence_site_dates` ON `workforce_absences` (`site_id`,`starts_at`,`ends_at`);
--> statement-breakpoint
CREATE TABLE `labor_rate_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text,
	`role_key` text,
	`shift_id` text,
	`hourly_rate_cents` integer NOT NULL CHECK (`hourly_rate_cents` >= 0),
	`currency` text DEFAULT 'EUR' NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict,
	FOREIGN KEY (`role_key`) REFERENCES `roles`(`key`) ON DELETE restrict,
	FOREIGN KEY (`shift_id`) REFERENCES `work_shifts`(`id`) ON DELETE restrict,
	CHECK (`user_id` is not null or `role_key` is not null),
	CHECK (`effective_to` is null or `effective_to` >= `effective_from`)
);
--> statement-breakpoint
CREATE INDEX `idx_labor_rate_user_dates` ON `labor_rate_cards` (`user_id`,`effective_from`,`effective_to`);
--> statement-breakpoint
ALTER TABLE `labor_sessions` ADD `hourly_rate_cents_snapshot` integer CHECK (`hourly_rate_cents_snapshot` is null or `hourly_rate_cents_snapshot` >= 0);
--> statement-breakpoint
ALTER TABLE `labor_sessions` ADD `labor_cost_cents` integer CHECK (`labor_cost_cents` is null or `labor_cost_cents` >= 0);
--> statement-breakpoint
ALTER TABLE `labor_sessions` ADD `currency_snapshot` text;
--> statement-breakpoint
CREATE TABLE `work_order_cost_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`kind` text NOT NULL CHECK (`kind` in ('EXTERNAL_VENDOR','OTHER')),
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL CHECK (`amount_cents` >= 0),
	`currency` text DEFAULT 'EUR' NOT NULL,
	`vendor_id` text,
	`recorded_by_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE restrict,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON DELETE cascade,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON DELETE restrict,
	FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_work_order_cost_items_order` ON `work_order_cost_items` (`work_order_id`,`recorded_at`);
--> statement-breakpoint
CREATE TABLE `authentication_policies` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`session_hours` integer DEFAULT 12 NOT NULL CHECK (`session_hours` between 1 and 168),
	`idle_minutes` integer DEFAULT 120 NOT NULL CHECK (`idle_minutes` between 5 and 1440),
	`absolute_hours` integer DEFAULT 24 NOT NULL CHECK (`absolute_hours` between 1 and 720),
	`rotation_minutes` integer DEFAULT 60 NOT NULL CHECK (`rotation_minutes` between 5 and 1440),
	`max_failed_attempts` integer DEFAULT 5 NOT NULL CHECK (`max_failed_attempts` between 2 and 20),
	`lockout_minutes` integer DEFAULT 15 NOT NULL CHECK (`lockout_minutes` between 1 and 1440),
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`normalized_email` text NOT NULL,
	`succeeded` integer NOT NULL CHECK (`succeeded` in (0, 1)),
	`failure_reason` text,
	`request_id` text NOT NULL,
	`attempted_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_login_attempts_email_time` ON `login_attempts` (`normalized_email`,`attempted_at`);
--> statement-breakpoint
CREATE TABLE `saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text,
	`resource` text NOT NULL,
	`name` text NOT NULL,
	`filters_json` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL CHECK (`is_default` in (0, 1)),
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_saved_views_user_resource_name` ON `saved_views` (`user_id`,`resource`,`name`);
--> statement-breakpoint
CREATE TABLE `operation_idempotency` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`operation` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`response_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_operation_idempotency_scope_key` ON `operation_idempotency` (`organization_id`,`actor_id`,`idempotency_key`);
--> statement-breakpoint
ALTER TABLE `audit_entries` ADD `context_json` text;
--> statement-breakpoint
ALTER TABLE `audit_entries` ADD `outcome` text DEFAULT 'SUCCESS' NOT NULL CHECK (`outcome` in ('SUCCESS','DENIED','FAILURE'));
--> statement-breakpoint
ALTER TABLE `audit_entries` ADD `error_code` text;
--> statement-breakpoint
CREATE INDEX `idx_audit_site_action_created` ON `audit_entries` (`site_id`,`action`,`created_at`);
--> statement-breakpoint
CREATE TABLE `request_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`actor_id` text,
	`organization_id` text,
	`site_id` text,
	`operation` text NOT NULL,
	`outcome` text NOT NULL CHECK (`outcome` in ('SUCCESS','DENIED','FAILURE')),
	`error_classification` text,
	`duration_ms` integer CHECK (`duration_ms` is null or `duration_ms` >= 0),
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE set null,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_request_activity_request` ON `request_activity` (`request_id`);
--> statement-breakpoint
CREATE INDEX `idx_request_activity_scope_created` ON `request_activity` (`site_id`,`created_at`);
--> statement-breakpoint
ALTER TABLE `evidence_items` ADD `safe_file_name` text;
--> statement-breakpoint
ALTER TABLE `evidence_items` ADD `checksum_sha256` text;
--> statement-breakpoint
ALTER TABLE `evidence_items` ADD `retention_until` text;
--> statement-breakpoint
ALTER TABLE `evidence_items` ADD `scan_status` text DEFAULT 'NOT_CONFIGURED' NOT NULL CHECK (`scan_status` in ('NOT_CONFIGURED','PENDING','PASSED','REJECTED'));
--> statement-breakpoint
CREATE INDEX `idx_evidence_scope_created` ON `evidence_items` (`organization_id`,`site_id`,`created_at`);
