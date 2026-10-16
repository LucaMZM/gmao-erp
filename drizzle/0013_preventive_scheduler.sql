CREATE TABLE `scheduler_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `job_key` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('RUNNING','COMPLETE','PARTIAL','FAILED')),
  `started_at` text NOT NULL,
  `finished_at` text,
  `scanned` integer NOT NULL DEFAULT 0,
  `created` integer NOT NULL DEFAULT 0,
  `already_generated` integer NOT NULL DEFAULT 0,
  `errors_json` text NOT NULL DEFAULT '[]'
);
--> statement-breakpoint
CREATE INDEX `idx_scheduler_runs_job_started` ON `scheduler_runs` (`job_key`,`started_at`);
