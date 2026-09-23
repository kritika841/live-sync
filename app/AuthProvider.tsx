"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/client";

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return;
    // Keep the browser session refreshed while a dashboard stays open. Server
    // routes still validate identity and permissions with Supabase getUser.
    const client = createSupabaseBrowserClient();
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && !window.location.pathname.startsWith("/auth/") && window.location.pathname !== "/preview") {
        window.location.assign("/auth/sign-in");
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return children;
}
