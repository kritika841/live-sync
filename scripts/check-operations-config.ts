// Reports names only; never prints credentials.
const groups = {
  Database: ["SUPABASE_DB_URL"],
  Authentication: [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ],
  Gmail: [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "SUPPORT_TOKEN_KEY",
  ],
  Notifications: [
    "GMAIL_PUBSUB_TOPIC",
    "GMAIL_PUSH_SERVICE_ACCOUNT",
    "GMAIL_PUSH_AUDIENCE",
    "CRON_SECRET",
  ],
};
for (const [group, names] of Object.entries(groups)) {
  console.log(group);
  for (const name of names) {
    const present =
      name === "SUPABASE_DB_URL"
        ? Boolean(
            process.env.SUPABASE_DB_URL ||
              process.env.DATABASE_URL ||
              process.env.POSTGRES_URL,
          )
        : Boolean(process.env[name]);
    console.log(`  ${present ? "READY" : "MISSING"} ${name}`);
  }
}
