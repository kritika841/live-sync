ALTER TABLE `orders` ADD `out_for_delivery_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_orders_out_for_delivery_at` ON `orders` (`out_for_delivery_at`);