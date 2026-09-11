-- Additive PostgreSQL extension. Apply after the existing inventory foundation.
ALTER TABLE inventory_components ADD COLUMN IF NOT EXISTS grams_per_pack NUMERIC(18,6) CHECK (grams_per_pack > 0);
-- statement
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS vendor_order_number TEXT NOT NULL DEFAULT '';
-- statement
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS purchase_unit TEXT NOT NULL DEFAULT 'unit';
-- statement
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK(conversion_factor > 0);
-- statement
ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS request_key TEXT UNIQUE;
-- statement
ALTER TABLE goods_receipt_lines ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC(18,6) NOT NULL DEFAULT 1;
-- statement
CREATE TABLE IF NOT EXISTS manual_sales (id TEXT PRIMARY KEY, sale_number TEXT NOT NULL UNIQUE, customer_name TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES inventory_products(id), quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0), amount NUMERIC(18,2) NOT NULL CHECK(amount>=0), recipe_snapshot JSONB NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- statement
CREATE TABLE IF NOT EXISTS inventory_order_allocations (id TEXT PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id), component_id TEXT NOT NULL REFERENCES inventory_components(id), required NUMERIC(18,6) NOT NULL CHECK(required>0), state TEXT NOT NULL CHECK(state IN ('reserved','consumed','released','returned')), recipe_snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(order_id,component_id));
-- statement
CREATE TABLE IF NOT EXISTS support_mailboxes (email TEXT PRIMARY KEY, encrypted_refresh_token TEXT NOT NULL DEFAULT '', history_id TEXT NOT NULL DEFAULT '', import_cursor TEXT NOT NULL DEFAULT '', import_since TEXT NOT NULL DEFAULT '', import_complete BOOLEAN NOT NULL DEFAULT FALSE, watch_expiration BIGINT NOT NULL DEFAULT 0, last_sync_at TIMESTAMPTZ, last_error TEXT NOT NULL DEFAULT '', connected_by TEXT NOT NULL, sync_lease_until TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- statement
CREATE TABLE IF NOT EXISTS support_agents (user_id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('support_agent','support_manager','admin')), available BOOLEAN NOT NULL DEFAULT TRUE);
-- statement
CREATE TABLE IF NOT EXISTS support_tickets (id TEXT PRIMARY KEY, ticket_number BIGSERIAL UNIQUE, mailbox TEXT NOT NULL REFERENCES support_mailboxes(email), gmail_thread_id TEXT NOT NULL, subject TEXT NOT NULL, customer_email TEXT NOT NULL, customer_name TEXT NOT NULL DEFAULT '', assignee_id TEXT REFERENCES support_agents(user_id), status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','waiting','escalated','resolved')), priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')), order_id BIGINT REFERENCES orders(id), version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(mailbox,gmail_thread_id));
-- statement
CREATE TABLE IF NOT EXISTS support_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id), gmail_message_id TEXT UNIQUE, message_id TEXT NOT NULL DEFAULT '', direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound','note')), sender TEXT NOT NULL, recipients TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, attachments JSONB NOT NULL DEFAULT '[]', delivery_status TEXT NOT NULL DEFAULT 'received' CHECK(delivery_status IN ('received','queued','sending','sent','failed','uncertain','note')), request_key TEXT UNIQUE, resolve_after_send BOOLEAN NOT NULL DEFAULT FALSE, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- statement
CREATE TABLE IF NOT EXISTS support_events (id BIGSERIAL PRIMARY KEY, ticket_id TEXT REFERENCES support_tickets(id), actor_id TEXT NOT NULL, action TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- statement
CREATE INDEX IF NOT EXISTS idx_support_queue ON support_tickets(assignee_id,status,updated_at DESC);
-- statement
CREATE INDEX IF NOT EXISTS idx_support_messages ON support_messages(ticket_id,created_at);
-- statement
CREATE INDEX IF NOT EXISTS idx_support_outbox ON support_messages(delivery_status,created_at) WHERE direction='outbound';
-- statement
DO $$ DECLARE t TEXT; r TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['app_schema_migrations','component_types','inventory_components','inventory_products','recipe_versions','recipe_items','suppliers','purchase_orders','purchase_order_lines','goods_receipts','goods_receipt_lines','supplier_invoices','supplier_invoice_lines','component_ledger','order_requirement_sets','order_requirements','provider_event_inbox','inventory_audit_events','manual_sales','inventory_order_allocations','support_mailboxes','support_agents','support_tickets','support_messages','support_events'] LOOP
  IF to_regclass('public.' || t) IS NOT NULL THEN
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r); END IF;
   END LOOP;
  END IF;
 END LOOP;
END $$;
