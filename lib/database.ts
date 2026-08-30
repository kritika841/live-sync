import { env as cloudflareEnv } from "cloudflare:workers";

export type RuntimeEnv = {
  DB: D1Database;
  SHIPROCKET_EMAIL?: string;
  SHIPROCKET_PASSWORD?: string;
  SHIPROCKET_CHANNEL_NAME?: string;
  SHIPROCKET_CHANNEL_ID?: string;
  SHIPROCKET_WEBHOOK_SECRET?: string;
};

export function getRuntimeEnv(): RuntimeEnv {
  return cloudflareEnv as unknown as RuntimeEnv;
}

export async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY, channel_order_id TEXT NOT NULL, channel_id INTEGER NOT NULL,
        channel_name TEXT NOT NULL, customer_name TEXT NOT NULL DEFAULT '',
        customer_email TEXT NOT NULL DEFAULT '', customer_phone TEXT NOT NULL DEFAULT '',
        customer_city TEXT NOT NULL DEFAULT '', customer_state TEXT NOT NULL DEFAULT '',
        order_date TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '', delivered_at TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        status_code INTEGER, payment_method TEXT NOT NULL DEFAULT '',
        payment_status TEXT NOT NULL DEFAULT '', total REAL NOT NULL DEFAULT 0,
        pickup_location TEXT NOT NULL DEFAULT '', awb TEXT NOT NULL DEFAULT '',
        courier TEXT NOT NULL DEFAULT '', shipment_id INTEGER,
        products_json TEXT NOT NULL DEFAULT '[]', raw_json TEXT NOT NULL DEFAULT '{}',
        synced_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, shiprocket_order_id INTEGER,
        channel_order_id TEXT, shipment_id INTEGER, awb TEXT, status TEXT,
        payload_json TEXT NOT NULL, received_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL,
        event_type TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info',
        message TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )
    `),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_orders_channel_status ON orders (channel_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders (order_date DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_orders_delivered_at ON orders (delivered_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_orders_channel_order_id ON orders (channel_order_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_orders_awb ON orders (awb)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events (received_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at DESC)"),
    db.prepare("PRAGMA optimize"),
  ]);
}

export async function logActivity(
  db: D1Database,
  source: string,
  eventType: string,
  message: string,
  details: Record<string, unknown> = {},
  level = "info",
) {
  await db.prepare(`
    INSERT INTO activity_logs (source, event_type, level, message, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(source, eventType, level, message, JSON.stringify(details), new Date().toISOString()).run();
}

export async function setSyncState(db: D1Database, key: string, value: string) {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind(key, value, now).run();
}
