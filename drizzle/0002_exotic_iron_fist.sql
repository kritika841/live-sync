CREATE TABLE `activity_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`event_type` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_activity_logs_created_at` ON `activity_logs` (`created_at`);