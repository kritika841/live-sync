ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS document_json TEXT NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_orders_status_date ON orders (UPPER(TRIM(status)), (COALESCE(NULLIF(order_date,''),created_at)) DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_orders_confirmation_date ON orders (confirmation_status,confirmed_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_confirmation_attempt_order ON confirmation_attempts (order_id,attempt_number,id);
CREATE INDEX IF NOT EXISTS idx_assignments_campaign ON campaign_assignments (campaign_id,position,order_id);
