"use client";

import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import { useState } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/client";

export default function AccountMenu({ name, email, isAdmin }: { name: string; email: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";

  async function signOut() {
    setSigningOut(true);
    await createSupabaseBrowserClient().auth.signOut();
    window.location.assign("/auth/sign-in");
  }

  return (
    <div className="account-menu">
      <button className="avatar" aria-label="Open account menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{initials}</button>
      {open && <div className="account-popover">
        <div><strong>{name}</strong><span>{email}</span></div>
        {isAdmin && <Link href="/admin/users"><Settings size={15}/> Manage users</Link>}
        <button onClick={signOut} disabled={signingOut}><LogOut size={15}/>{signingOut ? "Signing out…" : "Sign out"}</button>
      </div>}
    </div>
  );
}
