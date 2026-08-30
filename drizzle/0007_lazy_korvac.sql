ALTER TABLE `orders` ADD `shipped_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `first_out_for_delivery_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `ndr_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `ndr_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `ndr_raised_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `ndr_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_cost` real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_orders_shipped_at` ON `orders` (`shipped_at`);