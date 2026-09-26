"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Modal, useEntryDialog } from "../../Modal";
import { CircleUserRound, KeyRound, ShieldCheck, UserPlus, UserRoundCheck, UserRoundX } from "lucide-react";

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  banReason: string;
  createdAt: string;
};

type UsersResponse = { users: ManagedUser[]; total: number; error?: string };

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
}

export default function AdminUsers({ currentUserId }: { currentUserId: string }) {
  const [createOpen,setCreateOpen]=useState(false);
  const {requestEntry,dialog}=useEntryDialog();
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
    const saved=await request({ action: "create", name: values.get("name"), email: values.get("email"), password: values.get("password"), role: values.get("role") }, "create");
    if(saved){form.reset();setCreateOpen(false);}
  }

  async function setPassword(user: ManagedUser) {
    const values=await requestEntry("Set password",[{name:"password",label:"New password (minimum 8 characters)",type:"password"}]);
    const password=values?.password ?? null;
    if (password === null) return;
    void request({ action: "set_password", userId: user.id, password }, `password:${user.id}`);
  }

  return (
    <div className="space-y-6">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Access control</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard Users</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Manage team access and role permissions</p>
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
              <option value="admin">Administrator</option>
              <option value="support_manager">Support manager</option>
              <option value="support_agent">Support agent</option>
              <option value="operations">Operations</option>
              <option value="warehouse">Warehouse</option>
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
              const self = user.id === currentUserId;
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
                          <span className="rounded-full bg-primary/15 px-2 py-0.2 text-[10px] font-bold text-primary">
                            You
                          </span>
                        )}
                      </div>
                      <span className="block text-xs text-muted-foreground truncate">{user.email}</span>
                      <small className="block text-[11px] text-muted-foreground/70">
                        Added {formatDate(user.createdAt)}
                      </small>
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
                              "admin",
                              "support_manager",
                              "support_agent",
                              "operations",
                              "warehouse",
                            ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
                          },
                        ]);
                        if (result)
                          void request({ action: "set_role", userId: user.id, role: result.role }, `role:${user.id}`);
                      }}
                      className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 capitalize"
                    >
                      {user.role.replaceAll("_", " ")}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      title="Assign a new password"
                      disabled={Boolean(busy)}
                      onClick={() => setPassword(user)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <KeyRound size={13} />
                      <span>Set password</span>
                    </button>
                    <button
                      disabled={Boolean(busy) || self}
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

