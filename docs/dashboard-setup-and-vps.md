# Dashboard setup, new features and VPS deployment

Local server: http://127.0.0.1:5010/preview. Sign-in: http://127.0.0.1:5010/auth/sign-in. Port 5000 was occupied by macOS Control Center and returned HTTP 403. For local Gmail authorization use callback http://127.0.0.1:5010/api/support/gmail/callback.

## Verified on 11 September 2026

Shopify credentials have been saved in ignored `.env.local`. A complete paginated read-only catalog fetch succeeded: **74 products, 116 variants**. The fetched catalog is in ignored `.local/shopify-products.json`. No Shopify products were edited. Dashboard catalog import is still blocked by the unavailable database; once restored, Inventory → Products → Sync Shopify products imports the catalog into the existing database. Recipes are entered separately.

Shiprocket login and order listing both returned HTTP 200. The local database returned SQLSTATE 53000 (the older Neon connection's data-transfer quota). Shiprocket itself is reachable; the app cannot read/write its local-configured database. Production has a separate Supabase database setting, which has not been retrieved or verified. Do not replace the database or assume the production Supabase project needs a quota upgrade.

Local Supabase URL, publishable key, database connection and service-role settings are missing. Restoring the existing project's settings requires the outstanding explicit authorization to retrieve only those values from Vercel, or entering them through the local environment editor. Never paste passwords or tokens in chat.

`/preview` is a development UI without an authenticated session. Its account action now says Sign in. The real login is `/auth/sign-in`; once configuration is restored use the email/password for an existing dashboard account, not Shopify credentials or your Gmail password. An administrator can create an account in Manage users. Do not change an existing user's password without their authorization. An authenticated Sign out ends this browser's session; it no longer stays stuck on an unhandled error.

## What the new features do

**Inventory:** Components are the raw stock units. Vendors and purchase orders track ordered quantities, vendor order numbers and receipts. Partial receiving increases inventory by accepted quantities and keeps receipt history. Kilogram/gram conversion supports pack equivalents: 1 kg at 200 g per pack represents 5 packs. Recipes map product variants to components; missing recipes do not consume guessed stock. Manual sales use recipes. Invoices attach to a vendor PO. Activity links purchasing, receiving, invoices and stock movements. Returns require QC before reusable stock is restored.

**Customer support:** Connect the mailbox once as an administrator. Incoming Gmail conversations become tickets with unique SUP numbers; replies remain on the same ticket. New tickets are assigned among available agents based on workload. Managers can reassign and set availability. Agents open their tickets, reply in the dashboard, add private notes, or escalate with a reason to the manager queue. A resolution reply is sent to the customer through the connected Gmail mailbox; private notes never send. Failed/uncertain sends remain visible in the outbox workflow rather than being silently declared delivered. A new customer response can reopen a resolved ticket.

**Mailbox activation:** In Google Cloud enable Gmail and Pub/Sub, configure a web OAuth client and its consent application, and add the exact callback URI `https://YOUR-DASHBOARD-DOMAIN/api/support/gmail/callback`. Supply GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and a stable SUPPORT_TOKEN_KEY through the environment editor. Use `scripts/setup-gmail-push.sh` with your authorized Google project and dashboard domain to configure authenticated push and output the required settings. In Customer support → Mailbox & team → Connect Gmail, sign in to **kritika@satmi.in** and approve access. Refresh team membership after assigning support roles. Start the scheduler. The initial import covers the last 30 days in batches, not the entire mailbox lifetime; subsequent runs catch up on new messages. If older history is needed, change the import window deliberately before initial import.

Gmail notification watches expire and must be renewed. The implemented support worker performs renewal and periodic catch-up. Google requires renewal at least every seven days and recommends daily renewal: [Gmail push documentation](https://developers.google.com/workspace/gmail/api/guides/push). The detailed setup is in `operations-go-live.md`.

**Order refresh:** The browser checks for updated stored orders every 10 seconds, replacing row data without blanking the current table. Filters retain the old snapshot until the next result arrives; selection across filter changes is reset. The external worker checks recent Shiprocket orders every minute even when the browser is closed, while provider webhooks handle event-driven updates. This is not a promise of instantaneous Shopify-to-Shiprocket propagation.

## Hosting without Vercel Pro

Yes, two or more projects can share one VPS if CPU/RAM/storage capacity permits. Use a separate directory, service account/process, environment file and private port for each project. Route separate domains/subdomains through the existing reverse proxy. Keep the current site's configuration intact. The existing Postgres/Supabase database can remain hosted where it is.

Recommended layout: existing project stays on its current port; this app listens on `127.0.0.1:5001`; a new dashboard subdomain routes through Nginx with HTTPS. Next.js supports self-hosting and recommends a reverse proxy: [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

A VPS scheduler can also call a remotely hosted dashboard. However, Vercel Hobby is restricted to non-commercial personal use, so it is not the appropriate free production plan for this business dashboard: [Vercel Hobby terms](https://vercel.com/docs/plans/hobby). Hosting both app and scheduler on your existing VPS avoids needing Vercel Pro.

## Prepared deployment files

- `deploy/satmi-dashboard.service`: dedicated app service, localhost port 5001.
- `deploy/satmi-scheduler.service`: always-on Node scheduler, independently restarted by systemd.
- `deploy/nginx-dashboard.conf.example`: an additional virtual host, not a replacement configuration.
- `deploy/scheduler.env.example`: only the scheduler's target origin and cron secret.
- `scripts/scheduler.mjs`: orders every minute, support every five minutes, full reconciliation every twelve hours; per-job overlap prevention, authenticated requests, timeouts and failure logs. Does not require npm dependencies or Vercel scheduling.

The incompatible frequent Vercel cron declarations have been removed. **No background schedule will start merely by deploying: activate the prepared scheduler service.** Do not run multiple scheduler copies intentionally.

Before installing: inspect your VPS OS, free RAM/CPU/disk, existing deployment manager (Docker, PM2, systemd, panel), reverse proxy and ports. Adapt these templates to that setup. No VPS files or existing services have been changed.

Example Linux installation sequence after access/configuration are available:

1. Create a dedicated `satmi` service user and `/opt/satmi` checkout. Install Node 22.13+ and dependencies with `npm ci`.
2. Place the dashboard's existing settings in `/opt/satmi/.env.local`, readable only by its service user. Supabase public settings must exist **during** `npm run build` because Next embeds them into browser assets. Also retain server-only credentials for runtime.
3. Run `npm run build`. Copy/adapt the two `.service` files to `/etc/systemd/system/`. The examples expect Node at `/usr/bin/node`; verify the actual path.
4. Put DASHBOARD_URL and the same CRON_SECRET in `/etc/satmi/scheduler.env`, readable by `satmi` only. Use localhost:5001 when both run on the VPS.
5. Add the dashboard reverse-proxy host, validate Nginx config, provision a certificate using the server's current certificate tooling, then reload the proxy. Do not expose the example HTTP login publicly before HTTPS is ready.
6. Enable/start `satmi-dashboard` and `satmi-scheduler` using systemd. Verify their journal logs, sign-in, product import, a controlled order, and a controlled mailbox conversation. Ensure webhooks point at the new HTTPS domain.

Only the VPS access/target domain, existing Supabase configuration authorization, and Google account authorization remain owner-controlled inputs. Credentials are not included in these templates.

## Publication update — 11 September 2026

Production uses Supabase exclusively. All obsolete Neon environment entries were removed from this Vercel project and the local fallback was removed. Vercel marks all five Supabase/cron settings as sensitive and does not allow reading them back: they were **not copied locally**. The deployed environment can still use them.

Deployment initialization verified the real Supabase schema and RLS, imported 74 Shopify products / 116 variants, and installed three Supabase Cron jobs (`satmi-orders`, `satmi-support`, `satmi-verification`). This replaces the requirement to run an external VPS scheduler; do not enable both schedulers. Supabase Vault holds the existing cron authorization secret for the scheduled requests. Gmail still needs the Google service-account permissions, subscription, OAuth redirect and mailbox-owner consent described in `gmail-final-step.md`.
