import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

type Row = Record<string, unknown>;

const resultKeyAliases: Record<string, string> = {
  channelorderid: "channelOrderId",
  channelname: "channelName",
  customername: "customerName",
  customeremail: "customerEmail",
  customerphone: "customerPhone",
  customercity: "customerCity",
  customerstate: "customerState",
  orderdate: "orderDate",
  createdat: "createdAt",
  updatedat: "updatedAt",
  deliveredat: "deliveredAt",
  shippedat: "shippedAt",
  outfordeliveryat: "outForDeliveryAt",
  firstoutfordeliveryat: "firstOutForDeliveryAt",
  paymentmethod: "paymentMethod",
  paymentstatus: "paymentStatus",
  shippingcost: "shippingCost",
  pickuplocation: "pickupLocation",
  shipmentid: "shipmentId",
  productsjson: "productsJson",
  rawjson: "rawJson",
  syncedat: "syncedAt",
  eventtype: "eventType",
  detailsjson: "detailsJson",
  fieldsjson: "fieldsJson",
  changesjson: "changesJson",
  neworders: "newOrders",
  changedorders: "changedOrders",
  unchangedorders: "unchangedOrders",
  discrepanciestotal: "discrepanciesTotal",
  ndrrecords: "ndrRecords",
  ndrenriched: "ndrEnriched",
  ndrattempts: "ndrAttempts",
  ndrraisedat: "ndrRaisedAt",
  previousundelivered: "previousUndelivered",
  confirmationstatus: "confirmationStatus",
  confirmationupdatedat: "confirmationUpdatedAt",
  confirmedat: "confirmedAt",
  rejectedat: "rejectedAt",
  customeraddress: "customerAddress",
  customerpincode: "customerPincode",
  campaignid: "campaignId",
  campaignname: "campaignName",
  campaignposition: "campaignPosition",
  orderposition: "orderPosition",
  attemptnumber: "attemptNumber",
  callpicked: "callPicked",
  callbackat: "callbackAt",
  nextactionat: "nextActionAt",
  criteriajson: "criteriaJson",
  isactive: "isActive",
  autoassign: "autoAssign",
  ordercount: "orderCount",
};

function normalizeRows(rows: Row[]) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [resultKeyAliases[key] || key, value])));
}

export type QueryResult<T> = { results: T[] };

function postgresPlaceholders(query: string) {
  let position = 0;
  return query.replace(/\?/g, () => `$${++position}`);
}

export class PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly query: (text: string, values: unknown[]) => Promise<Row[]>,
    private readonly text: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  toQuery() {
    return { text: postgresPlaceholders(this.text), values: this.values };
  }

  async all<T>(): Promise<QueryResult<T>> {
    return { results: (await this.query(this.text, this.values)) as T[] };
  }

  async first<T>(): Promise<T | null> {
    return ((await this.query(this.text, this.values))[0] as T | undefined) ?? null;
  }

  async run() {
    return { success: true, results: await this.query(this.text, this.values) };
  }
}

export class PostgresDatabase {
  private readonly query: (text: string, values: unknown[]) => Promise<Row[]>;
  private readonly sql: NeonQueryFunction<false, false>;

  constructor(connectionString: string) {
    const sql = neon(connectionString);
    this.sql = sql;
    this.query = async (text, values) =>
      normalizeRows((await sql.query(postgresPlaceholders(text), values)) as Row[]);
  }

  prepare(text: string) {
    return new PreparedStatement(this.query, text);
  }

  async batch(statements: PreparedStatement[]) {
    if (!statements.length) return [];
    const results = await this.sql.transaction(statements.map((statement) => {
      const query = statement.toQuery();
      return this.sql.query(query.text, query.values);
    }));
    return (results as Row[][]).map((rows) => ({ success: true, results: normalizeRows(rows) }));
  }
}

