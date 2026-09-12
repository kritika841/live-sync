import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createPublicKey,
  verify,
} from "node:crypto";
import { operationsDb } from "./schema";
import { mailbox, supportEvent, refreshAgents } from "./support";
import { HttpError } from "../http";
import { randomUUID } from "node:crypto";
import { visibleEmailBody } from "../email-body";
function key() {
  const k = Buffer.from(process.env.SUPPORT_TOKEN_KEY || "", "base64");
  if (k.length !== 32)
    throw new HttpError(503, "Mailbox encryption key is not configured");
  return k;
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  return Buffer.concat([
    iv,
    c.update(value),
    c.final(),
    c.getAuthTag(),
  ]).toString("base64");
}
export function decrypt(value: string) {
  const b = Buffer.from(value, "base64"),
    c = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  c.setAuthTag(b.subarray(-16));
  return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString();
}
export async function tokenRequest(params: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      ...params,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
    signal: AbortSignal.timeout(20000),
  });
  const d = await r.json();
  if (!r.ok)
    throw new HttpError(
      503,
      "Google authorization failed. Reconnect the mailbox.",
    );
  return d as { access_token: string; refresh_token?: string };
}
async function bearer() {
  const db = await operationsDb();
  const row = await db
    .prepare(
      "SELECT encrypted_refresh_token FROM support_mailboxes WHERE email=?",
    )
    .bind(mailbox())
    .first<{ encrypted_refresh_token: string }>();
  if (!row?.encrypted_refresh_token)
    throw new HttpError(409, "Connect the Gmail mailbox first");
  return (
    await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: decrypt(row.encrypted_refresh_token),
    })
  ).access_token;
}
export class GmailError extends Error {
  constructor(public status: number) {
    super(`Google mailbox request failed (${status})`);
  }
}
export async function gmail(path: string, token: string, body?: unknown) {
  const r = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/" + path,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25000),
    },
  );
  if (!r.ok) throw new GmailError(r.status);
  if (r.status === 204) return {};
  return r.json();
}
export async function renewWatch(token?: string) {
  if (!process.env.GMAIL_PUBSUB_TOPIC) return;
  const t = token || (await bearer());
  const d = await gmail("watch", t, {
    topicName: process.env.GMAIL_PUBSUB_TOPIC,
  });
  const db = await operationsDb();
  await db
    .prepare("UPDATE support_mailboxes SET watch_expiration=? WHERE email=?")
    .bind(Number(d.expiration), mailbox())
    .run();
}
type Part = {
  mimeType?: string;
  filename?: string;
  partId?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: Part[];
  headers?: Array<{ name: string; value: string }>;
};
export function messageText(part: Part): string {
  if (part.mimeType === "text/plain" && part.body?.data)
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  const plain = part.parts?.map(messageText).filter(Boolean).join("\n");
  if (plain) return plain;
  if (part.mimeType === "text/html" && part.body?.data)
    return Buffer.from(part.body.data, "base64url")
      .toString("utf8")
      .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  return "";
}
function attachments(
  part: Part,
): Array<{ name: string; attachmentId: string; size: number }> {
  return [
    ...(part.filename && part.body?.attachmentId
      ? [
          {
            name: part.filename,
            attachmentId: part.body.attachmentId,
            size: part.body.size || 0,
          },
        ]
      : []),
    ...(part.parts || []).flatMap(attachments),
  ];
}
export function emailAddress(s: string) {
  return (
    s.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ||
    s.match(/[^\s<>]+@[^\s<>]+/)?.[0] ||
    ""
  ).toLowerCase();
}
async function importThread(threadId: string, token: string) {
  const thread = await gmail(
    "threads/" + encodeURIComponent(threadId) + "?format=full",
    token,
  );
  const ms = (thread.messages || []).sort(
    (a: { internalDate: string }, b: { internalDate: string }) =>
      Number(a.internalDate) - Number(b.internalDate),
  );
  const db = await operationsDb();
  await db.transaction(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(421994)`;
    let [ticket] =
      await sql`SELECT * FROM support_tickets WHERE mailbox=${mailbox()} AND gmail_thread_id=${threadId}`;
    for (const m of ms) {
      if (
        m.labelIds?.includes("DRAFT") ||
        m.labelIds?.includes("SPAM") ||
        m.labelIds?.includes("TRASH")
      )
        continue;
      const headers = new Map<string, string>(
        (m.payload?.headers || []).map((h: { name: string; value: string }) => [
          h.name.toLowerCase(),
          h.value,
        ]),
      );
      const from = emailAddress(headers.get("from") || "");
      const outbound =
        m.labelIds?.includes("SENT") || from === mailbox().toLowerCase();
      if (!ticket && outbound) continue;
      if (!ticket) {
        if (!from) continue;
        const [agent] =
          await sql`SELECT a.user_id FROM support_agents a LEFT JOIN support_tickets t ON t.assignee_id=a.user_id AND t.status<>'resolved' WHERE a.available AND a.role='support_agent' GROUP BY a.user_id ORDER BY COUNT(t.id),a.user_id LIMIT 1`;
        [ticket] =
          await sql`INSERT INTO support_tickets(id,mailbox,gmail_thread_id,subject,customer_email,customer_name,assignee_id) VALUES(${randomUUID()},${mailbox()},${threadId},${headers.get("subject") || "(No subject)"},${from},${headers.get("from") || from},${agent?.user_id || null}) RETURNING *`;
        await supportEvent(sql, "gmail", ticket.id, "created", {
          assigned: agent?.user_id || null,
        });
      }
      const mid = headers.get("message-id") || "";
      if (outbound && mid) {
        const existing =
          await sql`UPDATE support_messages SET gmail_message_id=${m.id},delivery_status='sent',last_error='' WHERE ticket_id=${ticket.id} AND message_id=${mid} AND direction='outbound' AND delivery_status<>'sent' RETURNING id,resolve_after_send`;
        if (existing.length) {
          if (existing[0].resolve_after_send)
            await sql`UPDATE support_tickets SET status='resolved',version=version+1 WHERE id=${ticket.id}`;
          continue;
        }
      }
      const inserted =
        await sql`INSERT INTO support_messages(id,ticket_id,gmail_message_id,message_id,direction,sender,recipients,body,attachments,delivery_status,created_at) VALUES(${randomUUID()},${ticket.id},${m.id},${mid},${outbound ? "outbound" : "inbound"},${headers.get("from") || from},${headers.get("to") || mailbox()},${visibleEmailBody(messageText(m.payload || {}) || m.snippet || "")},${sql.json(attachments(m.payload || {}))},${outbound ? "sent" : "received"},${new Date(Number(m.internalDate)).toISOString()}) ON CONFLICT(gmail_message_id) DO NOTHING RETURNING id`;
      if (inserted.length)
        await sql`UPDATE support_tickets SET updated_at=GREATEST(updated_at,${new Date(Number(m.internalDate)).toISOString()}::timestamptz),status=CASE WHEN ${!outbound} AND status IN ('resolved','waiting') THEN 'open' ELSE status END,version=version+1 WHERE id=${ticket.id}`;
    }
  });
}
export async function syncMailbox() {
  const db = await operationsDb();
  const lock = await db
    .prepare(
      "UPDATE support_mailboxes SET sync_lease_until=now()+interval '6 minutes' WHERE email=? AND (sync_lease_until IS NULL OR sync_lease_until<now()) RETURNING *,sync_lease_until::text AS lease_token",
    )
    .bind(mailbox())
    .first<Record<string, unknown>>();
  if (!lock) return { busy: true };
  try {
    const token = await bearer();
    let imported = 0;
    if (!lock.import_complete) {
      let history = String(lock.history_id || "");
      if (!history) {
        history = String((await gmail("profile", token)).historyId);
        await db
          .prepare("UPDATE support_mailboxes SET history_id=? WHERE email=?")
          .bind(history, mailbox())
          .run();
      }
      const params = new URLSearchParams({
        maxResults: "30",
        q: `after:${lock.import_since || "2026/01/01"}`,
      });
      if (lock.import_cursor)
        params.set("pageToken", String(lock.import_cursor));
      const page = await gmail("threads?" + params, token);
      for (const t of page.threads || []) {
        await importThread(t.id, token);
        imported++;
      }
      await db
        .prepare(
          "UPDATE support_mailboxes SET import_cursor=?,import_complete=? WHERE email=?",
        )
        .bind(page.nextPageToken || "", !page.nextPageToken, mailbox())
        .run();
    } else {
      let pageToken = "";
      let history = String(lock.history_id);
      let pages = 0;
      do {
        const params = new URLSearchParams({
          startHistoryId: String(lock.history_id),
          maxResults: "100",
        });
        if (pageToken) params.set("pageToken", pageToken);
        let page;
        try {
          page = await gmail("history?" + params, token);
        } catch (e) {
          if (e instanceof GmailError && e.status === 404) {
            await db
              .prepare(
                "UPDATE support_mailboxes SET import_complete=FALSE,import_cursor='',history_id='' WHERE email=?",
              )
              .bind(mailbox())
              .run();
            return { reconciling: true };
          }
          throw e;
        }
        const ids = new Set<string>();
        for (const h of page.history || [])
          for (const x of h.messagesAdded || []) ids.add(x.message.threadId);
        for (const id of ids) {
          await importThread(id, token);
          imported++;
        }
        history = page.historyId;
        pageToken = page.nextPageToken || "";
        pages++;
        if (pages >= 10 && pageToken)
          throw new HttpError(
            503,
            "Mailbox catch-up is still pending; retry synchronization",
          );
      } while (pageToken);
      await db
        .prepare("UPDATE support_mailboxes SET history_id=? WHERE email=?")
        .bind(history, mailbox())
        .run();
    }
    if (Number(lock.watch_expiration) < Date.now() + 2 * 86400000)
      await renewWatch(token);
    await db
      .prepare(
        "UPDATE support_mailboxes SET last_sync_at=now(),last_error='' WHERE email=?",
      )
      .bind(mailbox())
      .run();
    return { imported };
  } catch (e) {
    await db
      .prepare("UPDATE support_mailboxes SET last_error=? WHERE email=?")
      .bind(
        e instanceof HttpError
          ? e.message
          : "Mailbox synchronization failed. Retry or reconnect Gmail.",
        mailbox(),
      )
      .run();
    throw e;
  } finally {
    await db
      .prepare(
        "UPDATE support_mailboxes SET sync_lease_until=NULL WHERE email=? AND sync_lease_until::text=?",
      )
      .bind(mailbox(),lock.lease_token)
      .run();
  }
}
function cleanHeader(s: string) {
  return s.replace(/[\r\n]/g, " ").trim();
}
export function replyMime(
  from: string,
  to: string,
  subject: string,
  body: string,
  id: string,
  replyTo: string,
) {
  return [
    `From: ${cleanHeader(from)}`,
    `To: ${cleanHeader(to)}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    `Message-ID: ${cleanHeader(id)}`,
    ...(replyTo
      ? [
          `In-Reply-To: ${cleanHeader(replyTo)}`,
          `References: ${cleanHeader(replyTo)}`,
        ]
      : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body)
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") || "",
  ].join("\r\n");
}
export async function flushOutbox() {
  const db = await operationsDb();
  const token = await bearer();
  await db
    .prepare(
      "UPDATE support_messages SET delivery_status='uncertain',last_error='Send interrupted; checking Gmail before any retry' WHERE delivery_status='sending' AND COALESCE(send_started_at,created_at)<now()-interval '5 minutes'",
    )
    .run();
  const uncertain = await db
    .prepare(
      "SELECT * FROM support_messages WHERE delivery_status='uncertain' ORDER BY created_at LIMIT 10",
    )
    .all<Record<string, unknown>>();
  for (const m of uncertain.results) {
    const found = await gmail(
      "messages?" +
        new URLSearchParams({
          q: `in:sent rfc822msgid:${String(m.message_id).replace(/[<>]/g, "")}`,
        }),
      token,
    );
    if (found.messages?.length)
      await importThread(found.messages[0].threadId, token);
  }
  for (let i = 0; i < 10; i++) {
    const m = await db.transaction(async (sql) => {
      const [r] =
        await sql`SELECT m.*,t.gmail_thread_id,t.subject FROM support_messages m JOIN support_tickets t ON t.id=m.ticket_id WHERE m.delivery_status='queued' ORDER BY m.created_at FOR UPDATE OF m SKIP LOCKED LIMIT 1`;
      if (!r) return null;
      await sql`UPDATE support_messages SET delivery_status='sending',send_started_at=now(),attempts=attempts+1 WHERE id=${r.id}`;
      return r;
    });
    if (!m) break;
    try {
      const prev = await db
        .prepare(
          "SELECT message_id FROM support_messages WHERE ticket_id=? AND direction='inbound' ORDER BY created_at DESC LIMIT 1",
        )
        .bind(m.ticket_id)
        .first<{ message_id: string }>();
      const raw = replyMime(
        mailbox(),
        m.recipients,
        m.subject,
        m.body,
        m.message_id,
        prev?.message_id || "",
      );
      const sent = await gmail("messages/send", token, {
        raw: Buffer.from(raw).toString("base64url"),
        ...(String(m.gmail_thread_id).startsWith("manual:") ? {} : {threadId: m.gmail_thread_id}),
      });
      await db.transaction(async (sql) => {
        await sql`UPDATE support_messages SET delivery_status='sent',gmail_message_id=${sent.id},last_error='' WHERE id=${m.id}`;
        if (String(m.gmail_thread_id).startsWith("manual:") && sent.threadId) await sql`UPDATE support_tickets SET gmail_thread_id=${sent.threadId} WHERE id=${m.ticket_id}`;
        await sql`UPDATE support_tickets SET status=${m.resolve_after_send ? "resolved" : "waiting"},version=version+1,updated_at=now() WHERE id=${m.ticket_id}`;
        await supportEvent(sql, m.created_by, m.ticket_id, "reply_sent", {
          messageId: m.id,
        });
      });
    } catch (e) {
      const definite =
        e instanceof GmailError && [400, 401, 403, 404, 429].includes(e.status);
      await db
        .prepare(
          "UPDATE support_messages SET delivery_status=?,last_error=? WHERE id=?",
        )
        .bind(
          definite ? "failed" : "uncertain",
          definite
            ? "Google rejected this send. Resolve the connection or limit and retry."
            : "Delivery is uncertain. The app will check Sent mail before any retry.",
          m.id,
        )
        .run();
    }
  }
}
export async function verifyPush(request: Request) {
  const jwt =
    request.headers.get("authorization")?.replace(/^Bearer /i, "") || "";
  const parts = jwt.split(".");
  if (jwt.length > 12000 || parts.length !== 3)
    throw new HttpError(401, "Missing Google push identity");
  let header,claims;
  try{header=JSON.parse(Buffer.from(parts[0],"base64url").toString());claims=JSON.parse(Buffer.from(parts[1],"base64url").toString());if(!header||!claims)throw Error();}catch{throw new HttpError(401,"Invalid push identity");}
  if (header.alg !== "RS256") throw new HttpError(401, "Invalid push identity");
  const certs = await fetch("https://www.googleapis.com/oauth2/v3/certs", {
    signal: AbortSignal.timeout(10000),
  }).then((r) => r.json());
  const jwk = certs.keys.find((k: { kid: string }) => k.kid === header.kid);
  if (
    !jwk ||
    !verify(
      "RSA-SHA256",
      Buffer.from(parts[0] + "." + parts[1]),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(parts[2], "base64url"),
    ) ||
    !["accounts.google.com", "https://accounts.google.com"].includes(
      claims.iss,
    ) ||
    claims.aud !== process.env.GMAIL_PUSH_AUDIENCE ||
    claims.email !== process.env.GMAIL_PUSH_SERVICE_ACCOUNT ||
    claims.email_verified !== true ||
    typeof claims.exp !== "number" ||
    !Number.isFinite(claims.exp) ||
    claims.exp * 1000 < Date.now()
  )
    throw new HttpError(401, "Invalid push identity");
}
export async function gmailAttachment(messageId: string, attachmentId: string) {
  return gmail(
    `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    await bearer(),
  );
}
export async function runSupport() {
  await refreshAgents();
  const result = await syncMailbox();
  await flushOutbox();
  return result;
}
