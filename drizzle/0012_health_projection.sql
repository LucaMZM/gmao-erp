ALTER TABLE `assets` ADD COLUMN `health_computed_at` text;
--> statement-breakpoint
CREATE TABLE `health_dirty_assets` (
  `asset_id` text PRIMARY KEY NOT NULL REFERENCES `assets`(`id`) ON DELETE cascade,
  `site_id` text NOT NULL REFERENCES `sites`(`id`) ON DELETE cascade,
  `version` integer NOT NULL DEFAULT 1,
  `marked_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_health_dirty_site` ON `health_dirty_assets` (`site_id`,`asset_id`);
--> statement-breakpoint
INSERT INTO `health_dirty_assets` (`asset_id`,`site_id`,`version`,`marked_at`)
  SELECT `id`,`site_id`,1,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM `assets`;
--> statement-breakpoint
CREATE TRIGGER `trg_health_asset_insert` AFTER INSERT ON `assets` BEGIN
  INSERT INTO `health_dirty_assets` (`asset_id`,`site_id`,`marked_at`) VALUES (NEW.id,NEW.site_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(`asset_id`) DO UPDATE SET `version`=`version`+1,`marked_at`=excluded.`marked_at`;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_health_asset_update` AFTER UPDATE OF `status`,`criticality`,`commissioned_at` ON `assets` BEGIN
  INSERT INTO `health_dirty_assets` (`asset_id`,`site_id`,`marked_at`) VALUES (NEW.id,NEW.site_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(`asset_id`) DO UPDATE SET `version`=`version`+1,`marked_at`=excluded.`marked_at`;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_health_work_insert` AFTER INSERT ON `work_orders` BEGIN
  INSERT INTO `health_dirty_assets` (`asset_id`,`site_id`,`marked_at`) VALUES (NEW.asset_id,NEW.site_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(`asset_id`) DO UPDATE SET `version`=`version`+1,`marked_at`=excluded.`marked_at`;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_health_work_update` AFTER UPDATE ON `work_orders` BEGIN
  INSERT INTO `health_dirty_assets` (`asset_id`,`site_id`,`marked_at`) VALUES (NEW.asset_id,NEW.site_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(`asset_id`) DO UPDATE SET `version`=`version`+1,`marked_at`=excluded.`marked_at`;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_health_incident_insert` AFTER INSERT ON `incidents` WHEN NEW.asset_id IS NOT NULL BEGIN
  INSERT INTO `health_dirty_assets` (`asset_id`,`site_id`,`marked_at`) VALUES (NEW.asset_id,NEW.site_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(`asset_id`) DO UPDATE SET `version`=`version`+1,`marked_at`=excluded.`marked_at`;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_health_incident_update` AFTER UPDATE ON `incidents` WHEN NEW.asset_id IS NOT NULL BEGIN
  INSERT INTO `health_dirty_assets` (`asset_id`,`site_id`,`marked_at`) VALUES (NEW.asset_id,NEW.site_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(`asset_id`) DO UPDATE SET `version`=`version`+1,`marked_at`=excluded.`marked_at`;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_health_downtime_insert` AFTER INSERT ON `downtime_events` BEGIN
  INSERT INTO `health_dirty_assets` (`asset_id`,`site_id`,`marked_at`) VALUES (NEW.asset_id,NEW.site_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(`asset_id`) DO UPDATE SET `version`=`version`+1,`marked_at`=excluded.`marked_at`;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_health_downtime_update` AFTER UPDATE ON `downtime_events` BEGIN
  INSERT INTO `health_dirty_assets` (`asset_id`,`site_id`,`marked_at`) VALUES (NEW.asset_id,NEW.site_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(`asset_id`) DO UPDATE SET `version`=`version`+1,`marked_at`=excluded.`marked_at`;
END;
