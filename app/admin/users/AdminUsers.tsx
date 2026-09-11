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
    <section className="admin-workspace">{dialog}
      <div className="admin-heading">
        <div><p className="eyebrow">Access control</p><h1>Dashboard users</h1></div>
        <span><ShieldCheck size={17}/> Admin managed</span>
      </div>

      {(error || notice) && <div className={`admin-notice ${error ? "error" : "success"}`}>{error || notice}</div>}

      <button className="action-launch" onClick={()=>setCreateOpen(true)}>+ Add user</button><Modal title="Add user" open={createOpen} onClose={()=>setCreateOpen(false)} busy={!!busy}><form className="invite-card" onSubmit={createUser}>{error && <p role="alert" className="signin-error">{error}</p>}
        <div className="invite-copy"><span><UserPlus size={18}/></span><div><h2>Add a user</h2></div></div>
        <label><span>Name</span><input name="name" required autoComplete="off" placeholder="Full name" /></label>
        <label><span>Email address</span><input name="email" type="email" required autoComplete="off" placeholder="name@company.com" /></label>
        <label><span>Password</span><input name="password" type="password" minLength={8} required autoComplete="new-password" placeholder="Minimum 8 characters" /></label>
        <label><span>Role</span><select name="role" defaultValue="user"><option value="user">User</option><option value="admin">Administrator</option><option value="support_manager">Support manager</option><option value="support_agent">Support agent</option><option value="operations">Operations</option><option value="warehouse">Warehouse</option></select></label>
        <button disabled={Boolean(busy)}>{busy === "create" ? "Adding…" : "Add user"}</button>
      </form></Modal>

      <section className="users-card">
        <header><div><h2>People with access</h2><p>{users.length} account{users.length === 1 ? "" : "s"}</p></div></header>
        {loading ? <div className="admin-empty">Loading users…</div> : users.length === 0 ? <div className="admin-empty">No users found.</div> : (
          <div className="user-list">
            {users.map((user) => {
              const self = user.id === currentUserId;
              return <article className="user-row" key={user.id}>
                <span className="user-icon"><CircleUserRound size={20}/></span>
                <div className="user-identity"><strong>{user.name || user.email}{self && <em>You</em>}</strong><span>{user.email}</span><small>Added {formatDate(user.createdAt)}</small></div>
                <div className={`user-status ${user.banned ? "disabled" : "active"}`}>{user.banned ? "Disabled" : "Active"}</div>
                <button disabled={Boolean(busy)||self} onClick={async()=>{const result=await requestEntry("Change role",[{name:"role",label:"Role",value:user.role,options:["user","admin","support_manager","support_agent","operations","warehouse"].map(value=>({value,label:value.replaceAll("_"," ")}))}]);if(result)void request({action:"set_role",userId:user.id,role:result.role},`role:${user.id}`);}}>{user.role.replaceAll("_"," ")}</button>
                <div className="user-actions">
                  <button title="Assign a new password" disabled={Boolean(busy)} onClick={() => setPassword(user)}><KeyRound size={15}/> Set password</button>
                  <button className={user.banned ? "enable" : "disable"} disabled={Boolean(busy) || self} onClick={() => void request({ action: user.banned ? "enable" : "disable", userId: user.id }, `${user.banned ? "enable" : "disable"}:${user.id}`)}>{user.banned ? <UserRoundCheck size={15}/> : <UserRoundX size={15}/>} {user.banned ? "Enable" : "Disable"}</button>
                </div>
              </article>;
            })}
          </div>
        )}
      </section>
    </section>
  );
}
