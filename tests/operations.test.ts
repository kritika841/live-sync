import assert from "node:assert/strict";
import { test, after } from "node:test";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
// Explicit local-only test target. Never fall back to a deployment URL.
process.env.SUPABASE_DB_URL = `postgres://satmi_test@127.0.0.1:${process.env.SATMI_TEST_PORT || "55439"}/postgres`;
process.env.SUPPORT_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
const { operationsDb } = await import("../lib/operations/schema");
const { mutateInventory, inventoryData, conversion } = await import(
  "../lib/operations/inventory"
);
const { mutateSupport, supportData } = await import(
  "../lib/operations/support"
);
const { encrypt, decrypt, replyMime, flushOutbox } = await import(
  "../lib/operations/gmail"
);
const { readJson, errorResponse } = await import("../lib/http");
const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1 });
const admin = {
  id: "test-admin",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
};
const agent = {
  id: "test-agent",
  email: "agent@example.test",
  name: "Agent",
  role: "support_agent",
};
const other = { ...agent, id: "other-agent" };
after(async () => {
  await sql.end();
});
test("operations integration: receipts, conversions, concurrency, recipes, sales, tickets and access", async () => {
  await operationsDb();
  const c = randomUUID(),
    v = randomUUID(),
    p = randomUUID();
  await mutateInventory(
    {
      action: "component",
      id: c,
      name: "Test incense",
      sku: c,
      unit: "g",
      gramsPerPack: 200,
    },
    admin,
  );
  await mutateInventory({ action: "vendor", id: v, name: v, address: "Test address", bankDetails: "Test bank" }, admin);
  await mutateInventory(
    {
      action: "po",
      id: p,
      number: p,
      vendorId: v,
      vendorNumber: "V-7",
      lines: [{ componentId: c, quantity: 2, unit: "kg", cost: 100 }],
    },
    admin,
  );
  const [line] =
    await sql`SELECT * FROM purchase_order_lines WHERE purchase_order_id=${p}`;
  const invoiceId = randomUUID();
  await sql`INSERT INTO supplier_invoices(id,supplier_id,purchase_order_id,invoice_number,storage_key,file_hash,created_at,updated_at) VALUES(${invoiceId},${v},${p},${invoiceId},'test-invoice',${invoiceId},'test','test')`;
  await sql`INSERT INTO supplier_invoice_lines(id,supplier_invoice_id,purchase_order_line_id,component_id,quantity) VALUES(${randomUUID()},${invoiceId},${line.id},${c},2)`;
  const key = randomUUID();
  const receipt = {
    action: "receive",
    poId: p,
    invoiceId,
    requestKey: key,
    lines: [{ lineId: line.id, accepted: 1, rejected: 0 }],
  };
  await Promise.all([
    mutateInventory(receipt, admin),
    mutateInventory(receipt, admin),
  ]);
  let [stock] =
    await sql`SELECT SUM(quantity_delta) qty FROM component_ledger WHERE component_id=${c}`;
  assert.equal(Number(stock.qty), 1000);
  let [po] = await sql`SELECT status FROM purchase_orders WHERE id=${p}`;
  assert.equal(po.status, "partially_received");
  await assert.rejects(
    mutateInventory(
      {
        ...receipt,
        requestKey: randomUUID(),
        lines: [{ lineId: line.id, accepted: 2, rejected: 0 }],
      },
      admin,
    ),
    /exceeds/,
  );
  await mutateInventory({ ...receipt, requestKey: randomUUID() }, admin);
  [stock] =
    await sql`SELECT SUM(quantity_delta) qty FROM component_ledger WHERE component_id=${c}`;
  assert.equal(Number(stock.qty), 2000);
  [po] = await sql`SELECT status FROM purchase_orders WHERE id=${p}`;
  assert.equal(po.status, "received");
  const product = randomUUID();
  await sql`INSERT INTO inventory_products(id,shopify_product_id,shopify_variant_id,sku,title,synced_at) VALUES(${product},${product},${product},${product},'Test pack',${new Date().toISOString()})`;
  await assert.rejects(
    mutateInventory(
      {
        action: "sale",
        requestKey: randomUUID(),
        productId: product,
        quantity: 1,
        amount: 10,
        customer: "Test",
      },
      admin,
    ),
    /recipe/,
  );
  await mutateInventory(
    {
      action: "recipe",
      productId: product,
      lines: [{ componentId: c, quantity: 200 }],
    },
    admin,
  );
  const sale = {
    action: "sale",
    requestKey: randomUUID(),
    productId: product,
    quantity: 5,
    amount: 100,
    customer: "Test",
  };
  await Promise.all([
    mutateInventory(sale, admin),
    mutateInventory(sale, admin),
  ]);
  [stock] =
    await sql`SELECT SUM(quantity_delta) qty FROM component_ledger WHERE component_id=${c}`;
  assert.equal(Number(stock.qty), 1000);
  await assert.rejects(
    mutateInventory({ ...sale, requestKey: randomUUID(), quantity: 10 }, admin),
    /Insufficient/,
  );
  const data = await inventoryData();
  assert.ok(data.components.some((x) => x.id === c));
  const rls =
    await sql`SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='support_messages'`;
  assert.equal(rls[0].rowsecurity, true);
  await sql`INSERT INTO support_mailboxes(email,encrypted_refresh_token,connected_by) VALUES('kritika@satmi.in',${encrypt("test-refresh")},'test') ON CONFLICT(email) DO UPDATE SET encrypted_refresh_token=EXCLUDED.encrypted_refresh_token`;
  await sql`INSERT INTO support_agents(user_id,email,name,role) VALUES('test-agent','agent@example.test','Agent','support_agent'),('test-manager','manager@example.test','Manager','support_manager') ON CONFLICT(user_id) DO UPDATE SET available=true`;
  const t = randomUUID();
  await sql`INSERT INTO support_tickets(id,mailbox,gmail_thread_id,subject,customer_email,assignee_id) VALUES(${t},'kritika@satmi.in',${t},'Test query','customer@example.test','test-agent')`;
  await assert.rejects(supportData(other, t), /not assigned/);
  await mutateSupport(
    {
      action: "note",
      ticketId: t,
      version: 1,
      body: "Private context",
      requestKey: randomUUID(),
    },
    agent,
  );
  await assert.rejects(
    mutateSupport(
      { action: "status", ticketId: t, version: 1, status: "resolved" },
      agent,
    ),
    /changed/,
  );
  await mutateSupport(
    {
      action: "reply",
      ticketId: t,
      version: 2,
      body: "Solution",
      requestKey: randomUUID(),
      resolve: true,
    },
    agent,
  );
  const originalFetch = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token"))
      return Response.json({ access_token: "fake" });
    if (url.endsWith("messages/send")) {
      sends++;
      return Response.json({ id: randomUUID() });
    }
    throw new Error("Unexpected network call " + url);
  };
  try {
    await flushOutbox();
    await flushOutbox();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(sends, 1);
  const [ticket] =
    await sql`SELECT status,version FROM support_tickets WHERE id=${t}`;
  assert.equal(ticket.status, "resolved");
  await mutateSupport(
    {
      action: "escalate",
      ticketId: t,
      version: ticket.version,
      reason: "Manager follow-up",
    },
    agent,
  );
  const [escalated] =
    await sql`SELECT status,assignee_id FROM support_tickets WHERE id=${t}`;
  assert.equal(escalated.status, "escalated");
  assert.equal(escalated.assignee_id, "test-manager");
});
test("receipt reversal removes received stock and reopens a fully reversed PO", async () => {
  const component = randomUUID(), vendor = randomUUID(), po = randomUUID();
  await mutateInventory({ action: "component", id: component, name: "Reversal material", sku: component, unit: "g" }, admin);
  await mutateInventory({ action: "vendor", id: vendor, name: `Reversal vendor ${vendor}`, address: "Test address", bankDetails: "Test bank" }, admin);
  await mutateInventory({ action: "po", id: po, number: po, vendorId: vendor, lines: [{ componentId: component, quantity: 1, unit: "kg", cost: 10 }] }, admin);
  const [line] = await sql`SELECT id FROM purchase_order_lines WHERE purchase_order_id=${po}`;
  const invoice = randomUUID();
  await sql`INSERT INTO supplier_invoices(id,supplier_id,purchase_order_id,invoice_number,storage_key,file_hash,created_at,updated_at) VALUES(${invoice},${vendor},${po},${invoice},'test-invoice',${invoice},now(),now())`;
  await sql`INSERT INTO supplier_invoice_lines(id,supplier_invoice_id,purchase_order_line_id,component_id,quantity) VALUES(${randomUUID()},${invoice},${line.id},${component},1)`;
  const receipt = await mutateInventory({ action: "receive", poId: po, invoiceId: invoice, requestKey: randomUUID(), lines: [{ lineId: line.id, accepted: 1, rejected: 0 }] }, admin);
  let [stock] = await sql`SELECT COALESCE(SUM(quantity_delta),0) quantity FROM component_ledger WHERE component_id=${component}`;
  assert.equal(Number(stock.quantity), 1000);
  await mutateInventory({ action: "reverse_receipt", id: receipt.id, reason: "Test reversal" }, admin);
  [stock] = await sql`SELECT COALESCE(SUM(quantity_delta),0) quantity FROM component_ledger WHERE component_id=${component}`;
  assert.equal(Number(stock.quantity), 0);
  const [reopened] = await sql`SELECT status FROM purchase_orders WHERE id=${po}`;
  assert.equal(reopened.status, "ordered");
});

