# Inventory and Gmail support: deployment handoff

## Current status

The dashboard now contains Inventory and Customer support. Recipes may remain empty; sales and reservations require a recipe and never guess components. The existing database is retained. Schema changes are additive PostgreSQL changes, not a database replacement.

The local checkout has Neon database credentials but uses Supabase Auth. Its database connection returned SQLSTATE 53000: data-transfer quota exceeded. Supabase public URL, publishable key, and service-role key are missing locally, but these settings and SUPABASE_DB_URL are present in Vercel production. No live schema changes could be verified or applied during this build. The screenshot’s JSON parsing error is consistent with unhandled server failures; the exact deployed response from the screenshot is unavailable. API boundaries now return meaningful JSON errors, and Orders stops its loading spinner after failure.

Local preview: http://127.0.0.1:5000/preview (development only; does not bypass API authentication or write production data). Live application: http://127.0.0.1:5000, after authentication is configured.

## Minimum account-owner steps

1. Restore the local connection to the existing production Supabase database; production already has SUPABASE_DB_URL. The quota error observed locally belongs to the older Neon fallback, and does not establish a production Supabase quota problem. Do not replace either database.
2. Supply the existing Supabase Auth project URL, publishable key and service-role key through the local/deployment secret editor. If the production app uses a different database URL, supply that exact existing URL as SUPABASE_DB_URL. Do not paste secret values in chat.
3. In the Google Cloud project owned by your Workspace organization, authorize creation/use of a Gmail integration. Configure an Internal OAuth application if your account qualifies; otherwise follow Google verification requirements. Enable Gmail API and Pub/Sub API. Create a Web OAuth client and provide GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET through the secret editor.
4. Add exact redirect URIs: `http://127.0.0.1:5000/api/support/gmail/callback` for local connection and `https://YOUR-DASHBOARD-DOMAIN/api/support/gmail/callback` for deployment. GOOGLE_REDIRECT_URI must match the current environment. The OAuth scopes are Gmail readonly and send. The authorized Google account must be kritika@satmi.in.
5. Once Google Cloud access and the intended project are available, `bash scripts/setup-gmail-push.sh PROJECT_ID https://YOUR-DASHBOARD-DOMAIN` automates API enablement, topic creation, publisher permissions, push identity and authenticated subscription. The following two steps describe its equivalent configuration. Create a Pub/Sub topic in the same Google Cloud project as the OAuth client. Grant `roles/pubsub.publisher` to `gmail-api-push@system.gserviceaccount.com` on this topic. Set GMAIL_PUBSUB_TOPIC to the full `projects/PROJECT/topics/TOPIC` resource name.
6. Create an authenticated push subscription to `https://YOUR-DASHBOARD-DOMAIN/api/support/gmail/push`. Select a dedicated service account for push authentication, grant the required Pub/Sub token-creation permissions, and set the OIDC audience to that exact endpoint URL. Store that email in GMAIL_PUSH_SERVICE_ACCOUNT and the audience in GMAIL_PUSH_AUDIENCE. Public HTTPS is required for push; localhost cannot receive Google push deliveries.
7. Sign in to the dashboard as an administrator, open Customer support → Mailbox & team → Connect Gmail, and approve Gmail access. No email is sent merely by connecting. Click Sync now to begin import.

An app-specific SUPPORT_TOKEN_KEY has been generated locally. Generate/store a stable separate deployment key (32 random bytes, base64) before connecting production Gmail. Never rotate it without reauthorizing mailboxes; it encrypts stored refresh tokens. Do not share keys in source control. CRON_SECRET protects scheduled endpoints.

A full production environment export was rejected by automatic approval review; no exported production secrets were obtained. Only the specific missing settings above are required.

## Application setup handled by the implementation

- `node --env-file=.env.local --import tsx scripts/check-operations-config.ts` reports missing setting names without exposing values.
- `node --env-file=.env.local --import tsx scripts/apply-operations.ts` creates additive tables/fields and applies RLS once database access is restored. Runtime Inventory/Support initialization also applies the versioned additions.
- Invoices use the private `operations-private` bucket in the existing Supabase project. The app creates it when first needed using the server-only service-role key. Keep it private. PDF/JPEG/PNG uploads are limited to 10 MB. Downloads use authorized, short-lived links.
- Manage users supports Operations, Warehouse, Support agent, Support manager, User and Administrator. Refresh the support team after changing roles. Managers can set agents away/available; new tickets are assigned by active workload. Unassigned tickets remain visible to managers.
- Every 5 minutes, `/api/cron/support` refreshes agent membership, imports/catches up mail, renews Gmail watches when needed, and processes the reply outbox. The schedule is now handled by `scripts/scheduler.mjs` on an always-on VPS; frequent Vercel cron declarations were removed. See `dashboard-setup-and-vps.md` for the prepared service files. Never leave periodic renewal disabled. A missed/expired Gmail history cursor triggers a bounded full reimport with deduplication.
- Initial import is the last 30 days, 30 threads per run. Repeated runs continue the stored cursor. Spam, trash and drafts are excluded. Incoming conversations create tickets; sent-only threads do not create customer queries. Imported sender/subject/text/attachments are shown inside the ticket. Attachments are fetched from Gmail on demand after ticket authorization.
- Replies send from the connected mailbox to the original customer; internal notes never send. Successful sends mean accepted by Gmail, not independently confirmed delivered. Uncertain sends are checked against Gmail Sent mail and never blindly retried. Confirmed rejected sends have an explicit Retry button.
- Shipment updates attempt recipe-based reservation and consumption, cancellation releases reservations, and RTO recovery requires a warehouse QC decision. Missing SKU mappings, recipes or available stock prevent reservation. Existing order snapshots remain immutable. Receipt retries, sales retries and fulfilment retries are idempotent.

## Release checks

Run lint, TypeScript, `npm run build`, `npm run test:regression`, and `npm run test:operations`. The build uses webpack because Turbopack hit a local worker-permission error. Integration tests require the isolated PostgreSQL test instance at 127.0.0.1:55439 with database postgres and user satmi_test; they never use a production connection. With restored real connections, verify sign-in, role restrictions, real PO receipt/upload/download, import pagination, Google webhook authentication, watch renewal, and an authorized test reply to a controlled email address. Then check the existing Orders/Analytics/OFD/Confirmation pages and schedule health.

No real customer email was sent during implementation. Google OAuth, Pub/Sub delivery, live RLS and production storage still need an account-connected acceptance check. The local preview is not a production deployment.

## Provider references

- Gmail push and renewal: https://developers.google.com/workspace/gmail/api/guides/push
- Gmail synchronization: https://developers.google.com/workspace/gmail/api/guides/sync
- OAuth server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
