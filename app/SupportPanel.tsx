"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Inbox,
  Mail,
  Search,
  RefreshCw,
  Send,
  ArrowUpRight,
  LockKeyhole,
  Settings,
  Paperclip,
  CheckCircle2,
  Users,
} from "lucide-react";
import { Modal, useEntryDialog } from "./Modal";
import { readJson } from "../lib/http";
import type { supportData } from "../lib/operations/support";
type Data = Awaited<ReturnType<typeof supportData>>;
type Message = {
  id: string;
  direction: string;
  body: string;
  sender: string;
  created_at: string;
  delivery_status: string;
  last_error: string;
  attachments: Array<{ name: string; attachmentId: string }>;
};
type Event = {
  id: string;
  action: string;
  created_at: string;
  actor_id: string;
  details: unknown;
};
const empty = {
  tickets: [],
  selectedTicket: null,
  page: 1,
  totalPages: 1,
  total: 0,
  summary: { open: 0, unassigned: 0, escalated: 0, resolved: 0 },
  agents: [],
  messages: [],
  events: [],
  orders: [],
  customer: { name: "", email: "", phone: "", tags: [] },
  connection: { email: "kritika@satmi.in", connected: false },
  canManage: false,
  userId: "",
  configured: false,
  pushConfigured: false,
} as unknown as Data;
const date = (s: unknown) =>
  s
    ? new Date(String(s)).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Never";
