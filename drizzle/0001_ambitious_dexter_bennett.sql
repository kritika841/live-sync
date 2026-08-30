CREATE INDEX `idx_orders_channel_status` ON `orders` (`channel_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_order_date` ON `orders` (`order_date`);--> statement-breakpoint
CREATE INDEX `idx_orders_channel_order_id` ON `orders` (`channel_order_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_awb` ON `orders` (`awb`);--> statement-breakpoint
CREATE INDEX `idx_webhook_events_received_at` ON `webhook_events` (`received_at`);