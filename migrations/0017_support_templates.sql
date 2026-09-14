CREATE TABLE IF NOT EXISTS support_reply_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_reply_templates_updated
  ON support_reply_templates(updated_at DESC);

INSERT INTO support_reply_templates(id,name,body,created_by,updated_by) VALUES
  ('support-template-acknowledgement','Acknowledgement','Hi {{customer_name}},\n\nThanks for getting in touch. We have received your request and are looking into it. We will update you shortly.\n\nRegards,\nSatmi Support','system','system'),
  ('support-template-order-update','Order status update','Hi {{customer_name}},\n\nThanks for your patience. We are checking the latest update for your order and will share the details as soon as possible.\n\nRegards,\nSatmi Support','system','system'),
  ('support-template-resolution','Resolution confirmation','Hi {{customer_name}},\n\nYour request has been resolved. Please reply to this email if you need any further help.\n\nRegards,\nSatmi Support','system','system')
ON CONFLICT(name) DO NOTHING;
