import { ensureSchema, getRuntimeEnv } from "../database";
const statements: string[] = [
  "-- Additive PostgreSQL extension. Apply after the existing inventory foundation.\nALTER TABLE inventory_components ADD COLUMN IF NOT EXISTS grams_per_pack NUMERIC(18,6) CHECK (grams_per_pack > 0);\n",
  "\nALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS vendor_order_number TEXT NOT NULL DEFAULT '';\n",
  "\nALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS purchase_unit TEXT NOT NULL DEFAULT 'unit';\n",
  "\nALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK(conversion_factor > 0);\n",
  "\nALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS request_key TEXT UNIQUE;\n",
  "\nALTER TABLE goods_receipt_lines ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC(18,6) NOT NULL DEFAULT 1;\n",
  "\nCREATE TABLE IF NOT EXISTS manual_sales (id TEXT PRIMARY KEY, sale_number TEXT NOT NULL UNIQUE, customer_name TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES inventory_products(id), quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0), amount NUMERIC(18,2) NOT NULL CHECK(amount>=0), recipe_snapshot JSONB NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());\n",
  "\nCREATE TABLE IF NOT EXISTS inventory_order_allocations (id TEXT PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id), component_id TEXT NOT NULL REFERENCES inventory_components(id), required NUMERIC(18,6) NOT NULL CHECK(required>0), state TEXT NOT NULL CHECK(state IN ('reserved','consumed','released','returned')), recipe_snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(order_id,component_id));\n",
  "\nCREATE TABLE IF NOT EXISTS support_mailboxes (email TEXT PRIMARY KEY, encrypted_refresh_token TEXT NOT NULL DEFAULT '', history_id TEXT NOT NULL DEFAULT '', import_cursor TEXT NOT NULL DEFAULT '', import_since TEXT NOT NULL DEFAULT '', import_complete BOOLEAN NOT NULL DEFAULT FALSE, watch_expiration BIGINT NOT NULL DEFAULT 0, last_sync_at TIMESTAMPTZ, last_error TEXT NOT NULL DEFAULT '', connected_by TEXT NOT NULL, sync_lease_until TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());\n",
  "\nCREATE TABLE IF NOT EXISTS support_agents (user_id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('support_agent','support_manager','admin')), available BOOLEAN NOT NULL DEFAULT TRUE);\n",
  "\nCREATE TABLE IF NOT EXISTS support_tickets (id TEXT PRIMARY KEY, ticket_number BIGSERIAL UNIQUE, mailbox TEXT NOT NULL REFERENCES support_mailboxes(email), gmail_thread_id TEXT NOT NULL, subject TEXT NOT NULL, customer_email TEXT NOT NULL, customer_name TEXT NOT NULL DEFAULT '', assignee_id TEXT REFERENCES support_agents(user_id), status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','waiting','escalated','resolved')), priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')), order_id BIGINT REFERENCES orders(id), version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(mailbox,gmail_thread_id));\n",
  "\nCREATE TABLE IF NOT EXISTS support_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id), gmail_message_id TEXT UNIQUE, message_id TEXT NOT NULL DEFAULT '', direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound','note')), sender TEXT NOT NULL, recipients TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, attachments JSONB NOT NULL DEFAULT '[]', delivery_status TEXT NOT NULL DEFAULT 'received' CHECK(delivery_status IN ('received','queued','sending','sent','failed','uncertain','note')), request_key TEXT UNIQUE, resolve_after_send BOOLEAN NOT NULL DEFAULT FALSE, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now());\n",
  "\nCREATE TABLE IF NOT EXISTS support_events (id BIGSERIAL PRIMARY KEY, ticket_id TEXT REFERENCES support_tickets(id), actor_id TEXT NOT NULL, action TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now());\n",
  "\nCREATE INDEX IF NOT EXISTS idx_support_queue ON support_tickets(assignee_id,status,updated_at DESC);\n",
  "\nCREATE INDEX IF NOT EXISTS idx_support_messages ON support_messages(ticket_id,created_at);\n",
  "\nCREATE INDEX IF NOT EXISTS idx_support_outbox ON support_messages(delivery_status,created_at) WHERE direction='outbound';\n",
  "\nDO $$ DECLARE t TEXT; r TEXT; BEGIN\n FOREACH t IN ARRAY ARRAY['app_schema_migrations','component_types','inventory_components','inventory_products','recipe_versions','recipe_items','suppliers','purchase_orders','purchase_order_lines','goods_receipts','goods_receipt_lines','supplier_invoices','supplier_invoice_lines','component_ledger','order_requirement_sets','order_requirements','provider_event_inbox','inventory_audit_events','manual_sales','inventory_order_allocations','support_mailboxes','support_agents','support_tickets','support_messages','support_events'] LOOP\n  IF to_regclass('public.' || t) IS NOT NULL THEN\n   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);\n   FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP\n    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r); END IF;\n   END LOOP;\n  END IF;\n END LOOP;\nEND $$;\n",
];
let ready: Promise<void> | undefined;
export async function operationsDb() {
  const db = getRuntimeEnv().DB;
  await ensureSchema(db);
  ready ??= (async()=>{
    const exists = await db.prepare("SELECT to_regclass('public.operations_schema_versions') name").first<{name:string}>();
    if(exists?.name && await db.prepare("SELECT version FROM operations_schema_versions WHERE version='0016_po_documents_performance'").first())return;
    await db.transaction(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(421995)`;
      await sql`CREATE TABLE IF NOT EXISTS operations_schema_versions (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
      await sql`ALTER TABLE operations_schema_versions ENABLE ROW LEVEL SECURITY`;
      const [version] =
        await sql`SELECT version FROM operations_schema_versions WHERE version='0012_operations'`;
      if (!version) {
        for (const statement of statements) await sql.unsafe(statement);
        await sql`INSERT INTO operations_schema_versions(version) VALUES('0012_operations')`;
      }
      const [outboxVersion] =
        await sql`SELECT version FROM operations_schema_versions WHERE version='0013_support_outbox'`;
      if (!outboxVersion) {
        await sql`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS send_started_at TIMESTAMPTZ`;
        await sql`INSERT INTO operations_schema_versions(version) VALUES('0013_support_outbox')`;
      }
      const [documentsVersion]=await sql`SELECT version FROM operations_schema_versions WHERE version='0014_documents_security'`;
      if(!documentsVersion){
        await sql.unsafe(DOCUMENTS_MIGRATION);
        await sql`INSERT INTO operations_schema_versions(version) VALUES('0014_documents_security')`;
      }
      const [receivingVersion] = await sql`SELECT version FROM operations_schema_versions WHERE version='0015_invoice_receiving'`;
      if (!receivingVersion) {
        await sql.unsafe(RECEIVING_MIGRATION);
        await sql`INSERT INTO operations_schema_versions(version) VALUES('0015_invoice_receiving')`;
      }
      const [performanceVersion]=await sql`SELECT version FROM operations_schema_versions WHERE version='0016_po_documents_performance'`;
      if(!performanceVersion){await sql.unsafe(PO_PERFORMANCE_MIGRATION);await sql`INSERT INTO operations_schema_versions(version) VALUES('0016_po_documents_performance')`;}
      const [inventoryReadVersion]=await sql`SELECT version FROM operations_schema_versions WHERE version='0017_inventory_read_performance'`;
      if(!inventoryReadVersion){await sql.unsafe(INVENTORY_READ_PERFORMANCE_MIGRATION);await sql`INSERT INTO operations_schema_versions(version) VALUES('0017_inventory_read_performance')`;}
    });
  })()
    .catch((e) => {
      ready = undefined;
      throw e;
    });
  await ready;
  return db;
}

