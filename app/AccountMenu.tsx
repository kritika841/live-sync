"use client";

import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import { useState } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/client";

export default function AccountMenu({ name, email, isAdmin, preview=false }: { name: string; email: string; isAdmin: boolean; preview?:boolean }) {
  const [open, setOpen] = useState(false);
  const [error,setError]=useState("");
  const [signingOut, setSigningOut] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";

  async function signOut() {
    if(preview){window.location.assign("/auth/sign-in");return;}
    setSigningOut(true);setError("");
    try{
      const {error}=await createSupabaseBrowserClient().auth.signOut({scope:"local"});
      if(error)throw error;
      window.location.assign("/auth/sign-in");
    }catch{setError("Could not sign out. Please try again.");setSigningOut(false);}

  }

  return (
    <div className="relative">
      <button
        className="flex size-9 items-center justify-center rounded-full border border-border bg-accent text-accent-foreground text-xs font-bold tracking-wide transition hover:ring-2 hover:ring-ring/30 focus-visible:outline-none"
        aria-label="Open account menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {initials}
      </button>

      {open && (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 bg-transparent border-0 cursor-default w-full h-full" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-border bg-card p-1.5 text-card-foreground shadow-float">
            <div className="border-b border-border px-3 py-2.5">
              <strong className="block text-sm font-semibold text-foreground truncate">{name}</strong>
              <span className="block text-xs text-muted-foreground truncate">{email}</span>
            </div>
            <div className="py-1">
              {isAdmin && !preview && (
                <Link
                  href="/admin/users"
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground transition hover:bg-muted"
                  onClick={() => setOpen(false)}
                >
                  <Settings size={15} className="text-muted-foreground" />
                  Manage users
                </Link>
              )}
              <button
                onClick={signOut}
                disabled={signingOut}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
              >
                <LogOut size={15} />
                {signingOut ? "Signing out…" : preview ? "Sign in" : "Sign out"}
              </button>
            </div>
            {error && <p role="alert" className="px-3 py-1.5 text-xs text-destructive">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}

