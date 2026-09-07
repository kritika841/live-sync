ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rejected_at TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  criteria_json TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  auto_assign BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_assignments (
  id BIGSERIAL PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position BIGINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(order_id)
);

CREATE TABLE IF NOT EXISTS confirmation_attempts (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  call_picked BOOLEAN NOT NULL DEFAULT TRUE,
  rejection_reason TEXT NOT NULL DEFAULT '',
  callback_at TEXT NOT NULL DEFAULT '',
  next_action_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_confirmation_status ON orders (confirmation_status, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_position ON campaigns (is_active, position);
CREATE INDEX IF NOT EXISTS idx_campaign_assignments_campaign ON campaign_assignments (campaign_id, position);
CREATE INDEX IF NOT EXISTS idx_confirmation_attempts_order ON confirmation_attempts (order_id, attempt_number);

INSERT INTO campaigns (id, name, description, criteria_json, position, is_active, auto_assign, created_at, updated_at)
VALUES ('cmp_default_high_rto', 'High RTO Confirmation', 'Automatically receives every High and Very High RTO order.', '{"risk":"high"}', 0, TRUE, TRUE, CURRENT_TIMESTAMP::TEXT, CURRENT_TIMESTAMP::TEXT)
ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, criteria_json=excluded.criteria_json, is_active=TRUE, auto_assign=TRUE;

INSERT INTO campaign_assignments (campaign_id, order_id, position, created_at)
SELECT 'cmp_default_high_rto', id, ROW_NUMBER() OVER (ORDER BY COALESCE(NULLIF(order_date, ''), created_at), id), CURRENT_TIMESTAMP::TEXT
FROM orders
WHERE LOWER(REPLACE(REPLACE(COALESCE(raw_json::jsonb->>'rto_risk', ''), '_', ' '), '-', ' ')) IN ('high', 'very high')
ON CONFLICT(order_id) DO NOTHING;

UPDATE orders SET confirmation_status='pending', confirmation_updated_at=CURRENT_TIMESTAMP::TEXT
WHERE confirmation_status='not_required'
  AND LOWER(REPLACE(REPLACE(COALESCE(raw_json::jsonb->>'rto_risk', ''), '_', ' '), '-', ' ')) IN ('high', 'very high')
  AND UPPER(status) NOT LIKE '%DELIVERED%'
  AND UPPER(status) NOT LIKE 'RTO%'
  AND UPPER(status) NOT LIKE '%CANCEL%';
