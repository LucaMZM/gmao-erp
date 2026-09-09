ALTER TABLE `assets` ADD `scan_code` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_assets_org_scan_code` ON `assets` (`organization_id`,`scan_code`);
--> statement-breakpoint
ALTER TABLE `maintenance_plan_tasks` ADD `response_type` text DEFAULT 'CHECKBOX' NOT NULL CHECK (`response_type` in ('CHECKBOX','CONFIRMATION','TEXT','NUMBER','READING','PASS_FAIL'));
--> statement-breakpoint
ALTER TABLE `maintenance_plan_tasks` ADD `unit` text;
--> statement-breakpoint
ALTER TABLE `maintenance_plan_tasks` ADD `minimum_value` real;
--> statement-breakpoint
ALTER TABLE `maintenance_plan_tasks` ADD `maximum_value` real;
--> statement-breakpoint
ALTER TABLE `maintenance_plan_tasks` ADD `meter_id` text REFERENCES `meters`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `work_order_tasks` ADD `response_type` text DEFAULT 'CHECKBOX' NOT NULL CHECK (`response_type` in ('CHECKBOX','CONFIRMATION','TEXT','NUMBER','READING','PASS_FAIL'));
--> statement-breakpoint
ALTER TABLE `work_order_tasks` ADD `unit` text;
--> statement-breakpoint
ALTER TABLE `work_order_tasks` ADD `minimum_value` real;
--> statement-breakpoint
ALTER TABLE `work_order_tasks` ADD `maximum_value` real;
--> statement-breakpoint
ALTER TABLE `work_order_tasks` ADD `meter_id` text REFERENCES `meters`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `work_order_tasks` ADD `response_value` text;
--> statement-breakpoint
ALTER TABLE `work_order_tasks` ADD `response_status` text DEFAULT 'PENDING' NOT NULL CHECK (`response_status` in ('PENDING','COMPLETED','PASS','FAIL'));
--> statement-breakpoint
ALTER TABLE `work_order_tasks` ADD `responded_at` text;
--> statement-breakpoint
ALTER TABLE `work_order_tasks` ADD `responded_by_id` text REFERENCES `users`(`id`) ON DELETE restrict;
--> statement-breakpoint
UPDATE `work_order_tasks` SET `response_value` = 'true', `response_status` = 'COMPLETED', `responded_at` = `completed_at`, `responded_by_id` = `completed_by_id` WHERE `completed_at` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_work_order_tasks_meter` ON `work_order_tasks` (`meter_id`);
--> statement-breakpoint
ALTER TABLE `work_orders` ADD `safety_level` text DEFAULT 'STANDARD' NOT NULL CHECK (`safety_level` in ('STANDARD','CAUTION','CRITICAL'));
--> statement-breakpoint
ALTER TABLE `work_orders` ADD `safety_summary` text;
--> statement-breakpoint
ALTER TABLE `work_orders` ADD `ppe_required` text;
--> statement-breakpoint
ALTER TABLE `work_orders` ADD `precautions` text;
--> statement-breakpoint
ALTER TABLE `work_orders` ADD `isolation_required` integer DEFAULT false NOT NULL CHECK (`isolation_required` in (0, 1));
--> statement-breakpoint
CREATE TABLE `shift_handovers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`author_id` text NOT NULL,
	`from_shift` text NOT NULL,
	`to_shift` text NOT NULL,
	`summary` text NOT NULL,
	`risks` text,
	`parts_pending` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE restrict,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_shift_handovers_site_created` ON `shift_handovers` (`site_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `shift_handover_work_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`handover_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`status_snapshot` text NOT NULL,
	`note` text,
	FOREIGN KEY (`handover_id`) REFERENCES `shift_handovers`(`id`) ON DELETE cascade,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_shift_handover_work_order` ON `shift_handover_work_orders` (`handover_id`,`work_order_id`);
--> statement-breakpoint
CREATE TABLE `work_order_safety_acknowledgements` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`user_id` text NOT NULL,
	`acknowledged_at` text NOT NULL,
	`safety_snapshot` text NOT NULL,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_order_safety_user` ON `work_order_safety_acknowledgements` (`work_order_id`,`user_id`);
--> statement-breakpoint
CREATE TABLE `work_order_measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`task_id` text,
	`asset_id` text NOT NULL,
	`meter_id` text,
	`meter_reading_id` text,
	`label` text NOT NULL,
	`unit` text NOT NULL,
	`value` real NOT NULL,
	`minimum_value` real,
	`maximum_value` real,
	`result` text NOT NULL CHECK (`result` in ('IN_RANGE','OUT_OF_RANGE','INFORMATIONAL')),
	`note` text,
	`recorded_by_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE restrict,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `work_order_tasks`(`id`) ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE restrict,
	FOREIGN KEY (`meter_id`) REFERENCES `meters`(`id`) ON DELETE restrict,
	FOREIGN KEY (`meter_reading_id`) REFERENCES `meter_readings`(`id`) ON DELETE restrict,
	FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON DELETE restrict,
	CHECK (`minimum_value` is null or `maximum_value` is null or `maximum_value` >= `minimum_value`)
);
--> statement-breakpoint
CREATE INDEX `idx_work_order_measurements_order_time` ON `work_order_measurements` (`work_order_id`,`recorded_at`);
--> statement-breakpoint
CREATE INDEX `idx_work_order_measurements_meter_time` ON `work_order_measurements` (`meter_id`,`recorded_at`);
--> statement-breakpoint
CREATE TABLE `evidence_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`work_order_id` text,
	`incident_id` text,
	`asset_id` text,
	`root_cause_analysis_id` text,
	`author_id` text NOT NULL,
	`kind` text NOT NULL CHECK (`kind` in ('PHOTO','DOCUMENT','NOTE')),
	`stage` text DEFAULT 'GENERAL' NOT NULL CHECK (`stage` in ('BEFORE','DURING','AFTER','GENERAL')),
	`description` text NOT NULL,
	`storage_provider` text DEFAULT 'NONE' NOT NULL CHECK (`storage_provider` in ('NONE','R2')),
	`storage_key` text,
	`file_name` text,
	`content_type` text,
	`size_bytes` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE restrict,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON DELETE cascade,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE restrict,
	FOREIGN KEY (`root_cause_analysis_id`) REFERENCES `root_cause_analyses`(`id`) ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE restrict,
	CHECK (`work_order_id` is not null or `incident_id` is not null or `asset_id` is not null or `root_cause_analysis_id` is not null),
	CHECK ((`kind` = 'NOTE' and `storage_key` is null) or (`kind` <> 'NOTE' and `storage_provider` = 'R2' and `storage_key` is not null and `size_bytes` > 0))
);
--> statement-breakpoint
CREATE INDEX `idx_evidence_work_order_created` ON `evidence_items` (`work_order_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_evidence_asset_created` ON `evidence_items` (`asset_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_evidence_incident_created` ON `evidence_items` (`incident_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_evidence_rca_created` ON `evidence_items` (`root_cause_analysis_id`,`created_at`);
