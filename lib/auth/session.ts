import { getRuntimeEnv, ensureSchema } from "../database";

export type DashboardUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

export const SESSION_COOKIE_NAME = "satmi_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

function getSecretKey(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "satmi-orders-hostinger-vps-secure-key-2026"
  );
}

async function getCryptoKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createSessionToken(user: DashboardUser): Promise<string> {
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const jsonStr = JSON.stringify(payload);
  const encodedPayload = Buffer.from(jsonStr).toString("base64url");
  const key = await getCryptoKey(getSecretKey());
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encodedPayload)
  );
  const signature = Buffer.from(sigBuffer).toString("base64url");
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(token: string): Promise<DashboardUser | null> {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;

  try {
    const key = await getCryptoKey(getSecretKey());
    const sigBytes = Buffer.from(signature, "base64url");
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(encodedPayload)
    );
    if (!valid) return null;

    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object") return null;

    if (typeof payload.exp === "number" && Math.floor(Date.now() / 1000) > payload.exp) {
      return null;
    }

    return {
      id: String(payload.sub || ""),
      email: String(payload.email || ""),
      name: String(payload.name || payload.email || ""),
      role: String(payload.role || "user"),
    };
  } catch {
    return null;
  }
}

export async function authenticateUser(
  email: string,
  password: string
): Promise<{ user: DashboardUser | null; error?: string }> {
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !password) {
    return { user: null, error: "Please enter both email and password." };
  }

  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);

  try {
    const row = await runtime.DB.prepare(`
      SELECT id, email, name, role, banned_until,
             (encrypted_password = crypt(?, encrypted_password)) AS password_matches
      FROM auth_users
      WHERE LOWER(email) = LOWER(?)
      LIMIT 1
    `)
      .bind(password, trimmedEmail)
      .first<{
        id: string;
        email: string;
        name: string;
        role: string;
        banned_until: string | null;
        password_matches: boolean;
      }>();

    if (!row) {
      return { user: null, error: "The email or password is incorrect." };
    }

    if (row.banned_until && new Date(row.banned_until).getTime() > Date.now()) {
      return { user: null, error: "This account has been disabled. Please contact your administrator." };
    }

    if (!row.password_matches) {
      return { user: null, error: "The email or password is incorrect." };
    }

    return {
      user: {
        id: row.id,
        email: row.email,
        name: row.name || row.email,
        role: row.role || "user",
      },
    };
  } catch (err) {
    console.error("Authentication error:", err);
    return { user: null, error: "Authentication failed. Please try again." };
  }
}
