"use client";

import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";

export default function SignInForm({ configured = true }: { configured?: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");

    try {
      // 1. Authenticate against local self-hosted Postgres endpoint
      const res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok) {
        window.location.assign("/");
        return;
      }

      if (data?.error && res.status !== 500) {
        setError(data.error);
        setBusy(false);
        return;
      }

      // 2. Optional fallback to Supabase browser client if configured
      if (configured) {
        try {
          const { error: signInError } = await createSupabaseBrowserClient().auth.signInWithPassword({
            email,
            password,
          });
          if (!signInError) {
            window.location.assign("/");
            return;
          }
        } catch {
          // Supabase might be disabled or quota-exceeded; ignore
        }
      }

      setError(data?.error || "The email or password is incorrect.");
      setBusy(false);
    } catch {
      setError("Sign-in is temporarily unavailable. Please contact your administrator.");
      setBusy(false);
    }
  }

  return (
    <form className="standalone-signin space-y-4" onSubmit={submit}>
      <label className="block text-left">
        <span className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
          Email address
        </span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="name@company.com"
          className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground hover:border-ring/50 focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted"
        />
      </label>

      <label className="block text-left">
        <span className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
          Password
        </span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground hover:border-ring/50 focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted"
        />
      </label>

      {error && (
        <p className="signin-error rounded-lg bg-destructive/15 p-2.5 text-xs font-medium text-destructive">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full inline-flex items-center justify-center h-10 px-4 rounded-lg font-bold text-sm tracking-wide transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
