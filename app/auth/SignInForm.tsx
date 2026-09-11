"use client";

import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";

export default function SignInForm({configured=true}:{configured?:boolean}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!configured)return; setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
    const { error: signInError } = await createSupabaseBrowserClient().auth.signInWithPassword({ email: String(form.get("email")), password: String(form.get("password")) });
    if (signInError) { setError(signInError.code === "invalid_credentials" ? "The email or password is incorrect." : signInError.code === "email_not_confirmed" ? "Confirm your email before signing in." : "Sign-in is temporarily unavailable. Please try again."); setBusy(false); return; }
    window.location.assign("/");
    } catch { setError("Sign-in is temporarily unavailable. Please contact your administrator."); setBusy(false); }
  }
  return <form className="standalone-signin" onSubmit={submit}>
    <label><span>Email address</span><input name="email" type="email" autoComplete="username" required /></label>
    <label><span>Password</span><input name="password" type="password" autoComplete="current-password" required /></label>
    {!configured && <p className="signin-error" role="status">Sign-in is unavailable on this server.</p>}
    {error && <p className="signin-error">{error}</p>}
    <button type="submit" disabled={busy||!configured}>{busy ? "Signing in…" : "Sign in"}</button>
  </form>;
}