export default function SupportPanel({
  active,
  preview = false,
  isAdmin = false,
}: {
  active: boolean;
  preview?: boolean;
  isAdmin?: boolean;
}) {
  const [data, setData] = useState<Data>(empty),
    [selected, setSelected] = useState(""),
    [page, setPage] = useState(1),
    [queue, setQueue] = useState("all"),
    [search, setSearch] = useState(""),
    [body, setBody] = useState(""),
    [mode, setMode] = useState("reply"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [requestKey, setRequestKey] = useState("");
  const {requestEntry,dialog}=useEntryDialog();
  const [loaded,setLoaded]=useState(false);
  const loadController = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (preview) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    try {
      setData(
        await readJson<Data>(
          await fetch(
            "/api/support?" +
              new URLSearchParams({
                ticket: selected,
                page: String(page),
                queue,
                q: search,
              }),
            { cache: "no-store", signal: controller.signal },
          ),
        ),
      );
      setLoaded(true);
      setError("");
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Could not load support");
    }
  }, [preview, selected, page, queue, search]);
  useEffect(() => {
    if (!active) return;
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 30000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      loadController.current?.abort();
    };
  }, [active, load]);
  const ticket =
    data.selectedTicket?.id === selected ? data.selectedTicket : null;
  const canManage = isAdmin || data.canManage;
  async function act(action: string, b: Record<string, unknown> = {}) {
    if (preview) {
      setError(
        "Preview only. Connect the live database and Gmail to use ticket actions.",
      );
      return false;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await readJson<{ notice?: string }>(
        await fetch("/api/support", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            ticketId: selected,
            version: ticket?.version,
            ...b,
          }),
        }),
      );
      setNotice(result.notice || "Saved.");
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function send(resolve = false) {
    const key = requestKey || crypto.randomUUID();
    setRequestKey(key);
    if (await act(mode, { body, requestKey: key, resolve })) {
      setBody("");
      setRequestKey("");
    }
  }
  const filtered = data.tickets;
  if (!active) return null;
  return (
    <section className="ops-workspace support-workspace">{dialog}
      <div className="inventory-health">
        <div>
          <span>Customer support</span>
          <strong>{data.connection.email}</strong>

        </div>
        <div className="ops-actions">
          <span
            className={`ops-connection ${data.connection.connected ? "connected" : ""}`}
          >
            {!loaded ? "Status unavailable" : data.connection.connected ? "Connected" : "Not connected"}
          </span>
          <button onClick={() => setSettings(!settings)}>
            <Settings size={15} /> Mailbox & team
          </button>
        </div>
      </div>
      {error && (
        <div className="ops-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="inventory-notice" role="status">
          {notice}
        </div>
      )}
      <Modal title="Mailbox & team" open={settings} onClose={()=>setSettings(false)} wide>
        <div className="ops-two">
          <article className="ops-card">
            <Mail size={24} />
            <h2>Mailbox connection</h2>
            {error && <p className="ops-error" role="alert">{error} <button onClick={()=>void load()}>Retry</button></p>}
            <p>
              Read and reply as kritika@satmi.in. Initial import covers the last
              30 days; subsequent syncs catch new conversations and replies.
            </p>
            <div className="ops-check">
              <span>Google OAuth credentials</span>
              <strong>{!loaded ? "Status unavailable" : data.configured ? "Ready" : "Setup needed"}</strong>
            </div>
            <div className="ops-check">
              <span>Mailbox authorization</span>
              <strong>
                {!loaded ? "Status unavailable" : data.connection.connected ? "Connected" : "Not connected"}
              </strong>
            </div>
            <div className="ops-check">
              <span>Push notifications</span>
              <strong>
                {!loaded ? "Status unavailable" : data.pushConfigured ? "Configured" : "Setup needed"}
              </strong>
            </div>
            <div className="ops-check">
              <span>History import</span>
              <strong>
                {!loaded ? "Status unavailable" : data.connection.import_complete ? "Complete" : "Importing recent mail"}
              </strong>
            </div>
            {data.connection.last_error && (
              <p className="ops-error">{data.connection.last_error}</p>
            )}
            <div className="ops-actions">
              {isAdmin && data.configured && !preview ? (
                <a className="ops-primary" href="/api/support/gmail/connect">
                  {data.connection.connected
                    ? "Reconnect Gmail"
                    : "Connect Gmail"}
                </a>
              ) : (
                <button disabled>Connect Gmail — setup required</button>
              )}
              {canManage && (
                <button
                  disabled={busy || !data.connection.connected}
                  onClick={() => void act("sync")}
                >
                  <RefreshCw size={14} /> Sync now
                </button>
              )}
            </div>
            <p className="ops-muted">
              Google sign-in is completed by the mailbox owner. Your Gmail
              password is never stored.
            </p>
          </article>
          <article className="ops-card">
            <Users size={24} />
            <h2>Support team</h2>
            <p>
              New tickets go to the available agent with the fewest unresolved
              tickets. Managers can reassign or take escalations.
            </p>
            {canManage && (
              <button disabled={busy} onClick={() => void act("team")}>
                Refresh team from Manage users
              </button>
            )}
            {data.agents.map((a) => (
              <div className="ops-history" key={a.user_id}>
                <span>
                  <strong>{a.name}</strong>
                  <small>
                    {a.email} · {a.role.replaceAll("_", " ")}
                  </small>
                </span>
                <button
                  disabled={busy || (!canManage && a.user_id !== data.userId)}
                  onClick={() =>
                    void act("availability", {
                      agentId: a.user_id,
                      available: !a.available,
                    })
                  }
                >
                  {a.available ? "Available" : "Away"}
                </button>
              </div>
            ))}
            {!data.agents.length && (
              <p className="ops-muted">
                Assign Support agent or Support manager roles in Manage users,
                then refresh the team.
              </p>
            )}
          </article>
        </div>
      </Modal>
      <div className="inventory-metrics support-metrics">
        {[
          ["Open tickets", data.summary.open, "Awaiting a solution"],
          [
            "Unassigned",
            data.summary.unassigned,
            "Ready for assignment",
          ],
          ["Escalated", data.summary.escalated, "Manager attention"],
          ["Resolved", data.summary.resolved, "Customer queries closed"],
        ].map(([label, value, sub]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{sub}</small>
          </article>
        ))}
      </div>
      <div className="support-inbox">
        <aside className="support-queues">
          <p className="eyebrow">Inbox</p>
          {[
            ["all", "All tickets"],
            ["mine", "Assigned to me"],
            ["unassigned", "Unassigned"],
            ["open", "Open"],
            ["in_progress", "In progress"],
            ["waiting", "Waiting for customer"],
            ["escalated", "Escalated"],
            ["resolved", "Resolved"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={queue === key ? "active" : ""}
              onClick={async () => {
                setQueue(key);
                setPage(1);
              }}
            >
              <Inbox size={14} />
              {label}
            </button>
          ))}
        </aside>
        <div className="support-list">
          <button disabled={busy} onClick={async()=>{const entry=await requestEntry("Create support ticket",[{name:"subject",label:"Subject"},{name:"email",label:"Customer email",type:"email"},{name:"query",label:"Customer query"}]); if(entry) await act("create",{...entry,requestKey:crypto.randomUUID()});}}>New ticket</button>
          <label className="ops-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search tickets or customers"
            />
          </label>
          <div className="support-list-heading">
            <span>{data.total} conversations</span>
            <button onClick={() => void load()} aria-label="Refresh tickets">
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="ops-actions support-pagination">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>
              {page} / {data.totalPages}
            </span>
            <button
              disabled={page >= data.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
          {filtered.map((t) => (
            <button
              key={t.id}
              className={`support-ticket ${selected === t.id ? "selected" : ""}`}
              onClick={async () => {
                if (
                  body &&
                  !confirm("Discard the unsent draft and switch tickets?")
                )
                  return;
                setSelected(t.id);
                setBody("");
                setRequestKey("");
              }}
            >
              <div>
                <span>SUP-{String(t.ticket_number).padStart(6, "0")}</span>
                <time>{date(t.updated_at)}</time>
              </div>
              <strong>{t.subject}</strong>
              <p>{t.customer_email}</p>
              <div>
                <span className="inventory-status">
                  {t.status.replaceAll("_", " ")}
                </span>
                <span>
                  {data.agents.find((a) => a.user_id === t.assignee_id)?.name ||
                    "Unassigned"}
                </span>
              </div>
            </button>
          ))}
          {!filtered.length && (
            <div className="ops-empty">
              <Mail size={28} />
              <h3>
                {data.connection.connected
                  ? "No tickets in this queue"
                  : "Your inbox is ready"}
              </h3>
              <p>
                {data.connection.connected
                  ? "New customer queries will appear here after synchronization."
                  : "Connect Gmail to import messages and automatically create tickets."}
              </p>
            </div>
          )}
        </div>
        {ticket && (
          <aside className="support-ticket-fields">
            <p className="eyebrow">Ticket controls</p>
            <label>
              Assignee
              <select
                disabled={busy || !canManage}
                value={ticket.assignee_id || ""}
                onChange={(event) => void act("assign", { agentId: event.target.value })}
              >
                <option value="">Unassigned</option>
                {data.agents.filter((agent) => agent.available).map((agent) => (
                  <option key={agent.user_id} value={agent.user_id}>{agent.name}</option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                disabled={busy}
                value={ticket.status}
                onChange={(event) => void act("status", { status: event.target.value })}
              >
                {["open", "in_progress", "waiting", "resolved"].map((status) => (
                  <option key={status} value={status}>{status.replaceAll("_", " ")}</option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                disabled={busy}
                value={ticket.priority}
                onChange={(event) => void act("priority", { priority: event.target.value })}
              >
                {["low", "normal", "high", "urgent"].map((priority) => (
                  <option key={priority} value={priority}>{priority}</option>
                ))}
              </select>
            </label>
            <button
              disabled={busy}
              onClick={async () => {
                const response = await requestEntry("Escalate ticket", [{ name: "reason", label: "Reason" }]);
                if (response?.reason) void act("escalate", { reason: response.reason });
              }}
            >
              <ArrowUpRight size={14} /> Escalate
            </button>
          </aside>
        )}
        <div className="support-conversation">
          {ticket ? (
            <>
              <header>
                <p className="eyebrow">
                  SUP-{String(ticket.ticket_number).padStart(6, "0")}
                </p>
                <h2>{ticket.subject}</h2>
                <p>{ticket.customer_email} · Assigned to {data.agents.find(a => a.user_id===ticket.assignee_id)?.name || "Awaiting available agent"}</p>
                <span className="support-channel">Email conversation</span>
              </header>
              <div className="support-thread">
                {(data.messages as Message[]).map((m) => (
                  <article
                    key={m.id}
                    className={`support-message ${m.direction}`}
                  >
                    <div>
                      <strong>
                        {m.direction === "note" ? (
                          <>
                            <LockKeyhole size={12} /> Private note ·{" "}
                          </>
                        ) : null}
                        {m.sender}
                      </strong>
                      <time>{date(m.created_at)}</time>
                    </div>
                    <p>{m.body}</p>
                    {m.attachments?.map((a) => (
                      <a
                        key={a.attachmentId}
                        href={
                          "/api/support/attachment?" +
                          new URLSearchParams({
                            message: m.id,
                            attachment: a.attachmentId,
                          })
                        }
                      >
                        <Paperclip size={13} /> {a.name}
                      </a>
                    ))}
                    <small>
                      {m.delivery_status === "sent"
                        ? "Sent via Gmail"
                        : m.delivery_status}
                    </small>
                    {m.last_error && (
                      <p className="ops-error">{m.last_error}</p>
                    )}
                    {m.delivery_status === "failed" && (
                      <button
                        disabled={busy}
                        onClick={() => void act("retry", { messageId: m.id })}
                      >
                        Retry send
                      </button>
                    )}
                  </article>
                ))}
              </div>

              <div className="support-composer">
                <div className="ops-actions">
                  <button
                    className={mode === "reply" ? "selected" : ""}
                    onClick={() => setMode("reply")}
                  >
                    <Mail size={14} /> Reply to customer
                  </button>
                  <button
                    className={mode === "note" ? "selected" : ""}
                    onClick={() => setMode("note")}
                  >
                    <LockKeyhole size={14} /> Internal note
                  </button>
                </div>
                <p className="ops-muted">
                  {mode === "reply"
                    ? `To ${ticket.customer_email} · From kritika@satmi.in`
                    : "Visible only to your support team"}
                </p>
                <textarea
                  aria-label={
                    mode === "reply" ? "Customer reply" : "Internal note"
                  }
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={
                    mode === "reply"
                      ? "Write your response…"
                      : "Add context for your team…"
                  }
                />
                <div className="ops-actions">
                  <button
                    className="ops-primary"
                    disabled={busy || !body.trim()}
                    onClick={() => void send()}
                  >
                    <Send size={14} />
                    {mode === "note" ? "Save note" : "Send reply"}
                  </button>
                  {mode === "reply" && (
                    <button
                      disabled={busy || !body.trim()}
                      onClick={() => void send(true)}
                    >
                      <CheckCircle2 size={14} /> Send & resolve
                    </button>
                  )}
                </div>
              </div>

            </>
          ) : (
            <div className="support-welcome">
              <div>
                <Mail size={36} />
              </div>
              <h2>
                Customer conversations,
                <br />
                in one place.
              </h2>
              <p>
                Select a ticket to read the complete email thread, reply to your
                customer, or bring in a manager.
              </p>
              <span>
                <LockKeyhole size={13} /> Internal notes stay inside your team
              </span>
            </div>
          )}
        </div>
        {ticket && (
          <aside className="support-context">
                <p className="eyebrow">Requester</p>
                <h3>{data.customer.name || "Customer"}</h3>
                <p>{data.customer.email}</p>
                {data.customer.phone && <p>{data.customer.phone}</p>}
                {!!data.customer.tags.length && <div className="support-tags">{data.customer.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
                <h3>Recent orders</h3>
                {(
                  data.orders as {
                    id: number;
                    channel_order_id: string;
                    status: string;
                    awb: string;
                  }[]
                ).map((o) => (
                  <p key={o.id}>
                    {o.channel_order_id} · {o.status} · AWB {o.awb || "—"}
                  </p>
                ))}
                <h3>Interactions</h3>
                {(data.events as Event[]).map((event) => (
                  <p key={event.id}>{date(event.created_at)} · {event.action.replaceAll("_", " ")}</p>
                ))}
              </aside>
        )}
      </div>
    </section>
  );
}
