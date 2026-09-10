"use client";

import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";

export default function SignInForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const { error: signInError } = await createSupabaseBrowserClient().auth.signInWithPassword({ email: String(form.get("email")), password: String(form.get("password")) });
    if (signInError) { setError("The email or password is incorrect."); setBusy(false); return; }
    window.location.assign("/");
  }
  return <form className="standalone-signin" onSubmit={submit}>
    <label><span>Email address</span><input name="email" type="email" autoComplete="username" required /></label>
    <label><span>Password</span><input name="password" type="password" autoComplete="current-password" required /></label>
    {error && <p className="signin-error">{error}</p>}
    <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
  </form>;
}
