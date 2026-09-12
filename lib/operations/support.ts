import type { User } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { DashboardUser } from "../auth/access";
import type { TransactionSql } from "postgres";
import { getSupabaseAdmin } from "../supabase/admin";
import { HttpError, required } from "../http";
import { operationsDb } from "./schema";
import { manager } from "./access";
export const mailbox = () => process.env.SUPPORT_MAILBOX || "kritika@satmi.in";
function customerTags(raw: unknown) {
  try {
    const value = JSON.parse(String(raw || "{}"));
    const tags = value.shopify_tags ?? value.tags ?? value.order_tag ?? [];
    return (Array.isArray(tags) ? tags : String(tags).split(","))
      .map((tag) => String(tag).trim())
      .filter(Boolean)
      .slice(0, 12);
  } catch {
    return [];
  }
}
export async function supportEvent(
  sql: TransactionSql,
  u: string,
  id: string,
  action: string,
  details: unknown = {},
) {
  await sql`INSERT INTO support_events(ticket_id,actor_id,action,details) VALUES(${id},${u},${action},${JSON.stringify(details)})`;
}
export async function assignWaitingTickets(sql: TransactionSql) {
  await sql`SELECT pg_advisory_xact_lock(421994)`;
  const agents = await sql`SELECT a.user_id,COUNT(t.id)::int load FROM support_agents a LEFT JOIN support_tickets t ON t.assignee_id=a.user_id AND t.status<>'resolved' WHERE a.available AND a.role='support_agent' GROUP BY a.user_id`;
  if (!agents.length) return;
  const waiting = await sql`SELECT id FROM support_tickets WHERE assignee_id IS NULL AND status IN ('open','in_progress','waiting') ORDER BY created_at,id FOR UPDATE`;
  for (const ticket of waiting) {
    agents.sort((a,b)=>Number(a.load)-Number(b.load)||String(a.user_id).localeCompare(String(b.user_id)));
    const agent=agents[0];
    await sql`UPDATE support_tickets SET assignee_id=${agent.user_id},updated_at=now() WHERE id=${ticket.id}`;
    await supportEvent(sql,'system',String(ticket.id),'auto_assigned',{agentId:agent.user_id});
    agent.load=Number(agent.load)+1;
  }
}
export async function ticketAccess(
  sql: TransactionSql,
  id: string,
  u: DashboardUser,
) {
  const [t] =
    await sql`SELECT * FROM support_tickets WHERE id=${id} FOR UPDATE`;
  if (!t) throw new HttpError(404, "Ticket not found");
  if (!manager(u) && t.assignee_id !== u.id)
    throw new HttpError(403, "This ticket is not assigned to you");
  return t;
}
export async function refreshAgents() {
  const db = await operationsDb();
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await getSupabaseAdmin().auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new HttpError(503, "Could not refresh support team");
    users.push(...data.users);
    if (data.users.length < 200) break;
  }
  await db.transaction(async (sql) => {
    await sql`UPDATE support_agents SET available=FALSE WHERE user_id NOT IN ${sql(
      users
        .filter(
          (u) =>
            ["admin", "support_agent", "support_manager"].includes(
              u.app_metadata.role,
            ) &&
            (!u.banned_until || new Date(u.banned_until) < new Date()),
        )
        .map((u) => u.id)
        .concat("__none__"),
    )}`;
    for (const u of users) {
      const role = u.app_metadata.role;
      if (
        !["admin", "support_agent", "support_manager"].includes(role) ||
        (u.banned_until && new Date(u.banned_until) > new Date())
      )
        continue;
      await sql`INSERT INTO support_agents(user_id,email,name,role) VALUES(${u.id},${u.email || ""},${u.user_metadata.name || u.email || ""},${role}) ON CONFLICT(user_id) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name,role=EXCLUDED.role`;
    }
    await assignWaitingTickets(sql);
  });
}
export async function supportData(
  u: DashboardUser,
  id?: string,
  filters: { page?: number; queue?: string; search?: string } = {},
) {
  const db = await operationsDb();
  return db.transaction(async (sql) => {
    const agents = await sql`SELECT * FROM support_agents ORDER BY name`;
    const availableAgents = agents.filter(
      (agent) => agent.role === "support_agent" && agent.available,
    ).length;
    const page = Number.isFinite(filters.page) ? Math.max(1, Math.min(100000,Math.floor(filters.page || 1))) : 1;
    const queue = filters.queue || "all";
    const search = "%" + (filters.search || "") + "%";
    const where = sql`(${manager(u)} OR assignee_id=${u.id}) AND (${queue}='all' OR (${queue}='mine' AND assignee_id=${u.id}) OR (${queue}='unassigned' AND assignee_id IS NULL) OR status=${queue}) AND (subject ILIKE ${search} OR customer_email ILIKE ${search} OR ticket_number::text ILIKE ${search})`;
    const tickets =
      await sql`SELECT * FROM support_tickets WHERE ${where} ORDER BY updated_at DESC,id LIMIT 50 OFFSET ${(page - 1) * 50}`;
    const [total] =
      await sql`SELECT COUNT(*) count FROM support_tickets WHERE ${where}`;
    const [summary] =
      await sql`SELECT COUNT(*) FILTER(WHERE status<>'resolved') open, COUNT(*) FILTER(WHERE status<>'resolved' AND assignee_id IS NULL) unassigned, COUNT(*) FILTER(WHERE status='escalated') escalated, COUNT(*) FILTER(WHERE status='resolved') resolved FROM support_tickets WHERE ${manager(u)} OR assignee_id=${u.id}`;
    let selectedTicket = null;
    let messages: readonly unknown[] = [];
    let events: readonly unknown[] = [];
    let orders: readonly unknown[] = [];
    let customer = { name: "", email: "", phone: "", tags: [] as string[] };
    if (id) {
      const t = await ticketAccess(sql, id, u);
      selectedTicket = t;
      messages =
        await sql`SELECT * FROM support_messages WHERE ticket_id=${id} ORDER BY created_at,id`;
      events =
        await sql`SELECT * FROM support_events WHERE ticket_id=${id} ORDER BY created_at`;
      orders =
        await sql`SELECT id,channel_order_id,status,awb,courier FROM orders WHERE LOWER(customer_email)=LOWER(${t.customer_email}) ORDER BY created_at DESC LIMIT 20`;
      const [customerOrder] =
        await sql`SELECT customer_name,customer_phone,raw_json FROM orders WHERE LOWER(customer_email)=LOWER(${t.customer_email}) ORDER BY created_at DESC LIMIT 1`;
      customer = {
        name: String(customerOrder?.customer_name || t.customer_name || ""),
        email: t.customer_email,
        phone: String(customerOrder?.customer_phone || ""),
        tags: customerTags(customerOrder?.raw_json),
      };
    }
    const [connection] =
      await sql`SELECT email,last_sync_at,last_error,watch_expiration,import_complete,encrypted_refresh_token<>'' connected FROM support_mailboxes WHERE email=${mailbox()}`;
    return {
      tickets,
      selectedTicket,
      page,
      totalPages: Math.max(1, Math.ceil(Number(total.count) / 50)),
      total: Number(total.count),
      summary,
      agents,
      availableAgents,
      messages,
      events,
      orders,
      customer,
      connection: connection || { email: mailbox(), connected: false },
      canManage: manager(u),
      userId: u.id,
      configured: Boolean(
        process.env.GOOGLE_CLIENT_ID &&
          process.env.GOOGLE_CLIENT_SECRET &&
          process.env.SUPPORT_TOKEN_KEY &&
          process.env.GOOGLE_REDIRECT_URI,
      ),
      pushConfigured: Boolean(process.env.GMAIL_PUBSUB_TOPIC && process.env.GMAIL_PUSH_AUDIENCE && process.env.GMAIL_PUSH_SERVICE_ACCOUNT),
    };
  });
}
export async function mutateSupport(
  b: Record<string, unknown>,
  u: DashboardUser,
) {
  const db = await operationsDb();
  return db.transaction(async (sql) => {
    if (b.action === "availability") {
      if (!manager(u) && String(b.agentId) !== u.id)
        throw new HttpError(403, "Manager access required");
      await sql`UPDATE support_agents SET available=${b.available === true} WHERE user_id=${String(b.agentId)}`;
      if (b.available === true) await assignWaitingTickets(sql);
      return { ok: true };
    }
    if (b.action === "create") {
      const email = required(b.email, "Customer email");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400,"Enter a valid customer email");
      await sql`SELECT pg_advisory_xact_lock(421994)`;
      const requestKey = required(b.requestKey,"Request key");
      const [existing] = await sql`SELECT id FROM support_tickets WHERE mailbox=${mailbox()} AND gmail_thread_id=${"manual:"+requestKey}`;
      if(existing) return {id:existing.id};
      await sql`INSERT INTO support_mailboxes(email,connected_by) VALUES(${mailbox()},${u.id}) ON CONFLICT(email) DO NOTHING`;
      const [agent] = await sql`SELECT a.user_id FROM support_agents a LEFT JOIN support_tickets t ON t.assignee_id=a.user_id AND t.status<>'resolved' WHERE a.available AND a.role='support_agent' GROUP BY a.user_id ORDER BY COUNT(t.id),a.user_id LIMIT 1`;
      if(!agent) throw new HttpError(409,"No available support agent. Register an agent before creating a ticket.");
      const id=randomUUID();
      await sql`INSERT INTO support_tickets(id,mailbox,gmail_thread_id,subject,customer_email,assignee_id) VALUES(${id},${mailbox()},${"manual:"+requestKey},${required(b.subject,"Subject")},${email},${agent.user_id})`;
      await sql`INSERT INTO support_messages(id,ticket_id,direction,sender,recipients,body,delivery_status,created_by) VALUES(${randomUUID()},${id},'inbound',${email},${mailbox()},${required(b.query,"Customer query")},'received',${u.id})`;
      await supportEvent(sql,u.id,id,"created_manually",{assigned:agent.user_id});
      return {id};
    }
    const id = required(b.ticketId, "Ticket");
    const t = await ticketAccess(sql, id, u);
    if (["reply", "note"].includes(String(b.action)) && b.requestKey) {
      const [existing] =
        await sql`SELECT id FROM support_messages WHERE ticket_id=${id} AND request_key=${String(b.requestKey)}`;
      if (existing) return { id: existing.id };
    }
    if (Number(b.version) !== t.version)
      throw new HttpError(
        409,
        "This ticket changed. Refresh before saving or replying.",
      );
    const action = String(b.action);
    if (action === "assign") {
      if (!manager(u)) throw new HttpError(403, "Manager access required");
      const target = String(b.agentId || "");
      if (target) {
        const [a] =
          await sql`SELECT * FROM support_agents WHERE user_id=${target} AND available`;
        if (!a) throw new HttpError(400, "Select an available agent");
      }
      await sql`UPDATE support_tickets SET assignee_id=${target || null} WHERE id=${id}`;
    } else if (action === "escalate") {
      const reason = required(b.reason, "Escalation reason");
      const [m] =
        await sql`SELECT * FROM support_agents WHERE role IN ('support_manager','admin') AND available ORDER BY CASE WHEN user_id=${String(b.agentId || "")} THEN 0 ELSE 1 END,role DESC LIMIT 1`;
      if (!m)
        throw new HttpError(
          409,
          "No manager is available; ask an admin to configure a support manager",
        );
      await sql`UPDATE support_tickets SET status='escalated',assignee_id=${m.user_id} WHERE id=${id}`;
      await supportEvent(sql, u.id, id, "escalation_reason", {
        reason,
        manager: m.email,
      });
    } else if (action === "status") {
      if (
        !["open", "in_progress", "waiting", "resolved"].includes(
          String(b.status),
        )
      )
        throw new HttpError(400, "Invalid status");
      await sql`UPDATE support_tickets SET status=${String(b.status)} WHERE id=${id}`;
    } else if (action === "priority") {
      if (!["low", "normal", "high", "urgent"].includes(String(b.priority)))
        throw new HttpError(400, "Invalid priority");
      await sql`UPDATE support_tickets SET priority=${String(b.priority)} WHERE id=${id}`;
    } else if (action === "note" || action === "reply") {
      const body = required(b.body, "Message");
      const key = required(b.requestKey, "Request key");
      const [old] =
        await sql`SELECT id FROM support_messages WHERE request_key=${key}`;
      if (old) return { id: old.id };
      await sql`INSERT INTO support_messages(id,ticket_id,message_id,direction,sender,recipients,body,delivery_status,request_key,resolve_after_send,created_by) VALUES(${randomUUID()},${id},${"<" + randomUUID() + "@satmi.in>"},${action === "note" ? "note" : "outbound"},${action === "note" ? u.email : mailbox()},${action === "note" ? "" : t.customer_email},${body},${action === "note" ? "note" : "queued"},${key},${b.resolve === true},${u.id})`;
    } else if (action === "retry") {
      const [m] =
        await sql`SELECT * FROM support_messages WHERE id=${String(b.messageId)} AND ticket_id=${id} FOR UPDATE`;
      if (!m || m.delivery_status !== "failed")
        throw new HttpError(409, "Only confirmed failed sends may be retried");
      await sql`UPDATE support_messages SET delivery_status='queued',last_error='' WHERE id=${m.id}`;
    } else throw new HttpError(400, "Unknown support action");
    await sql`UPDATE support_tickets SET version=version+1,updated_at=now() WHERE id=${id}`;
    await supportEvent(sql, u.id, id, action, {
      status: b.status || null,
      agentId: b.agentId || null,
    });
    return { ok: true };
  });
}
