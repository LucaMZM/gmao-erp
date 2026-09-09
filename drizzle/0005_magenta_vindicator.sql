CREATE TABLE `failure_modes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`default_effect` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_failure_modes_status" CHECK("failure_modes"."status" in ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_failure_modes_org_code` ON `failure_modes` (`organization_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_failure_modes_org_category` ON `failure_modes` (`organization_id`,`category`);--> statement-breakpoint
CREATE TABLE `rca_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`root_cause_analysis_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`action_type` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`owner_id` text NOT NULL,
	`target_at` text,
	`linked_work_order_id` text,
	`linked_maintenance_plan_id` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`root_cause_analysis_id`) REFERENCES `root_cause_analyses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`linked_work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`linked_maintenance_plan_id`) REFERENCES `maintenance_plans`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_rca_action_type" CHECK("rca_actions"."action_type" in ('CREATE_WORK_ORDER','UPDATE_MAINTENANCE_PLAN','INSPECTION','TRAINING','TECHNICAL_CHANGE')),
	CONSTRAINT "ck_rca_action_status" CHECK("rca_actions"."status" in ('OPEN','IN_PROGRESS','DONE','CANCELLED'))
);
--> statement-breakpoint
CREATE INDEX `idx_rca_actions_rca_status` ON `rca_actions` (`root_cause_analysis_id`,`status`);--> statement-breakpoint
CREATE TABLE `rca_events` (
	`id` text PRIMARY KEY NOT NULL,
	`root_cause_analysis_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`event_type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`root_cause_analysis_id`) REFERENCES `root_cause_analyses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_rca_events_rca_created` ON `rca_events` (`root_cause_analysis_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rca_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`root_cause_analysis_id` text NOT NULL,
	`kind` text DEFAULT 'OBSERVATION' NOT NULL,
	`description` text NOT NULL,
	`source_reference` text,
	`created_by_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`root_cause_analysis_id`) REFERENCES `root_cause_analyses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_rca_evidence_kind" CHECK("rca_evidence"."kind" in ('OBSERVATION','MEASUREMENT','DOCUMENT','PHOTO','WORK_ORDER'))
);
--> statement-breakpoint
CREATE INDEX `idx_rca_evidence_rca_created` ON `rca_evidence` (`root_cause_analysis_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rca_whys` (
	`id` text PRIMARY KEY NOT NULL,
	`root_cause_analysis_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	FOREIGN KEY (`root_cause_analysis_id`) REFERENCES `root_cause_analyses`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_rca_why_sequence" CHECK("rca_whys"."sequence" between 1 and 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_rca_why_sequence` ON `rca_whys` (`root_cause_analysis_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `root_cause_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`number` text NOT NULL,
	`asset_id` text NOT NULL,
	`source_work_order_id` text,
	`failure_mode_id` text,
	`created_by_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`problem` text NOT NULL,
	`impact` text NOT NULL,
	`immediate_cause` text,
	`root_cause` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`target_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`failure_mode_id`) REFERENCES `failure_modes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_rca_status" CHECK("root_cause_analyses"."status" in ('DRAFT','INVESTIGATING','ACTIONS_DEFINED','VERIFICATION','CLOSED','CANCELLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_rca_org_number` ON `root_cause_analyses` (`organization_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_rca_site_status_target` ON `root_cause_analyses` (`site_id`,`status`,`target_at`);--> statement-breakpoint
CREATE INDEX `idx_rca_asset_created` ON `root_cause_analyses` (`asset_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `work_orders` ADD `failure_mode_id` text REFERENCES failure_modes(id);--> statement-breakpoint
ALTER TABLE `work_orders` ADD `failure_effect` text;--> statement-breakpoint
CREATE INDEX `idx_work_orders_site_failure_requested` ON `work_orders` (`site_id`,`failure_mode_id`,`requested_at`);