ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS event_at TEXT NOT NULL DEFAULT '';

UPDATE webhook_events
SET event_at = received_at
WHERE event_at = '';
