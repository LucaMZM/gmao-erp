CREATE TABLE `import_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE restrict,
  `site_id` text NOT NULL REFERENCES `sites`(`id`) ON DELETE restrict,
  `actor_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE restrict,
  `kind` text NOT NULL CHECK (`kind` IN ('LOCATIONS','ASSETS','PARTS','SUPPLIERS')),
  `source_hash` text NOT NULL,
  `source_name` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('RUNNING','COMPLETE','PARTIAL')),
  `summary_json` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_import_jobs_source` ON `import_jobs` (`organization_id`,`site_id`,`kind`,`source_hash`);
--> statement-breakpoint
CREATE INDEX `idx_import_jobs_site_created` ON `import_jobs` (`site_id`,`created_at`);
