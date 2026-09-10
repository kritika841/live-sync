import postgres, { type Sql } from "postgres";

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
  deliveredrevenue: "deliveredRevenue",
  avgshippingcost: "avgShippingCost",
  deliveredshippingcostcount: "deliveredShippingCostCount",
  avgdeliveredordervalue: "avgDeliveredOrderValue",
  openpopulation: "openPopulation",
  highrisk: "highRisk",
  lowrisk: "lowRisk",
  unknownrisk: "unknownRisk",
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
  attemptnumber: "attemptNumber",
  latestknownstatus: "latestKnownStatus",
  eventat: "eventAt",
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
  callpicked: "callPicked",
  callbackat: "callbackAt",
  nextactionat: "nextActionAt",
  criteriajson: "criteriaJson",
  isactive: "isActive",
  autoassign: "autoAssign",
  ordercount: "orderCount",
  physicalstock: "physicalStock",
  allocatedstock: "allocatedStock",
  availablestock: "availableStock",
  incomingstock: "incomingStock",
  orderedquantity: "orderedQuantity",
  receivedquantity: "receivedQuantity",
  expecteddate: "expectedDate",
  ponumber: "poNumber",
  suppliername: "supplierName",
  componentcount: "componentCount",
  productcount: "productCount",
  openpocount: "openPoCount",
  remainingvalue: "remainingValue",
  inventoryitemid: "inventoryItemId",
  shopifyproductid: "shopifyProductId",
  shopifyvariantid: "shopifyVariantId",
  varianttitle: "variantTitle",
  reorderlevel: "reorderLevel",
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
  private readonly sql: Sql;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
    });
    this.query = async (text, values) => normalizeRows((await this.sql.unsafe(postgresPlaceholders(text), values as never[])) as Row[]);
  }

  prepare(text: string) {
    return new PreparedStatement(this.query, text);
  }

  async batch(statements: PreparedStatement[]) {
    if (!statements.length) return [];
    return this.sql.begin(async (transaction) => {
      const results = [];
      for (const statement of statements) {
        const query = statement.toQuery();
        const rows = await transaction.unsafe(query.text, query.values as never[]);
        results.push({ success: true, results: normalizeRows(rows as Row[]) });
      }
      return results;
    });
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
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_ADMIN_ACCESS_TOKEN?: string;
  SHOPIFY_API_VERSION?: string;
};

let database: PostgresDatabase | undefined;
let schemaReady: Promise<void> | undefined;

