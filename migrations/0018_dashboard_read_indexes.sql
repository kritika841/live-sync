-- Apply outside a transaction; concurrent builds avoid blocking live writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_order_event ON webhook_events (shiprocket_order_id, event_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_shipment_event ON webhook_events (shipment_id, event_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_awb_event ON webhook_events (awb, event_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_channel_event ON webhook_events (channel_order_id, event_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_shipment_id ON orders (shipment_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_channel_order_date ON orders (channel_id, order_date);