test("conversion and HTTP failures are explicit", async () => {
  assert.equal(conversion("kg", "g"), 1000);
  assert.throws(() => conversion("pack", "g"), /Cannot convert/);
  assert.equal(decrypt(encrypt("secret")), "secret");
  await assert.rejects(
    readJson(new Response("", { status: 502 })),
    /did not return a usable response/,
  );
  const r = errorResponse(
    new Error("Your project has exceeded the data transfer quota"),
  );
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, "DATABASE_QUOTA");
  const mime = replyMime(
    "a@b.test",
    "c@d.test",
    "Hello\r\nBcc: bad",
    "Test",
    "<id@test>",
    "<ref@test>",
  );
  assert.doesNotMatch(mime, /\r\nBcc:/);
  assert.match(mime, /In-Reply-To: <ref@test>/);
});

test("verified fulfilment consumes once and RTO QC restores only accepted recovery", async () => {
  const { reconcileInventory } = await import("../lib/operations/reconcile");
  const c = randomUUID(),
    product = randomUUID(),
    o = Date.now();
  await mutateInventory(
    { action: "component", id: c, name: "QC material", sku: c, unit: "g" },
    admin,
  );
  // Fixture represents stock already received with its purchasing paperwork.
  await sql`INSERT INTO component_ledger(component_id,quantity_delta,entry_type,reason,reference_type,reference_id,idempotency_key,actor_email,created_at) VALUES(${c},1000,'adjustment','Opening fixture','adjustment',${c},${c},'test','test')`;

  await sql`INSERT INTO inventory_products(id,shopify_product_id,shopify_variant_id,sku,title,synced_at) VALUES(${product},${product},${product},${product},'QC product',${new Date().toISOString()})`;
  await mutateInventory(
    {
      action: "recipe",
      productId: product,
      lines: [{ componentId: c, quantity: 200 }],
    },
    admin,
  );
  await sql`INSERT INTO orders(id,channel_order_id,channel_id,channel_name,products_json,status,synced_at) VALUES(${o},${String(o)},1,'test',${JSON.stringify([{ sku: product, quantity: 2 }])},'NEW',${new Date().toISOString()})`;
  await reconcileInventory([o]);
  await assert.rejects(
    mutateInventory(
      {
        action: "adjust",
        componentId: c,
        quantity: 100,
        reason: "Below reservation",
      },
      admin,
    ),
    /reserved/,
  );
  await sql`UPDATE orders SET status='SHIPPED',shipped_at=${new Date().toISOString()} WHERE id=${o}`;
  await reconcileInventory([o]);
  await reconcileInventory([o]);
  let [r] =
    await sql`SELECT SUM(quantity_delta) qty FROM component_ledger WHERE component_id=${c}`;
  assert.equal(Number(r.qty), 600);
  await sql`UPDATE orders SET status='RTO DELIVERED' WHERE id=${o}`;
  const qc = {
    action: "qc",
    orderId: o,
    reason: "100 g damaged",
    lines: [{ componentId: c, quantity: 300 }],
  };
  await mutateInventory(qc, admin);
  await mutateInventory(qc, admin);
  [r] =
    await sql`SELECT SUM(quantity_delta) qty FROM component_ledger WHERE component_id=${c}`;
  assert.equal(Number(r.qty), 900);
});

