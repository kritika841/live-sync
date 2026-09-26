"use client";

import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";

export default function SignInForm({ configured = true }: { configured?: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const { error: signInError } = await createSupabaseBrowserClient().auth.signInWithPassword({
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      if (signInError) {
        setError(
          signInError.code === "invalid_credentials"
            ? "The email or password is incorrect."
            : signInError.code === "email_not_confirmed"
            ? "Confirm your email before signing in."
            : "Sign-in is temporarily unavailable. Please try again."
        );
        setBusy(false);
        return;
      }
      window.location.assign("/");
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

      {!configured && (
        <p className="signin-error rounded-lg bg-destructive/15 p-2.5 text-xs font-medium text-destructive" role="status">
          Sign-in is unavailable on this server.
        </p>
      )}

      {error && (
        <p className="signin-error rounded-lg bg-destructive/15 p-2.5 text-xs font-medium text-destructive">
          {error}
        </p>
      )}

      <button type="submit"
        disabled={busy || !configured}
        className="w-full inline-flex items-center justify-center h-10 px-4 rounded-lg font-bold text-sm tracking-wide transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
