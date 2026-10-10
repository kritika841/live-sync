"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Modal, useEntryDialog } from "../../Modal";
import {
  ChevronDown,
  CircleUserRound,
  Clock,
  KeyRound,
  LogOut,
  Pencil,
  ShieldCheck,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  banReason: string;
  createdAt: string;
  lastSignInAt?: string | null;
};

type UsersResponse = { users: ManagedUser[]; total: number; currentUserId?: string; error?: string };

function formatDate(value: string | undefined | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
}

export default function AdminUsers({
  currentUserId,
  active = true,
}: {
  currentUserId: string;
  active?: boolean;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const { requestEntry, dialog } = useEntryDialog();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const data = await response.json() as UsersResponse;
    if (!response.ok) throw new Error(data.error || "Could not load users");
    setUsers(data.users);
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/users", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as UsersResponse;
        if (!response.ok) throw new Error(data.error || "Could not load users");
        return data;
      })
      .then((data) => setUsers(data.users))
      .catch((loadError: Error) => { if (loadError.name !== "AbortError") setError(loadError.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  async function request(payload: Record<string, unknown>, key: string) {
    setBusy(key); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error || "The action could not be completed");
      setNotice(data.message || "Saved.");
      await loadUsers();
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The action could not be completed");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const saved = await request({ action: "create", name: values.get("name"), email: values.get("email"), password: values.get("password"), role: values.get("role") }, "create");
    if (saved) { form.reset(); setCreateOpen(false); }
  }

  async function editUser(user: ManagedUser) {
    const values = await requestEntry(`Edit ${user.name || user.email}`, [
      { name: "name", label: "Full Name", value: user.name },
      { name: "email", label: "Email Address", type: "email", value: user.email },
      {
        name: "role",
        label: "Assigned Role",
        value: user.role,
        options: [
          { value: "admin", label: "Administrator" },
          { value: "customer_support", label: "Customer Support" },
          { value: "support_agent", label: "Support Agent" },
          { value: "support_manager", label: "Support Manager" },
          { value: "operations", label: "Operations" },
          { value: "warehouse", label: "Warehouse" },
          { value: "user", label: "User" },
        ],
      },
    ]);
    if (!values) return;
    void request(
      {
        action: "update_info",
        userId: user.id,
        name: values.name,
        email: values.email,
        role: values.role,
      },
      `edit:${user.id}`
    );
  }

  async function setPassword(user: ManagedUser) {
    const values = await requestEntry("Set password", [{ name: "password", label: "New password (minimum 8 characters)", type: "password" }]);
    const password = values?.password ?? null;
    if (password === null) return;
    void request({ action: "set_password", userId: user.id, password }, `password:${user.id}`);
  }

  async function forceLogout(user: ManagedUser) {
    const confirmed = window.confirm(
      `Force logout "${user.name || user.email}"?\n\nThis will immediately revoke their refresh tokens and terminate all active login sessions.`
    );
    if (!confirmed) return;
    void request({ action: "force_logout", userId: user.id }, `logout:${user.id}`);
  }

  const totalUsers = users.length;
  const activeUsers = users.filter((u) => !u.banned).length;
  const adminUsers = users.filter((u) => u.role === "admin").length;
  const opsUsers = users.filter((u) => u.role !== "admin").length;

  return (
    <div className={`space-y-6 ${!active ? "view-hidden" : ""}`}>
      {dialog}
      {/* Top Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Access control</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard Users</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Manage team access, role permissions, sessions, and user credentials</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <ShieldCheck size={14} className="text-primary" /> Admin managed
          </span>
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-primary bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
            onClick={() => setCreateOpen(true)}
          >
            <UserPlus size={15} />
            <span>Add user</span>
          </button>
        </div>
      </div>

      {/* Metric summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <span className="text-[11px] font-medium text-muted-foreground">Total Users</span>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">{totalUsers}</p>
          <span className="text-[10px] text-muted-foreground">Registered accounts</span>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <span className="text-[11px] font-medium text-muted-foreground">Active Access</span>
          <p className="mt-1 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {activeUsers}
          </p>
          <span className="text-[10px] text-muted-foreground">Currently enabled</span>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <span className="text-[11px] font-medium text-muted-foreground">Administrators</span>
          <p className="mt-1 text-2xl font-bold tracking-tight text-primary">
            {adminUsers}
          </p>
          <span className="text-[10px] text-muted-foreground">Full privileges</span>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <span className="text-[11px] font-medium text-muted-foreground">Operations &amp; Agents</span>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            {opsUsers}
          </p>
          <span className="text-[10px] text-muted-foreground">Support &amp; warehouse</span>
        </div>
      </div>

      {(error || notice) && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-medium ${
            error
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-success/30 bg-success/10 text-success"
          }`}
        >
          {error || notice}
        </div>
      )}

      <Modal title="Add user" open={createOpen} onClose={() => setCreateOpen(false)} busy={!!busy}>
        <form className="space-y-4 p-5" onSubmit={createUser}>
          {error && (
            <p role="alert" className="rounded-lg bg-destructive/15 p-2.5 text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3 pb-3 border-b border-border">
            <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <UserPlus size={18} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Add a team user</h2>
              <p className="text-xs text-muted-foreground">Create account credentials with role access</p>
            </div>
          </div>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            <span>Name</span>
            <input
              name="name"
              required
              autoComplete="off"
              placeholder="Full name"
              className="h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            <span>Email address</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="off"
              placeholder="name@company.com"
              className="h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            <span>Password</span>
            <input
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
              placeholder="Minimum 8 characters"
              className="h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            <span>Role</span>
            <select
              name="role"
              defaultValue="user"
              className="h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
            >
              <option value="user">User</option>
              <option value="customer_support">Customer support</option>
              <option value="support_agent">Support agent</option>
              <option value="support_manager">Support manager</option>
              <option value="operations">Operations</option>
              <option value="warehouse">Warehouse</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={Boolean(busy)}
              className="rounded-lg border border-primary bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy === "create" ? "Adding…" : "Add user"}
            </button>
          </div>
        </form>
      </Modal>

      <section className="panel overflow-hidden">
        <header className="border-b border-border bg-muted/30 px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">People with access</h2>
            <p className="text-xs text-muted-foreground">
              {users.length} account{users.length === 1 ? "" : "s"} with system access
            </p>
          </div>
        </header>

        {loading ? (
          <div className="py-16 text-center text-xs text-muted-foreground">Loading users…</div>
        ) : users.length === 0 ? (
          <div className="py-16 text-center text-xs text-muted-foreground">No users found.</div>
        ) : (
          <div className="divide-y divide-border">
            {users.map((user) => {
              const self = user.id === currentUserId || user.email === "kritika@satmi.in";
              const isBusyRow = busy.includes(user.id);

              return (
                <article
                  className="flex flex-wrap items-center justify-between gap-4 p-4 lg:px-5 hover:bg-muted/30 transition-colors"
                  key={user.id}
                >
                  <div className="flex items-center gap-3 min-w-[240px]">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                      <CircleUserRound size={20} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <strong className="block text-sm font-semibold text-foreground truncate">
                          {user.name || user.email}
                        </strong>
                        {self && (
                          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                            You
                          </span>
                        )}
                      </div>
                      <span className="block text-xs text-muted-foreground truncate">{user.email}</span>
                      <div className="flex items-center gap-3 mt-0.5">
                        <small className="block text-[11px] text-muted-foreground/70">
                          Added {formatDate(user.createdAt)}
                        </small>
                        {user.lastSignInAt && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
                            <Clock size={11} className="text-muted-foreground/50" />
                            Active {formatDate(user.lastSignInAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        user.banned ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"
                      }`}
                    >
                      {user.banned ? "Disabled" : "Active"}
                    </span>

                    <button
                      disabled={Boolean(busy) || self}
                      onClick={async () => {
                        const result = await requestEntry("Change role", [
                          {
                            name: "role",
                            label: "Role",
                            value: user.role,
                            options: [
                              "user",
                              "customer_support",
                              "support_agent",
                              "support_manager",
                              "operations",
                              "warehouse",
                              "admin",
                            ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
                          },
                        ]);
                        if (result)
                          void request({ action: "set_role", userId: user.id, role: result.role }, `role:${user.id}`);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 capitalize transition"
                    >
                      <span>{user.role.replaceAll("_", " ")}</span>
                      {!self && <ChevronDown size={12} className="text-muted-foreground" />}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* 1. Edit User Info */}
                    <button
                      title="Edit user details (name, email, role)"
                      disabled={Boolean(busy) || isBusyRow}
                      onClick={() => editUser(user)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 transition"
                    >
                      <Pencil size={13} />
                      <span>Edit</span>
                    </button>

                    {/* 2. Set Password */}
                    <button
                      title="Assign a new password"
                      disabled={Boolean(busy) || isBusyRow}
                      onClick={() => setPassword(user)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 transition"
                    >
                      <KeyRound size={13} />
                      <span>Set password</span>
                    </button>

                    {/* 3. Force Logout */}
                    <button
                      title="Terminate all active login sessions for this account"
                      disabled={Boolean(busy) || isBusyRow}
                      onClick={() => forceLogout(user)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 transition"
                    >
                      <LogOut size={13} />
                      <span>Force logout</span>
                    </button>

                    {/* 4. Disable / Enable Account */}
                    <button
                      disabled={Boolean(busy) || self || isBusyRow}
                      onClick={() =>
                        void request(
                          { action: user.banned ? "enable" : "disable", userId: user.id },
                          `${user.banned ? "enable" : "disable"}:${user.id}`
                        )
                      }
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-50 transition ${
                        user.banned
                          ? "border-success/40 bg-success/10 text-success hover:bg-success/20"
                          : "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
                      }`}
                    >
                      {user.banned ? <UserRoundCheck size={13} /> : <UserRoundX size={13} />}
                      <span>{user.banned ? "Enable" : "Disable"}</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
