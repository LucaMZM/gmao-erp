CREATE TABLE `_mutation_assertions` (
  `affected_rows` integer NOT NULL,
  CONSTRAINT `ck_atomic_mutation_applied` CHECK (`affected_rows` = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_labor_one_active_user` ON `labor_sessions` (`user_id`) WHERE `ended_at` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_downtime_one_active_order` ON `downtime_events` (`work_order_id`) WHERE `ended_at` IS NULL AND `work_order_id` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `trg_work_order_finalization_guard` BEFORE UPDATE OF status ON work_orders
WHEN NEW.status IN ('COMPLETED','CLOSED','CANCELLED') AND NEW.status <> OLD.status
BEGIN SELECT RAISE(ABORT,'ACTIVE_LABOR_SESSION_EXISTS') WHERE EXISTS (SELECT 1 FROM labor_sessions WHERE work_order_id=NEW.id AND ended_at IS NULL); SELECT RAISE(ABORT,'ACTIVE_DOWNTIME_EXISTS') WHERE EXISTS (SELECT 1 FROM downtime_events WHERE work_order_id=NEW.id AND ended_at IS NULL); SELECT RAISE(ABORT,'RESERVED_MATERIALS') WHERE NEW.status IN ('CLOSED','CANCELLED') AND EXISTS (SELECT 1 FROM work_order_materials WHERE work_order_id=NEW.id AND reserved_quantity>0); END;
--> statement-breakpoint
CREATE TRIGGER `trg_material_final_order_guard` BEFORE UPDATE ON work_order_materials
WHEN EXISTS (SELECT 1 FROM work_orders WHERE id=NEW.work_order_id AND status IN ('CLOSED','CANCELLED'))
BEGIN SELECT RAISE(ABORT,'FINAL_WORK_ORDER'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_downtime_final_order_guard` BEFORE INSERT ON downtime_events
WHEN NEW.ended_at IS NULL AND EXISTS (SELECT 1 FROM work_orders WHERE id=NEW.work_order_id AND status IN ('COMPLETED','CLOSED','CANCELLED'))
BEGIN SELECT RAISE(ABORT,'FINAL_WORK_ORDER'); END;
