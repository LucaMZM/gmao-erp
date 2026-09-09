CREATE TABLE `incident_events` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`event_type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_incident_events_incident_created` ON `incident_events` (`incident_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `incident_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`kind` text DEFAULT 'NOTE' NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_incident_notes_kind" CHECK("incident_notes"."kind" in ('NOTE','INFO_REQUEST','RESPONSE','TRIAGE_DECISION'))
);
--> statement-breakpoint
CREATE INDEX `idx_incident_notes_incident_created` ON `incident_notes` (`incident_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`functional_location_id` text NOT NULL,
	`asset_id` text,
	`reported_by_id` text NOT NULL,
	`number` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`severity` text NOT NULL,
	`initial_impact` text NOT NULL,
	`status` text DEFAULT 'NEW' NOT NULL,
	`origin` text NOT NULL,
	`classification` text,
	`triage_priority` text,
	`reported_at` text NOT NULL,
	`triaged_at` text,
	`resolved_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`functional_location_id`) REFERENCES `functional_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reported_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_incidents_status" CHECK("incidents"."status" in ('NEW','IN_TRIAGE','ACCEPTED','REJECTED','CONVERTED','CLOSED')),
	CONSTRAINT "ck_incidents_severity" CHECK("incidents"."severity" in ('CRITICAL','HIGH','MEDIUM','LOW')),
	CONSTRAINT "ck_incidents_origin" CHECK("incidents"."origin" in ('OPERATOR','MAINTENANCE','INSPECTION','CONDITION','SYSTEM')),
	CONSTRAINT "ck_incidents_impact" CHECK("incidents"."initial_impact" in ('FULL_STOP','REDUCED_SPEED','QUALITY_RISK','SAFETY_RISK','NO_IMPACT','UNKNOWN'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_incidents_org_number` ON `incidents` (`organization_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_incidents_site_status_reported` ON `incidents` (`site_id`,`status`,`reported_at`);--> statement-breakpoint
CREATE INDEX `idx_incidents_asset_reported` ON `incidents` (`asset_id`,`reported_at`);--> statement-breakpoint
CREATE TABLE `work_order_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`part_id` text NOT NULL,
	`bin_id` text NOT NULL,
	`planned_quantity` real DEFAULT 0 NOT NULL,
	`reserved_quantity` real DEFAULT 0 NOT NULL,
	`consumed_quantity` real DEFAULT 0 NOT NULL,
	`returned_quantity` real DEFAULT 0 NOT NULL,
	`created_by_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bin_id`) REFERENCES `warehouse_bins`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_work_order_material_quantities" CHECK("work_order_materials"."planned_quantity" >= 0 and "work_order_materials"."reserved_quantity" >= 0 and "work_order_materials"."consumed_quantity" >= 0 and "work_order_materials"."returned_quantity" >= 0 and "work_order_materials"."returned_quantity" <= "work_order_materials"."consumed_quantity")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_order_material_part_bin` ON `work_order_materials` (`work_order_id`,`part_id`,`bin_id`);--> statement-breakpoint
CREATE INDEX `idx_work_order_materials_order` ON `work_order_materials` (`work_order_id`);--> statement-breakpoint
ALTER TABLE `downtime_events` ADD `functional_location_id` text REFERENCES functional_locations(id);--> statement-breakpoint
ALTER TABLE `downtime_events` ADD `created_by_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `downtime_events` ADD `ended_by_id` text REFERENCES users(id);--> statement-breakpoint
CREATE TABLE `__new_labor_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`user_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`minutes` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`ended_by_id` text,
	`note` text,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ended_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_labor_minutes" CHECK("minutes" >= 0),
	CONSTRAINT "ck_labor_status" CHECK("status" in ('ACTIVE','PAUSED','STOPPED'))
);
--> statement-breakpoint
INSERT INTO `__new_labor_sessions`("id", "work_order_id", "user_id", "started_at", "ended_at", "minutes", "status", "ended_by_id", "note") SELECT "id", "work_order_id", "user_id", "started_at", "ended_at", "minutes", CASE WHEN "ended_at" IS NULL THEN 'ACTIVE' ELSE 'STOPPED' END, NULL, "note" FROM `labor_sessions`;--> statement-breakpoint
DROP TABLE `labor_sessions`;--> statement-breakpoint
ALTER TABLE `__new_labor_sessions` RENAME TO `labor_sessions`;--> statement-breakpoint
CREATE INDEX `idx_labor_work_order` ON `labor_sessions` (`work_order_id`);--> statement-breakpoint
CREATE INDEX `idx_labor_user_active` ON `labor_sessions` (`user_id`,`ended_at`);--> statement-breakpoint
ALTER TABLE `work_orders` ADD `incident_id` text REFERENCES incidents(id);--> statement-breakpoint
ALTER TABLE `work_orders` ADD `completed_at` text;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `closed_at` text;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `cancelled_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_orders_incident` ON `work_orders` (`incident_id`);--> statement-breakpoint
UPDATE `downtime_events` SET `functional_location_id` = (SELECT `functional_location_id` FROM `assets` WHERE `assets`.`id` = `downtime_events`.`asset_id`) WHERE `functional_location_id` IS NULL;--> statement-breakpoint
UPDATE `work_orders` SET `completed_at` = `actual_end` WHERE `status` IN ('COMPLETED','CLOSED') AND `completed_at` IS NULL;--> statement-breakpoint
UPDATE `work_orders` SET `closed_at` = `updated_at` WHERE `status` = 'CLOSED' AND `closed_at` IS NULL;--> statement-breakpoint
UPDATE `work_orders` SET `cancelled_at` = `updated_at` WHERE `status` = 'CANCELLED' AND `cancelled_at` IS NULL;
