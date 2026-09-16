import "server-only";

/** Headers the browser may see from the API's document response (spec §5.3). */
const FORWARDED = [
  "content-type",
  "content-length",
  "content-range",
  "content-disposition",
  "accept-ranges",
  "cache-control",
  "x-content-type-options",
] as const;

function apiBaseUrl(): string {
  const value = process.env.API_BASE_URL;
  if (!value) throw new Error("API_BASE_URL is not configured");
  return value;
}

/**
 * Relays one document response without buffering it.
 *
 * The request's abort signal is passed upstream, so closing the tab cancels the
 * API's read of storage. Only the allowlisted headers cross — anything else the
 * API might add stays server-side.
 */
export async function proxyDocument(
  request: Request,
  apiPath: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const incoming = new URL(request.url);
  const target = `${apiBaseUrl()}/api/v1${apiPath}${incoming.search}`;

  const upstream = await fetch(target, {
    method: request.method,
    headers: {
      ...extraHeaders,
      ...(request.headers.get("range") ? { range: request.headers.get("range") as string } : {}),
    },
    signal: request.signal,
    cache: "no-store",
  });

  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Belt and braces: the proxy must never make a taken-down document cacheable.
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}
