-- Evaluate provider risk once per write, not repeatedly over every payload per panel.
SET lock_timeout='5s';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rto_risk_level TEXT GENERATED ALWAYS AS (LOWER(REPLACE(REPLACE(COALESCE(raw_json::json->>'rto_risk',''),'_',' '),'-',' '))) STORED;
CREATE INDEX IF NOT EXISTS idx_orders_risk_level ON orders (rto_risk_level, order_date);