export function getRuntimeEnv(): RuntimeEnv {
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL is not configured");
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
    SHOPIFY_SHOP_DOMAIN: process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_ADMIN_ACCESS_TOKEN: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
    SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || "2026-04",
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
    db.prepare(`CREATE TABLE IF NOT EXISTS webhook_events (id BIGSERIAL PRIMARY KEY, shiprocket_order_id BIGINT, channel_order_id TEXT, shipment_id BIGINT, awb TEXT, status TEXT, payload_json TEXT NOT NULL, event_at TEXT NOT NULL DEFAULT '', received_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS activity_logs (id BIGSERIAL PRIMARY KEY, source TEXT NOT NULL, event_type TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info', message TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sync_reports (id BIGSERIAL PRIMARY KEY, mode TEXT NOT NULL, source TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0, new_orders INTEGER NOT NULL DEFAULT 0, changed_orders INTEGER NOT NULL DEFAULT 0, unchanged_orders INTEGER NOT NULL DEFAULT 0, discrepancies_total INTEGER NOT NULL DEFAULT 0, ndr_records INTEGER NOT NULL DEFAULT 0, ndr_enriched INTEGER NOT NULL DEFAULT 0, fields_json TEXT NOT NULL DEFAULT '{}', changes_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)`),
    db.prepare("ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_status TEXT NOT NULL DEFAULT 'not_required'"),
    db.prepare("ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_updated_at TEXT NOT NULL DEFAULT ''"),
    db.prepare("ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at TEXT NOT NULL DEFAULT ''"),
    db.prepare("ALTER TABLE orders ADD COLUMN IF NOT EXISTS rejected_at TEXT NOT NULL DEFAULT ''"),
    db.prepare("ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS event_at TEXT NOT NULL DEFAULT ''"),
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
    db.prepare(`CREATE TABLE IF NOT EXISTS component_types (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_components (
      id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      component_type_id TEXT REFERENCES component_types(id), unit TEXT NOT NULL DEFAULT 'unit',
      recoverable BOOLEAN NOT NULL DEFAULT TRUE, active BOOLEAN NOT NULL DEFAULT TRUE,
      reorder_level DOUBLE PRECISION NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_products (
      id TEXT PRIMARY KEY, shopify_product_id TEXT NOT NULL, shopify_variant_id TEXT NOT NULL UNIQUE,
      inventory_item_id TEXT NOT NULL DEFAULT '', sku TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
      variant_title TEXT NOT NULL DEFAULT '', vendor TEXT NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT TRUE,
      raw_json TEXT NOT NULL DEFAULT '{}', synced_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS recipe_versions (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, UNIQUE(product_id, version)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS recipe_items (
      id BIGSERIAL PRIMARY KEY, recipe_version_id TEXT NOT NULL REFERENCES recipe_versions(id) ON DELETE CASCADE,
      component_id TEXT NOT NULL REFERENCES inventory_components(id), quantity DOUBLE PRECISION NOT NULL CHECK(quantity > 0),
      UNIQUE(recipe_version_id, component_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      tax_id TEXT NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT TRUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY, po_number TEXT NOT NULL UNIQUE, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ordered','partially_received','received','closed','cancelled')),
      order_date TEXT NOT NULL, expected_date TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'INR',
      notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS purchase_order_lines (
      id TEXT PRIMARY KEY, purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      component_id TEXT REFERENCES inventory_components(id), supplier_sku TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL, ordered_quantity DOUBLE PRECISION NOT NULL CHECK(ordered_quantity > 0),
      received_quantity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(received_quantity >= 0),
      rejected_quantity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(rejected_quantity >= 0),
      unit_cost DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(unit_cost >= 0), tax_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS goods_receipts (
      id TEXT PRIMARY KEY, receipt_number TEXT NOT NULL UNIQUE, purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
      received_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted','void')),
      notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, posted_at TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS goods_receipt_lines (
      id TEXT PRIMARY KEY, goods_receipt_id TEXT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
      purchase_order_line_id TEXT NOT NULL REFERENCES purchase_order_lines(id), component_id TEXT NOT NULL REFERENCES inventory_components(id),
      accepted_quantity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(accepted_quantity >= 0),
      rejected_quantity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(rejected_quantity >= 0), notes TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS supplier_invoices (
      id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id), purchase_order_id TEXT REFERENCES purchase_orders(id),
      invoice_number TEXT NOT NULL, invoice_date TEXT NOT NULL DEFAULT '', storage_key TEXT NOT NULL DEFAULT '',
      original_filename TEXT NOT NULL DEFAULT '', file_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'uploaded'
        CHECK(status IN ('uploaded','extracting','review_required','matched','approved','rejected')),
      extracted_json TEXT NOT NULL DEFAULT '{}', subtotal DOUBLE PRECISION NOT NULL DEFAULT 0,
      tax_total DOUBLE PRECISION NOT NULL DEFAULT 0, grand_total DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(supplier_id, invoice_number)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
      id TEXT PRIMARY KEY, supplier_invoice_id TEXT NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
      purchase_order_line_id TEXT REFERENCES purchase_order_lines(id), component_id TEXT REFERENCES inventory_components(id),
      description TEXT NOT NULL DEFAULT '', sku TEXT NOT NULL DEFAULT '', quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
      unit_cost DOUBLE PRECISION NOT NULL DEFAULT 0, tax_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      match_confidence DOUBLE PRECISION NOT NULL DEFAULT 0, match_status TEXT NOT NULL DEFAULT 'unmatched'
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS component_ledger (
      id BIGSERIAL PRIMARY KEY, component_id TEXT NOT NULL REFERENCES inventory_components(id),
      quantity_delta DOUBLE PRECISION NOT NULL, entry_type TEXT NOT NULL,
      reference_type TEXT NOT NULL DEFAULT '', reference_id TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL DEFAULT '', actor_email TEXT NOT NULL DEFAULT '', idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS order_requirement_sets (
      id TEXT PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      recipe_snapshot_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'complete', created_at TEXT NOT NULL,
      UNIQUE(order_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS order_requirements (
      id BIGSERIAL PRIMARY KEY, requirement_set_id TEXT NOT NULL REFERENCES order_requirement_sets(id) ON DELETE CASCADE,
      component_id TEXT NOT NULL REFERENCES inventory_components(id), required_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
      allocated_quantity DOUBLE PRECISION NOT NULL DEFAULT 0, consumed_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
      UNIQUE(requirement_set_id, component_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS provider_event_inbox (
      id BIGSERIAL PRIMARY KEY, provider TEXT NOT NULL, delivery_id TEXT NOT NULL, topic TEXT NOT NULL,
      payload_hash TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', received_at TEXT NOT NULL,
      processed_at TEXT NOT NULL DEFAULT '', UNIQUE(provider, delivery_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_audit_events (
      id BIGSERIAL PRIMARY KEY, actor_id TEXT NOT NULL DEFAULT '', actor_email TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      before_json TEXT NOT NULL DEFAULT '{}', after_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
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
    db.prepare("CREATE INDEX IF NOT EXISTS idx_component_ledger_component ON component_ledger (component_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_inventory_products_sku ON inventory_products (sku)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders (status, expected_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_component ON purchase_order_lines (component_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_provider_event_inbox_status ON provider_event_inbox (provider, status, received_at)"),
    db.prepare(`INSERT INTO component_types (id, name, position, created_at) VALUES
      ('accessory','Accessory',10,?), ('insert','Insert',20,?), ('inner-packaging','Inner packaging',30,?),
      ('outer-packaging','Outer packaging',40,?), ('courier-box','Courier box',50,?), ('other','Other',60,?)
      ON CONFLICT(id) DO NOTHING`).bind(...Array(6).fill(new Date().toISOString())),
    db.prepare(`UPDATE orders SET total = COALESCE(
      NULLIF(CASE WHEN raw_json::jsonb->>'total' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (raw_json::jsonb->>'total')::double precision ELSE 0 END, 0),
      NULLIF(CASE WHEN raw_json::jsonb->>'sub_total' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (raw_json::jsonb->>'sub_total')::double precision ELSE 0 END, 0),
      NULLIF(CASE WHEN raw_json::jsonb->>'total_amount' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (raw_json::jsonb->>'total_amount')::double precision ELSE 0 END, 0),
      NULLIF(CASE WHEN raw_json::jsonb->>'order_total' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (raw_json::jsonb->>'order_total')::double precision ELSE 0 END, 0),
      NULLIF(CASE WHEN raw_json::jsonb->>'amount' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (raw_json::jsonb->>'amount')::double precision ELSE 0 END, 0),
      total
    ) WHERE total <= 0 AND NOT EXISTS (SELECT 1 FROM sync_state WHERE key='order_total_backfill_v1')`),
    db.prepare(`INSERT INTO sync_state (key, value, updated_at) VALUES ('order_total_backfill_v1', 'complete', ?)
      ON CONFLICT(key) DO NOTHING`).bind(new Date().toISOString()),
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
