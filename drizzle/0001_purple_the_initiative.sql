DROP INDEX `idx_notifications_user_read`;--> statement-breakpoint
ALTER TABLE `notifications` ADD `organization_id` text REFERENCES organizations(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `notifications` ADD `site_id` text REFERENCES sites(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `idx_notifications_user_site_read` ON `notifications` (`user_id`,`site_id`,`read_at`);
