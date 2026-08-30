ALTER TABLE `orders` ADD `delivered_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_orders_delivered_at` ON `orders` (`delivered_at`);