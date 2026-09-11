CREATE TABLE IF NOT EXISTS procurement_documents (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('po','invoice')), entity_id TEXT NOT NULL,
 storage_key TEXT NOT NULL, file_hash TEXT NOT NULL UNIQUE, filename TEXT NOT NULL,
 extracted_text TEXT NOT NULL, review_json JSONB NOT NULL, created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE procurement_documents ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t TEXT; r TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['procurement_documents','operations_schema_versions','orders','sync_state','webhook_events','activity_logs','sync_reports','sync_report_items','campaigns','campaign_assignments','confirmation_attempts'] LOOP
  IF to_regclass('public.' || t) IS NOT NULL THEN
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r); END IF;
   END LOOP;
  END IF;
 END LOOP;
END $$;
