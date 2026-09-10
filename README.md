# Satmi Orders

Private operations dashboard for the Satmi `Shopify_5` Shiprocket channel.

## Authentication

The dashboard uses Supabase Auth email/password accounts and secure HTTP-only cookie
sessions. Public registration and email-based password recovery are disabled in
both the UI and the server auth handler. Administrators create accounts and
assign passwords from **Manage users**. Admins can also replace passwords,
change roles, and disable or re-enable accounts.

Every dashboard API handler performs its own session check. The Shiprocket
webhook and scheduled reconciliation endpoints retain their independent shared
secret authentication and do not depend on a browser session.

## Supabase Auth setup

1. Enable Email provider in Supabase Authentication settings.
2. Disable public email/password sign-up in Supabase Authentication settings.
3. Add the deployed app origin as a trusted URL. SMTP is not required because
   this dashboard does not send authentication emails.
4. Set the variables listed in `.env.example` in the deployment environment.
5. Create the first account in Supabase Auth and assign it the `admin`
   role. Subsequent users are created from the dashboard with an assigned password.

Supabase’s publishable key may be public; keep `SUPABASE_SERVICE_ROLE_KEY` and
`SUPABASE_DB_URL` server-only.

## Development

```sh
npm install
npm run dev
```

Runtime secrets belong in `.env.local` or the hosting environment and must never
be committed.
