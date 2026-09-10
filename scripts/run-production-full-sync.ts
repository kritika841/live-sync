import { createServerClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const dashboardUrl = process.env.DASHBOARD_URL;
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!supabaseUrl || !publishableKey || !dashboardUrl || !adminEmail || !adminPassword) {
  throw new Error("Supabase, dashboard, and admin environment variables are required");
}

type Cookie = { name: string; value: string };
let cookies: Cookie[] = [];
const auth = createServerClient(supabaseUrl, publishableKey, {
  cookies: {
    getAll: () => cookies,
    setAll: (values) => { cookies = values.map(({ name, value }) => ({ name, value })); },
  },
});
const signedIn = await auth.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
if (signedIn.error) throw signedIn.error;

let page: number | undefined;
let mode: "incremental" | "full" = "incremental";
let imported = 0;
do {
  const response = await fetch(`${dashboardUrl}/api/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
      origin: dashboardUrl,
      "sec-fetch-site": "same-origin",
      "x-requested-with": "satmi-orders-dashboard",
    },
    body: JSON.stringify({ mode, page }),
  });
  const result = await response.json() as {
    error?: string; synced?: number; mode?: "incremental" | "full";
    hasMore?: boolean; nextPage?: number; totalPages?: number;
  };
  if (!response.ok) throw new Error(result.error || `Sync failed with status ${response.status}`);
  imported += Number(result.synced || 0);
  if (result.mode === "full") mode = "full";
  page = result.hasMore ? result.nextPage : undefined;
  console.log(JSON.stringify({ imported, nextPage: page || null, totalPages: result.totalPages || null }));
} while (page);
