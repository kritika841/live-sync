CREATE TABLE `sync_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mode` text NOT NULL,
	`source` text NOT NULL,
	`checked` integer DEFAULT 0 NOT NULL,
	`new_orders` integer DEFAULT 0 NOT NULL,
	`changed_orders` integer DEFAULT 0 NOT NULL,
	`unchanged_orders` integer DEFAULT 0 NOT NULL,
	`discrepancies_total` integer DEFAULT 0 NOT NULL,
	`ndr_records` integer DEFAULT 0 NOT NULL,
	`ndr_enriched` integer DEFAULT 0 NOT NULL,
	`fields_json` text DEFAULT '{}' NOT NULL,
	`changes_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sync_reports_created_at` ON `sync_reports` (`created_at`);