export type RuntimeEnv = {
  DB: PostgresDatabase;
  SHIPROCKET_EMAIL?: string;
  SHIPROCKET_PASSWORD?: string;
  SHIPROCKET_BACKUP_EMAIL?: string;
  SHIPROCKET_BACKUP_PASSWORD?: string;
  SHIPROCKET_CHANNEL_NAME?: string;
  SHIPROCKET_CHANNEL_ID?: string;
  SHIPROCKET_WEBHOOK_SECRET?: string;
};

let database: PostgresDatabase | undefined;
let schemaReady: Promise<void> | undefined;

export function getRuntimeEnv(): RuntimeEnv {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  database ??= new PostgresDatabase(connectionString);
  return {
    DB: database,
    SHIPROCKET_EMAIL: process.env.SHIPROCKET_EMAIL,
    SHIPROCKET_PASSWORD: process.env.SHIPROCKET_PASSWORD,
    SHIPROCKET_BACKUP_EMAIL: process.env.SHIPROCKET_BACKUP_EMAIL,
    SHIPROCKET_BACKUP_PASSWORD: process.env.SHIPROCKET_BACKUP_PASSWORD,
    SHIPROCKET_CHANNEL_NAME: process.env.SHIPROCKET_CHANNEL_NAME,
    SHIPROCKET_CHANNEL_ID: process.env.SHIPROCKET_CHANNEL_ID,
    SHIPROCKET_WEBHOOK_SECRET: process.env.SHIPROCKET_WEBHOOK_SECRET,
  };
}

