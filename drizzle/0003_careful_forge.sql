CREATE TABLE `__new_work_order_part_usages` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`part_id` text NOT NULL,
	`movement_id` text NOT NULL,
	`usage_type` text DEFAULT 'CONSUMPTION' NOT NULL,
	`quantity` real NOT NULL,
	`unit_cost_snapshot` real NOT NULL,
	`total_cost` real NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`movement_id`) REFERENCES `inventory_movements`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_part_usage_type" CHECK("usage_type" in ('CONSUMPTION','RETURN'))
);
--> statement-breakpoint
INSERT INTO `__new_work_order_part_usages`("id", "work_order_id", "part_id", "movement_id", "usage_type", "quantity", "unit_cost_snapshot", "total_cost", "created_at") SELECT "id", "work_order_id", "part_id", "movement_id", 'CONSUMPTION', "quantity", "unit_cost_snapshot", "total_cost", "created_at" FROM `work_order_part_usages`;--> statement-breakpoint
DROP TABLE `work_order_part_usages`;--> statement-breakpoint
ALTER TABLE `__new_work_order_part_usages` RENAME TO `work_order_part_usages`;--> statement-breakpoint
CREATE INDEX `idx_part_usage_work_order` ON `work_order_part_usages` (`work_order_id`);
