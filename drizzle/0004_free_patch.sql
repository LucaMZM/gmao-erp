CREATE TABLE `certifications` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`issuing_authority` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_certifications_org_code` ON `certifications` (`organization_id`,`code`);--> statement-breakpoint
CREATE TABLE `maintenance_plan_certifications` (
	`id` text PRIMARY KEY NOT NULL,
	`maintenance_plan_id` text NOT NULL,
	`certification_id` text NOT NULL,
	FOREIGN KEY (`maintenance_plan_id`) REFERENCES `maintenance_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`certification_id`) REFERENCES `certifications`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_maintenance_plan_certification` ON `maintenance_plan_certifications` (`maintenance_plan_id`,`certification_id`);--> statement-breakpoint
CREATE TABLE `maintenance_plan_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`maintenance_plan_id` text NOT NULL,
	`part_id` text NOT NULL,
	`quantity` real NOT NULL,
	FOREIGN KEY (`maintenance_plan_id`) REFERENCES `maintenance_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_maintenance_plan_material_quantity" CHECK("maintenance_plan_materials"."quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_maintenance_plan_material` ON `maintenance_plan_materials` (`maintenance_plan_id`,`part_id`);--> statement-breakpoint
CREATE TABLE `maintenance_plan_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`maintenance_plan_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`minimum_level` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`maintenance_plan_id`) REFERENCES `maintenance_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_maintenance_plan_skill_level" CHECK("maintenance_plan_skills"."minimum_level" between 1 and 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_maintenance_plan_skill` ON `maintenance_plan_skills` (`maintenance_plan_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `maintenance_plan_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`maintenance_plan_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`required` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`maintenance_plan_id`) REFERENCES `maintenance_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_maintenance_plan_task_sequence` ON `maintenance_plan_tasks` (`maintenance_plan_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `maintenance_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`functional_location_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`meter_id` text,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`criticality` text NOT NULL,
	`priority` text DEFAULT 'P4_NORMAL' NOT NULL,
	`estimated_minutes` integer DEFAULT 60 NOT NULL,
	`trigger_mode` text NOT NULL,
	`calendar_unit` text,
	`calendar_interval` integer,
	`calendar_anchor_at` text,
	`calendar_next_at` text,
	`meter_interval` real,
	`meter_threshold` real,
	`lead_days` integer DEFAULT 7 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`last_executed_at` text,
	`last_generated_at` text,
	`next_due_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`functional_location_id`) REFERENCES `functional_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`meter_id`) REFERENCES `meters`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_maintenance_plan_trigger" CHECK("maintenance_plans"."trigger_mode" in ('CALENDAR','METER','WHICHEVER_FIRST')),
	CONSTRAINT "ck_maintenance_plan_calendar_unit" CHECK("maintenance_plans"."calendar_unit" is null or "maintenance_plans"."calendar_unit" in ('DAY','WEEK','MONTH')),
	CONSTRAINT "ck_maintenance_plan_status" CHECK("maintenance_plans"."status" in ('ACTIVE','INACTIVE')),
	CONSTRAINT "ck_maintenance_plan_duration" CHECK("maintenance_plans"."estimated_minutes" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_maintenance_plans_site_code` ON `maintenance_plans` (`site_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_maintenance_plans_site_due` ON `maintenance_plans` (`site_id`,`status`,`next_due_at`);--> statement-breakpoint
CREATE INDEX `idx_maintenance_plans_meter` ON `maintenance_plans` (`meter_id`,`status`);--> statement-breakpoint
CREATE TABLE `meter_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`meter_id` text NOT NULL,
	`recorded_by_id` text NOT NULL,
	`value` real NOT NULL,
	`recorded_at` text NOT NULL,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`meter_id`) REFERENCES `meters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_meter_reading_value" CHECK("meter_readings"."value" >= 0),
	CONSTRAINT "ck_meter_reading_source" CHECK("meter_readings"."source" in ('MANUAL','IMPORT','SYSTEM'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_meter_reading_time` ON `meter_readings` (`meter_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_meter_readings_meter_time` ON `meter_readings` (`meter_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `meters` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`reading_type` text DEFAULT 'CUMULATIVE' NOT NULL,
	`last_value` real,
	`last_reading_at` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_meter_reading_type" CHECK("meters"."reading_type" in ('CUMULATIVE','GAUGE')),
	CONSTRAINT "ck_meter_status" CHECK("meters"."status" in ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_meters_site_code` ON `meters` (`site_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_meters_asset_status` ON `meters` (`asset_id`,`status`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_skills_org_code` ON `skills` (`organization_id`,`code`);--> statement-breakpoint
CREATE TABLE `technician_certifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`certification_id` text NOT NULL,
	`issued_at` text NOT NULL,
	`expires_at` text,
	`status` text DEFAULT 'VALID' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`certification_id`) REFERENCES `certifications`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_technician_certification_status" CHECK("technician_certifications"."status" in ('VALID','EXPIRED','SUSPENDED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_technician_certification` ON `technician_certifications` (`user_id`,`certification_id`);--> statement-breakpoint
CREATE INDEX `idx_technician_certification_expiry` ON `technician_certifications` (`certification_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `technician_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`verified_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_technician_skill_level" CHECK("technician_skills"."level" between 1 and 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_technician_skill` ON `technician_skills` (`user_id`,`skill_id`);--> statement-breakpoint
CREATE INDEX `idx_technician_skills_skill` ON `technician_skills` (`skill_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `work_order_certification_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`certification_id` text NOT NULL,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`certification_id`) REFERENCES `certifications`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_order_certification` ON `work_order_certification_requirements` (`work_order_id`,`certification_id`);--> statement-breakpoint
CREATE TABLE `work_order_skill_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`minimum_level` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_order_skill` ON `work_order_skill_requirements` (`work_order_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `work_order_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`source_task_id` text,
	`sequence` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`required` integer DEFAULT true NOT NULL,
	`completed_at` text,
	`completed_by_id` text,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_task_id`) REFERENCES `maintenance_plan_tasks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`completed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_order_task_sequence` ON `work_order_tasks` (`work_order_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_work_order_tasks_order` ON `work_order_tasks` (`work_order_id`);--> statement-breakpoint
CREATE TABLE `workforce_availability` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_workforce_availability_kind" CHECK("workforce_availability"."kind" in ('LEAVE','TRAINING','UNAVAILABLE','OVERTIME'))
);
--> statement-breakpoint
CREATE INDEX `idx_workforce_availability_user_time` ON `workforce_availability` (`user_id`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `workforce_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`shift_code` text NOT NULL,
	`shift_start` text NOT NULL,
	`shift_end` text NOT NULL,
	`daily_capacity_minutes` integer DEFAULT 480 NOT NULL,
	`availability_status` text DEFAULT 'AVAILABLE' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_workforce_capacity" CHECK("workforce_profiles"."daily_capacity_minutes" between 1 and 1440),
	CONSTRAINT "ck_workforce_availability" CHECK("workforce_profiles"."availability_status" in ('AVAILABLE','LIMITED','UNAVAILABLE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_workforce_site_user` ON `workforce_profiles` (`site_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_workforce_site_availability` ON `workforce_profiles` (`site_id`,`availability_status`);--> statement-breakpoint
ALTER TABLE `work_orders` ADD `maintenance_plan_id` text REFERENCES maintenance_plans(id);--> statement-breakpoint
ALTER TABLE `work_orders` ADD `maintenance_window_key` text;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `preventive_due_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_orders_plan_window` ON `work_orders` (`maintenance_plan_id`,`maintenance_window_key`);