export async function ensureSchema(db: PostgresDatabase) {
  schemaReady ??= createSchema(db).catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

async function createSchema(db: PostgresDatabase) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS orders (
        id BIGINT PRIMARY KEY, channel_order_id TEXT NOT NULL, channel_id INTEGER NOT NULL,
        channel_name TEXT NOT NULL, customer_name TEXT NOT NULL DEFAULT '',
        customer_email TEXT NOT NULL DEFAULT '', customer_phone TEXT NOT NULL DEFAULT '',
        customer_city TEXT NOT NULL DEFAULT '', customer_state TEXT NOT NULL DEFAULT '',
        order_date TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '', delivered_at TEXT NOT NULL DEFAULT '',
        shipped_at TEXT NOT NULL DEFAULT '', out_for_delivery_at TEXT NOT NULL DEFAULT '',
        first_out_for_delivery_at TEXT NOT NULL DEFAULT '', ndr_reason TEXT NOT NULL DEFAULT '',
        ndr_attempts INTEGER NOT NULL DEFAULT 0, ndr_raised_at TEXT NOT NULL DEFAULT '',
        ndr_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT '', status_code INTEGER, payment_method TEXT NOT NULL DEFAULT '',
        payment_status TEXT NOT NULL DEFAULT '', total REAL NOT NULL DEFAULT 0,
        shipping_cost REAL NOT NULL DEFAULT 0, pickup_location TEXT NOT NULL DEFAULT '', awb TEXT NOT NULL DEFAULT '',
        courier TEXT NOT NULL DEFAULT '', shipment_id BIGINT,
        products_json TEXT NOT NULL DEFAULT '[]', raw_json TEXT NOT NULL DEFAULT '{}', synced_at TEXT NOT NULL
      )
    `),
    db.prepare(`CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS webhook_events (id BIGSERIAL PRIMARY KEY, shiprocket_order_id BIGINT, channel_order_id TEXT, shipment_id BIGINT, awb TEXT, status TEXT, payload_json TEXT NOT NULL, received_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS activity_logs (id BIGSERIAL PRIMARY KEY, source TEXT NOT NULL, event_type TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info', message TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sync_reports (id BIGSERIAL PRIMARY KEY, mode TEXT NOT NULL, source TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0, new_orders INTEGER NOT NULL DEFAULT 0, changed_orders INTEGER NOT NULL DEFAULT 0, unchanged_orders INTEGER NOT NULL DEFAULT 0, discrepancies_total INTEGER NOT NULL DEFAULT 0, ndr_records INTEGER NOT NULL DEFAULT 0, ndr_enriched INTEGER NOT NULL DEFAULT 0, fields_json TEXT NOT NULL DEFAULT '{}', changes_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)`),
    db.prepare("ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_status TEXT NOT NULL DEFAULT 'not_required'"),
    db.prepare("ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_updated_at TEXT NOT NULL DEFAULT ''"),
    db.prepare("ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at TEXT NOT NULL DEFAULT ''"),
    db.prepare("ALTER TABLE orders ADD COLUMN IF NOT EXISTS rejected_at TEXT NOT NULL DEFAULT ''"),
    db.prepare(`CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      criteria_json TEXT NOT NULL DEFAULT '{}', position INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE, auto_assign BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS campaign_assignments (
      id BIGSERIAL PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      position BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      UNIQUE(order_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS confirmation_attempts (
      id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL, outcome TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      call_picked BOOLEAN NOT NULL DEFAULT TRUE, rejection_reason TEXT NOT NULL DEFAULT '',
      callback_at TEXT NOT NULL DEFAULT '', next_action_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    )`),
    db.prepare(`INSERT INTO campaigns (id, name, description, criteria_json, position, is_active, auto_assign, created_at, updated_at)
      VALUES ('cmp_default_high_rto', 'High RTO Confirmation', 'Automatically receives every High and Very High RTO order.', '{"risk":"high"}', 0, TRUE, TRUE, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, criteria_json=excluded.criteria_json, is_active=TRUE, auto_assign=TRUE`).bind(new Date().toISOString(), new Date().toISOString()),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_orders_channel_status ON orders (channel_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders (order_date DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_orders_delivered_at ON orders (delivered_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_orders_shipped_at ON orders (shipped_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_orders_out_for_delivery_at ON orders (out_for_delivery_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_orders_channel_order_id ON orders (channel_order_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_orders_awb ON orders (awb)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events (received_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sync_reports_created_at ON sync_reports (created_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_orders_confirmation_status ON orders (confirmation_status, confirmed_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_campaigns_position ON campaigns (is_active, position)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_campaign_assignments_campaign ON campaign_assignments (campaign_id, position)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_confirmation_attempts_order ON confirmation_attempts (order_id, attempt_number)"),
    db.prepare(`INSERT INTO campaign_assignments (campaign_id, order_id, position, created_at)
      SELECT 'cmp_default_high_rto', id, ROW_NUMBER() OVER (ORDER BY COALESCE(NULLIF(order_date, ''), created_at), id), ?
      FROM orders
      WHERE LOWER(REPLACE(REPLACE(COALESCE(raw_json::jsonb->>'rto_risk', ''), '_', ' '), '-', ' ')) IN ('high', 'very high')
      ON CONFLICT(order_id) DO NOTHING`).bind(new Date().toISOString()),
    db.prepare(`UPDATE orders SET confirmation_status='pending', confirmation_updated_at=?
      WHERE confirmation_status='not_required'
        AND LOWER(REPLACE(REPLACE(COALESCE(raw_json::jsonb->>'rto_risk', ''), '_', ' '), '-', ' ')) IN ('high', 'very high')
        AND UPPER(status) NOT LIKE '%DELIVERED%' AND UPPER(status) NOT LIKE 'RTO%' AND UPPER(status) NOT LIKE '%CANCEL%'`).bind(new Date().toISOString()),
  ]);
}

export async function logActivity(db: PostgresDatabase, source: string, eventType: string, message: string, details: Record<string, unknown> = {}, level = "info") {
  await db.prepare(`INSERT INTO activity_logs (source, event_type, level, message, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(source, eventType, level, message, JSON.stringify(details), new Date().toISOString()).run();
}

export async function setSyncState(db: PostgresDatabase, key: string, value: string) {
  await db.prepare(`INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(key, value, new Date().toISOString()).run();
}
