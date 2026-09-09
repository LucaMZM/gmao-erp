CREATE TABLE `goods_receipt_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`goods_receipt_id` text NOT NULL,
	`purchase_order_line_id` text NOT NULL,
	`part_id` text NOT NULL,
	`bin_id` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_cost_snapshot` real NOT NULL,
	`total_cost` real NOT NULL,
	FOREIGN KEY (`goods_receipt_id`) REFERENCES `goods_receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_order_line_id`) REFERENCES `purchase_order_lines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bin_id`) REFERENCES `warehouse_bins`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_goods_receipt_line_quantity" CHECK("goods_receipt_lines"."quantity" > 0),
	CONSTRAINT "ck_goods_receipt_line_cost" CHECK("goods_receipt_lines"."unit_cost_snapshot" >= 0 and "goods_receipt_lines"."total_cost" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_goods_receipt_line_order_line` ON `goods_receipt_lines` (`goods_receipt_id`,`purchase_order_line_id`);--> statement-breakpoint
CREATE TABLE `goods_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`purchase_order_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`number` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`external_reference` text,
	`received_by_id` text NOT NULL,
	`received_at` text NOT NULL,
	`status` text DEFAULT 'POSTED' NOT NULL,
	`total_cost` real NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`received_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_goods_receipt_org_number` ON `goods_receipts` (`organization_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_goods_receipt_idempotency` ON `goods_receipts` (`organization_id`,`site_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_goods_receipt_order_received` ON `goods_receipts` (`purchase_order_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `part_substitutes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`part_id` text NOT NULL,
	`substitute_part_id` text NOT NULL,
	`approval_status` text DEFAULT 'APPROVED' NOT NULL,
	`note` text,
	`approved_by_id` text,
	`approved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`substitute_part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_part_substitute_distinct" CHECK("part_substitutes"."part_id" <> "part_substitutes"."substitute_part_id"),
	CONSTRAINT "ck_part_substitute_status" CHECK("part_substitutes"."approval_status" in ('APPROVED','PENDING','REJECTED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_part_substitute` ON `part_substitutes` (`part_id`,`substitute_part_id`);--> statement-breakpoint
CREATE TABLE `part_vendor_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`part_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`vendor_sku` text NOT NULL,
	`manufacturer` text,
	`unit_price` real NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`minimum_order_quantity` real DEFAULT 1 NOT NULL,
	`lead_time_days` integer NOT NULL,
	`preferred` integer DEFAULT false NOT NULL,
	`price_at` text NOT NULL,
	`valid_until` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_part_vendor_offer_price" CHECK("part_vendor_offers"."unit_price" >= 0),
	CONSTRAINT "ck_part_vendor_offer_moq" CHECK("part_vendor_offers"."minimum_order_quantity" > 0),
	CONSTRAINT "ck_part_vendor_offer_lead" CHECK("part_vendor_offers"."lead_time_days" >= 0),
	CONSTRAINT "ck_part_vendor_offer_status" CHECK("part_vendor_offers"."status" in ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_part_vendor_offer_reference` ON `part_vendor_offers` (`part_id`,`vendor_id`,`vendor_sku`,`price_at`);--> statement-breakpoint
CREATE INDEX `idx_part_vendor_offer_part_status` ON `part_vendor_offers` (`part_id`,`status`);--> statement-breakpoint
CREATE TABLE `procurement_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`event_type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_procurement_event_entity_created` ON `procurement_events` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_procurement_event_site_created` ON `procurement_events` (`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `purchase_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_order_id` text NOT NULL,
	`part_id` text NOT NULL,
	`vendor_offer_id` text,
	`vendor_sku_snapshot` text NOT NULL,
	`description_snapshot` text NOT NULL,
	`ordered_quantity` real NOT NULL,
	`received_quantity` real DEFAULT 0 NOT NULL,
	`unit_price_snapshot` real NOT NULL,
	`line_total` real NOT NULL,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`vendor_offer_id`) REFERENCES `part_vendor_offers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_purchase_order_line_quantities" CHECK("purchase_order_lines"."ordered_quantity" > 0 and "purchase_order_lines"."received_quantity" >= 0 and "purchase_order_lines"."received_quantity" <= "purchase_order_lines"."ordered_quantity"),
	CONSTRAINT "ck_purchase_order_line_cost" CHECK("purchase_order_lines"."unit_price_snapshot" >= 0 and "purchase_order_lines"."line_total" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_purchase_order_line_part` ON `purchase_order_lines` (`purchase_order_id`,`part_id`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`requisition_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`destination_bin_id` text NOT NULL,
	`number` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`ordered_at` text,
	`expected_at` text,
	`sent_at` text,
	`received_at` text,
	`cancelled_at` text,
	`subtotal` real NOT NULL,
	`tax_rate` real DEFAULT 21 NOT NULL,
	`tax_amount` real NOT NULL,
	`total` real NOT NULL,
	`created_by_id` text NOT NULL,
	`approved_by_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requisition_id`) REFERENCES `purchase_requisitions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`destination_bin_id`) REFERENCES `warehouse_bins`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_purchase_order_status" CHECK("purchase_orders"."status" in ('DRAFT','APPROVED','SENT','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
	CONSTRAINT "ck_purchase_order_totals" CHECK("purchase_orders"."subtotal" >= 0 and "purchase_orders"."tax_rate" >= 0 and "purchase_orders"."tax_amount" >= 0 and "purchase_orders"."total" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_purchase_order_org_number` ON `purchase_orders` (`organization_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_purchase_order_requisition` ON `purchase_orders` (`requisition_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_order_site_status_expected` ON `purchase_orders` (`site_id`,`status`,`expected_at`);--> statement-breakpoint
CREATE TABLE `purchase_requisition_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_requisition_id` text NOT NULL,
	`part_id` text NOT NULL,
	`quantity` real NOT NULL,
	`available_snapshot` real NOT NULL,
	`on_order_snapshot` real NOT NULL,
	`note` text,
	FOREIGN KEY (`purchase_requisition_id`) REFERENCES `purchase_requisitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_purchase_requisition_line_quantity" CHECK("purchase_requisition_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_purchase_requisition_line_part` ON `purchase_requisition_lines` (`purchase_requisition_id`,`part_id`);--> statement-breakpoint
CREATE TABLE `purchase_requisitions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`work_order_id` text,
	`number` text NOT NULL,
	`origin` text NOT NULL,
	`urgency` text DEFAULT 'ROUTINE' NOT NULL,
	`need_by` text,
	`justification` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`requested_by_id` text NOT NULL,
	`approved_by_id` text,
	`approved_at` text,
	`decision_reason` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_purchase_requisition_origin" CHECK("purchase_requisitions"."origin" in ('WORK_ORDER','LOW_STOCK','STOCKOUT','MANUAL','PLANNING')),
	CONSTRAINT "ck_purchase_requisition_urgency" CHECK("purchase_requisitions"."urgency" in ('ROUTINE','HIGH','CRITICAL')),
	CONSTRAINT "ck_purchase_requisition_status" CHECK("purchase_requisitions"."status" in ('DRAFT','SUBMITTED','APPROVED','REJECTED','CONVERTED','CANCELLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_purchase_requisition_org_number` ON `purchase_requisitions` (`organization_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_purchase_requisition_site_status` ON `purchase_requisitions` (`site_id`,`status`,`need_by`);--> statement-breakpoint
CREATE INDEX `idx_purchase_requisition_work_order` ON `purchase_requisitions` (`work_order_id`);--> statement-breakpoint
CREATE TABLE `stock_transfer_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`stock_transfer_id` text NOT NULL,
	`part_id` text NOT NULL,
	`from_bin_id` text NOT NULL,
	`to_bin_id` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_cost_snapshot` real NOT NULL,
	FOREIGN KEY (`stock_transfer_id`) REFERENCES `stock_transfers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`from_bin_id`) REFERENCES `warehouse_bins`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_bin_id`) REFERENCES `warehouse_bins`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_stock_transfer_line_quantity" CHECK("stock_transfer_lines"."quantity" > 0),
	CONSTRAINT "ck_stock_transfer_line_bins" CHECK("stock_transfer_lines"."from_bin_id" <> "stock_transfer_lines"."to_bin_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stock_transfer_line` ON `stock_transfer_lines` (`stock_transfer_id`,`part_id`,`from_bin_id`,`to_bin_id`);--> statement-breakpoint
CREATE TABLE `stock_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text NOT NULL,
	`number` text NOT NULL,
	`from_warehouse_id` text NOT NULL,
	`to_warehouse_id` text NOT NULL,
	`requested_by_id` text NOT NULL,
	`status` text DEFAULT 'CREATED' NOT NULL,
	`note` text,
	`shipped_at` text,
	`received_at` text,
	`cancelled_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_stock_transfer_status" CHECK("stock_transfers"."status" in ('CREATED','IN_TRANSIT','RECEIVED','CANCELLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stock_transfer_org_number` ON `stock_transfers` (`organization_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_stock_transfer_site_status` ON `stock_transfers` (`site_id`,`status`);--> statement-breakpoint
CREATE TABLE `warehouse_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_warehouse_zone_code` ON `warehouse_zones` (`warehouse_id`,`code`);--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD `purchase_order_id` text REFERENCES purchase_orders(id);--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD `goods_receipt_id` text REFERENCES goods_receipts(id);--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD `stock_transfer_id` text REFERENCES stock_transfers(id);--> statement-breakpoint
CREATE INDEX `idx_movements_purchase_order` ON `inventory_movements` (`purchase_order_id`);--> statement-breakpoint
CREATE INDEX `idx_movements_receipt` ON `inventory_movements` (`goods_receipt_id`);--> statement-breakpoint
CREATE INDEX `idx_movements_transfer` ON `inventory_movements` (`stock_transfer_id`);--> statement-breakpoint
ALTER TABLE `vendors` ADD `contact_name` text;--> statement-breakpoint
ALTER TABLE `vendors` ADD `address` text;--> statement-breakpoint
ALTER TABLE `vendors` ADD `payment_terms` text DEFAULT 'NET30' NOT NULL;--> statement-breakpoint
ALTER TABLE `vendors` ADD `currency` text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE `warehouse_bins` ADD `zone_id` text REFERENCES warehouse_zones(id);--> statement-breakpoint
ALTER TABLE `warehouses` ADD `status` text DEFAULT 'ACTIVE' NOT NULL;