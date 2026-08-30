CREATE TABLE `orders` (
	`id` integer PRIMARY KEY NOT NULL,
	`channel_order_id` text NOT NULL,
	`channel_id` integer NOT NULL,
	`channel_name` text NOT NULL,
	`customer_name` text DEFAULT '' NOT NULL,
	`customer_email` text DEFAULT '' NOT NULL,
	`customer_phone` text DEFAULT '' NOT NULL,
	`customer_city` text DEFAULT '' NOT NULL,
	`customer_state` text DEFAULT '' NOT NULL,
	`order_date` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '' NOT NULL,
	`status_code` integer,
	`payment_method` text DEFAULT '' NOT NULL,
	`payment_status` text DEFAULT '' NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`pickup_location` text DEFAULT '' NOT NULL,
	`awb` text DEFAULT '' NOT NULL,
	`courier` text DEFAULT '' NOT NULL,
	`shipment_id` integer,
	`products_json` text DEFAULT '[]' NOT NULL,
	`raw_json` text DEFAULT '{}' NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shiprocket_order_id` integer,
	`channel_order_id` text,
	`shipment_id` integer,
	`awb` text,
	`status` text,
	`payload_json` text NOT NULL,
	`received_at` text NOT NULL
);
