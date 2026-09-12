export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function isTransientRequestError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "TimeoutError" ||
    /signal timed out|temporarily busy|did not return a usable response|failed to fetch|networkerror/i.test(
      error.message,
    )
  );
}
export function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof HttpError)
    return Response.json({ error: message }, { status: error.status });
  const code = (error as {code?:string})?.code;
  if(code === '23505') return Response.json({error:'This record already exists. Refresh to see the saved record.',code:'DUPLICATE_RECORD'},{status:409});
  if(code === '23503') return Response.json({error:'A linked record is missing or still in use. Refresh and check your selection.',code:'INVALID_REFERENCE'},{status:409});
  if(code === '57014' || /timeout|timed out/i.test(message)) return Response.json({error:'The data service took too long to respond. Your saved records are unchanged. Please retry.',code:'SERVICE_TIMEOUT'},{status:503});
  if (/quota|data transfer|compute.*limit/i.test(message))
    return Response.json(
      {
        error:
          "The database has reached its service quota. An account administrator must restore database capacity before live data can load.",
        code: "DATABASE_QUOTA",
      },
      { status: 503 },
    );
  if (/not configured|required to create a Supabase/i.test(message))
    return Response.json(
      {
        error:
          "Dashboard connection settings are incomplete. Configure the database and Supabase authentication settings.",
        code: "CONFIGURATION_REQUIRED",
      },
      { status: 503 },
    );
  console.error("Dashboard request failed", {
    name: error instanceof Error ? error.name : "Error",
    code: (error as { code?: string })?.code,
  });
  return Response.json(
    {
      error:
        "The server could not complete this request. Please retry. If it continues, check the server connection.",
      code: "SERVER_ERROR",
    },
    { status: 500 },
  );
}
export async function readJson<T = Record<string, unknown>>(
  response: Response,
): Promise<T> {
  const text = await response.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      response.status === 401
        ? "Your session expired. Please sign in again."
        : response.status === 504
          ? "The service is temporarily busy. Please retry in a moment."
          : "The server did not return a usable response. Please retry.",
    );
  }
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status})`,
    );
  return data as T;
}
export const required = (v: unknown, label: string) => {
  const s = String(v ?? "").trim();
  if (!s || s.length > 10000) throw new HttpError(400, `${label} is required`);
  return s;
};
export function quantity(v: unknown, label = "Quantity", zero = false) {
  const n = Number(v);
  if (
    v === "" ||
    v === null ||
    v === undefined ||
    !Number.isFinite(n) ||
    (zero ? n < 0 : n <= 0)
  )
    throw new HttpError(
      400,
      `${label} must be ${zero ? "non-negative" : "positive"}`,
    );
  return n;
}
