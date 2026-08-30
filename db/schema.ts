import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey(),
  channelOrderId: text("channel_order_id").notNull(),
  channelId: integer("channel_id").notNull(),
  channelName: text("channel_name").notNull(),
  customerName: text("customer_name").notNull().default(""),
  customerEmail: text("customer_email").notNull().default(""),
  customerPhone: text("customer_phone").notNull().default(""),
  customerCity: text("customer_city").notNull().default(""),
  customerState: text("customer_state").notNull().default(""),
  orderDate: text("order_date").notNull().default(""),
  createdAt: text("created_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
  status: text("status").notNull().default(""),
  statusCode: integer("status_code"),
  paymentMethod: text("payment_method").notNull().default(""),
  paymentStatus: text("payment_status").notNull().default(""),
  total: real("total").notNull().default(0),
  pickupLocation: text("pickup_location").notNull().default(""),
  awb: text("awb").notNull().default(""),
  courier: text("courier").notNull().default(""),
  shipmentId: integer("shipment_id"),
  productsJson: text("products_json").notNull().default("[]"),
  rawJson: text("raw_json").notNull().default("{}"),
  syncedAt: text("synced_at").notNull(),
}, (table) => [
  index("idx_orders_channel_status").on(table.channelId, table.status),
  index("idx_orders_order_date").on(table.orderDate),
  index("idx_orders_channel_order_id").on(table.channelOrderId),
  index("idx_orders_awb").on(table.awb),
]);

export const syncState = sqliteTable("sync_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const webhookEvents = sqliteTable("webhook_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shiprocketOrderId: integer("shiprocket_order_id"),
  channelOrderId: text("channel_order_id"),
  shipmentId: integer("shipment_id"),
  awb: text("awb"),
  status: text("status"),
  payloadJson: text("payload_json").notNull(),
  receivedAt: text("received_at").notNull(),
}, (table) => [
  index("idx_webhook_events_received_at").on(table.receivedAt),
]);

export const activityLogs = sqliteTable("activity_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  eventType: text("event_type").notNull(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_activity_logs_created_at").on(table.createdAt),
]);