test("Gmail import and repeated notifications do not duplicate tickets; later reply reopens resolution", async () => {
  const { syncMailbox } = await import("../lib/operations/gmail");
  const thread = randomUUID(),
    first = randomUUID(),
    second = randomUUID();
  let phase = 0;
  await sql`UPDATE support_mailboxes SET sync_lease_until=NULL,import_complete=FALSE,history_id='',import_cursor='',watch_expiration=${Date.now() + 10 * 86400000} WHERE email='kritika@satmi.in'`;
  const make = (id: string, body: string, time: number) => ({
    id,
    threadId: thread,
    internalDate: String(time),
    labelIds: ["INBOX"],
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "Customer <customer@example.test>" },
        { name: "To", value: "kritika@satmi.in" },
        { name: "Subject", value: "Where is my order?" },
        { name: "Message-ID", value: "<" + id + "@example.test>" },
      ],
      body: { data: Buffer.from(body).toString("base64url") },
    },
  });
  const now = Date.now();
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({ access_token: "fake" });
    if (url.pathname.endsWith("/profile"))
      return Response.json({ historyId: "100" });
    if (url.pathname.endsWith("/threads"))
      return Response.json({ threads: [{ id: thread }] });
    if (url.pathname.endsWith("/threads/" + thread))
      return Response.json({
        messages: [
          make(first, "Original query", now),
          ...(phase ? [make(second, "One more question", now + 1000)] : []),
        ],
      });
    if (url.pathname.endsWith("/history"))
      return Response.json({
        historyId: "101",
        history: [{ messagesAdded: [{ message: { threadId: thread } }] }],
      });
    throw new Error("Unexpected request " + url);
  };
  try {
    await syncMailbox();
    await syncMailbox();
    const tickets =
      await sql`SELECT * FROM support_tickets WHERE gmail_thread_id=${thread}`;
    assert.equal(tickets.length, 1);
    const t = tickets[0];
    let [count] =
      await sql`SELECT COUNT(*) n FROM support_messages WHERE ticket_id=${t.id}`;
    assert.equal(Number(count.n), 1);
    await sql`UPDATE support_tickets SET status='resolved' WHERE id=${t.id}`;
    phase = 1;
    await syncMailbox();
    await syncMailbox();
    [count] =
      await sql`SELECT COUNT(*) n FROM support_messages WHERE ticket_id=${t.id}`;
    assert.equal(Number(count.n), 2);
    const [reopened] =
      await sql`SELECT status FROM support_tickets WHERE id=${t.id}`;
    assert.equal(reopened.status, "open");
  } finally {
    globalThis.fetch = original;
  }
});
