CREATE TRIGGER `trg_audit_entries_append_only_update`
BEFORE UPDATE ON `audit_entries`
BEGIN SELECT RAISE(ABORT, 'audit_entries is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_audit_entries_append_only_delete`
BEFORE DELETE ON `audit_entries`
BEGIN SELECT RAISE(ABORT, 'audit_entries is append-only'); END;
--> statement-breakpoint
CREATE UNIQUE INDEX `production_calendars_site_default_unique`
ON `production_calendars` (`site_id`)
WHERE `functional_location_id` IS NULL;