const DOCUMENTS_MIGRATION = "CREATE TABLE IF NOT EXISTS procurement_documents (\n id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('po','invoice')), entity_id TEXT NOT NULL,\n storage_key TEXT NOT NULL, file_hash TEXT NOT NULL UNIQUE, filename TEXT NOT NULL,\n extracted_text TEXT NOT NULL, review_json JSONB NOT NULL, created_by TEXT NOT NULL,\n created_at TIMESTAMPTZ NOT NULL DEFAULT now()\n);\nALTER TABLE procurement_documents ENABLE ROW LEVEL SECURITY;\nDO $$ DECLARE t TEXT; r TEXT; BEGIN\n FOREACH t IN ARRAY ARRAY['procurement_documents','operations_schema_versions','orders','sync_state','webhook_events','activity_logs','sync_reports','sync_report_items','campaigns','campaign_assignments','confirmation_attempts'] LOOP\n  IF to_regclass('public.' || t) IS NOT NULL THEN\n   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);\n   FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP\n    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r); END IF;\n   END LOOP;\n  END IF;\n END LOOP;\nEND $$;\n";

const RECEIVING_MIGRATION = `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_details TEXT NOT NULL DEFAULT '';
ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS supplier_invoice_id TEXT REFERENCES supplier_invoices(id);
`;

const PO_PERFORMANCE_MIGRATION = `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS document_json TEXT NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_orders_status_date ON orders (UPPER(TRIM(status)), (COALESCE(NULLIF(order_date,''),created_at)) DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_orders_confirmation_date ON orders (confirmation_status,confirmed_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_confirmation_attempt_order ON confirmation_attempts (order_id,attempt_number,id);
CREATE INDEX IF NOT EXISTS idx_assignments_campaign ON campaign_assignments (campaign_id,position,order_id);
`;

const INVENTORY_READ_PERFORMANCE_MIGRATION = `
CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_po ON purchase_order_lines (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_component_ledger_component ON component_ledger (component_id);
CREATE INDEX IF NOT EXISTS idx_inventory_allocations_component_state ON inventory_order_allocations (component_id,state);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_events_id ON inventory_audit_events (id DESC);
`;
