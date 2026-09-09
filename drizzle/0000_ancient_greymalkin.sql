CREATE TABLE `asset_classes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`family` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_classes_org_code` ON `asset_classes` (`organization_id`,`code`);--> statement-breakpoint
CREATE TABLE `asset_part_compatibilities` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`part_id` text NOT NULL,
	`relation` text DEFAULT 'COMPATIBLE' NOT NULL,
	`recommended_quantity` real DEFAULT 1 NOT NULL,
	`note` text,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_part_compatibility` ON `asset_part_compatibilities` (`asset_id`,`part_id`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`functional_location_id` text NOT NULL,
	`parent_asset_id` text,
	`asset_class_id` text NOT NULL,
	`vendor_id` text,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`criticality` text NOT NULL,
	`health_score` integer NOT NULL,
	`manufacturer` text,
	`model` text,
	`serial_number` text,
	`commissioned_at` text,
	`warranty_until` text,
	`next_pm_at` text,
	`technical_summary` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`functional_location_id`) REFERENCES `functional_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_class_id`) REFERENCES `asset_classes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_assets_health" CHECK("assets"."health_score" between 0 and 100),
	CONSTRAINT "ck_assets_kind" CHECK("assets"."kind" in ('EQUIPMENT','ASSEMBLY','COMPONENT')),
	CONSTRAINT "ck_assets_status" CHECK("assets"."status" in ('OPERATING','DEGRADED','DOWN','MAINTENANCE','STANDBY','RETIRED')),
	CONSTRAINT "ck_assets_criticality" CHECK("assets"."criticality" in ('CRITICAL','HIGH','MEDIUM','LOW'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_assets_site_code` ON `assets` (`site_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_assets_site_status_criticality` ON `assets` (`site_id`,`status`,`criticality`);--> statement-breakpoint
CREATE INDEX `idx_assets_site_health` ON `assets` (`site_id`,`health_score`);--> statement-breakpoint
CREATE INDEX `idx_assets_location` ON `assets` (`functional_location_id`);--> statement-breakpoint
CREATE INDEX `idx_assets_parent` ON `assets` (`site_id`,`parent_asset_id`);--> statement-breakpoint
CREATE TABLE `audit_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`previous_value` text,
	`new_value` text,
	`request_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_audit_entity_created` ON `audit_entries` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_org_created` ON `audit_entries` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `downtime_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`work_order_id` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	`duration_minutes` integer NOT NULL,
	`kind` text NOT NULL,
	`production_impact` text NOT NULL,
	`cause` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_downtime_duration" CHECK("downtime_events"."duration_minutes" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_downtime_site_started` ON `downtime_events` (`site_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_downtime_asset_started` ON `downtime_events` (`asset_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `functional_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`parent_id` text,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_id`) REFERENCES `functional_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_locations_type" CHECK("functional_locations"."type" in ('AREA','PRODUCTION_LINE','SYSTEM','ZONE','WAREHOUSE','WORKSHOP','LAB','UTILITY'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_locations_site_code` ON `functional_locations` (`site_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_locations_site_parent` ON `functional_locations` (`site_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`part_id` text NOT NULL,
	`bin_id` text NOT NULL,
	`work_order_id` text,
	`actor_id` text NOT NULL,
	`movement_type` text NOT NULL,
	`reference` text NOT NULL,
	`reason` text NOT NULL,
	`delta_on_hand` real DEFAULT 0 NOT NULL,
	`delta_reserved` real DEFAULT 0 NOT NULL,
	`delta_on_order` real DEFAULT 0 NOT NULL,
	`unit_cost` real NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bin_id`) REFERENCES `warehouse_bins`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_movement_type" CHECK("inventory_movements"."movement_type" in ('RECEIPT','ISSUE','RESERVE','RELEASE','TRANSFER','ADJUSTMENT','RETURN','ORDER','CONSUMPTION'))
);
--> statement-breakpoint
CREATE INDEX `idx_movements_part_occurred` ON `inventory_movements` (`part_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_movements_work_order` ON `inventory_movements` (`work_order_id`);--> statement-breakpoint
CREATE TABLE `labor_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`user_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`minutes` integer DEFAULT 0 NOT NULL,
	`note` text,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_labor_work_order` ON `labor_sessions` (`work_order_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_key` text NOT NULL,
	`default_site_id` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`role_key`) REFERENCES `roles`(`key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`default_site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_memberships_org_user` ON `memberships` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_memberships_user` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`severity` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`read_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user_read` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'Europe/Madrid' NOT NULL,
	`locale` text DEFAULT 'es-ES' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_organizations_code` ON `organizations` (`code`);--> statement-breakpoint
CREATE TABLE `part_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`parent_id` text,
	`code` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_id`) REFERENCES `part_categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_part_categories_org_code` ON `part_categories` (`organization_id`,`code`);--> statement-breakpoint
CREATE TABLE `part_site_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`part_id` text NOT NULL,
	`site_id` text NOT NULL,
	`primary_vendor_id` text,
	`critical` integer DEFAULT false NOT NULL,
	`min_stock` real NOT NULL,
	`max_stock` real NOT NULL,
	`reorder_point` real NOT NULL,
	`lead_time_days` integer NOT NULL,
	`average_cost` real NOT NULL,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`primary_vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_part_site_policy` ON `part_site_policies` (`part_id`,`site_id`);--> statement-breakpoint
CREATE INDEX `idx_part_site_policy_site_critical` ON `part_site_policies` (`site_id`,`critical`);--> statement-breakpoint
CREATE TABLE `parts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`category_id` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`unit` text NOT NULL,
	`manufacturer` text,
	`manufacturer_ref` text,
	`standard_cost` real NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `part_categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_parts_org_sku` ON `parts` (`organization_id`,`sku`);--> statement-breakpoint
CREATE INDEX `idx_parts_category` ON `parts` (`category_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`rank` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`current_site_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sessions_token_hash` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user_expires` ON `sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`city` text NOT NULL,
	`timezone` text DEFAULT 'Europe/Madrid' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sites_org_code` ON `sites` (`organization_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_sites_organization` ON `sites` (`organization_id`);--> statement-breakpoint
CREATE TABLE `stock_levels` (
	`id` text PRIMARY KEY NOT NULL,
	`part_id` text NOT NULL,
	`site_id` text NOT NULL,
	`bin_id` text NOT NULL,
	`on_hand` real DEFAULT 0 NOT NULL,
	`reserved` real DEFAULT 0 NOT NULL,
	`on_order` real DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bin_id`) REFERENCES `warehouse_bins`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_stock_nonnegative" CHECK("stock_levels"."on_hand" >= 0 and "stock_levels"."reserved" >= 0 and "stock_levels"."on_order" >= 0 and "stock_levels"."reserved" <= "stock_levels"."on_hand")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stock_part_bin` ON `stock_levels` (`part_id`,`bin_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_site_part` ON `stock_levels` (`site_id`,`part_id`);--> statement-breakpoint
CREATE TABLE `system_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`full_name` text NOT NULL,
	`initials` text NOT NULL,
	`job_title` text NOT NULL,
	`avatar_color` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`email` text,
	`phone` text,
	`lead_time_days` integer DEFAULT 7 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vendors_org_code` ON `vendors` (`organization_id`,`code`);--> statement-breakpoint
CREATE TABLE `warehouse_bins` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`code` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bins_warehouse_code` ON `warehouse_bins` (`warehouse_id`,`code`);--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_warehouses_site_code` ON `warehouses` (`site_id`,`code`);--> statement-breakpoint
CREATE TABLE `work_order_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`user_id` text NOT NULL,
	`assignment_role` text DEFAULT 'LEAD' NOT NULL,
	`assigned_at` text NOT NULL,
	`unassigned_at` text,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_order_assignments` ON `work_order_assignments` (`work_order_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_assignments_user_active` ON `work_order_assignments` (`user_id`,`unassigned_at`);--> statement-breakpoint
CREATE TABLE `work_order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`event_type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_work_order_events_order_created` ON `work_order_events` (`work_order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `work_order_part_usages` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`part_id` text NOT NULL,
	`movement_id` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_cost_snapshot` real NOT NULL,
	`total_cost` real NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`movement_id`) REFERENCES `inventory_movements`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_part_usage_work_order` ON `work_order_part_usages` (`work_order_id`);--> statement-breakpoint
CREATE TABLE `work_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`asset_id` text,
	`functional_location_id` text NOT NULL,
	`requested_by_id` text NOT NULL,
	`number` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`type` text NOT NULL,
	`source` text NOT NULL,
	`requested_at` text NOT NULL,
	`due_at` text,
	`planned_start` text,
	`planned_end` text,
	`actual_start` text,
	`actual_end` text,
	`estimated_minutes` integer DEFAULT 60 NOT NULL,
	`downtime_minutes` integer DEFAULT 0 NOT NULL,
	`diagnosis` text,
	`solution` text,
	`failure_mode` text,
	`failure_cause` text,
	`production_impact` text DEFAULT 'NONE' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`functional_location_id`) REFERENCES `functional_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_work_orders_status" CHECK("work_orders"."status" in ('REQUESTED','TRIAGE','APPROVED','PLANNED','SCHEDULED','ASSIGNED','IN_PROGRESS','PAUSED','WAITING_PART','WAITING_VENDOR','COMPLETED','CLOSED','CANCELLED')),
	CONSTRAINT "ck_work_orders_priority" CHECK("work_orders"."priority" in ('P1_EMERGENCY','P2_URGENT','P3_HIGH','P4_NORMAL','P5_LOW')),
	CONSTRAINT "ck_work_orders_type" CHECK("work_orders"."type" in ('CORRECTIVE','PREVENTIVE','INSPECTION','PREDICTIVE','CALIBRATION','IMPROVEMENT'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_orders_org_number` ON `work_orders` (`organization_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_work_orders_site_status_due` ON `work_orders` (`site_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_work_orders_asset_created` ON `work_orders` (`asset_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_work_orders_site_planned` ON `work_orders` (`site_id`,`planned_start`);