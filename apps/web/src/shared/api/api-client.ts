import "server-only";

/**
 * The one way the Next server calls the API's public routes (rendering spec §4).
 * Every call has a deadline and is never cached here; each data module decides
 * what its screen needs from the response.
 */

/** The API answered, but not with the data: an outage, not an empty result. */
export class ApiUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiUnavailable";
  }
}

const API_PREFIX = "/api/v1";
/** A slow API must not hold a render open indefinitely (rendering spec §4.1). */
const DEFAULT_TIMEOUT_MS = 5_000;

function apiBaseUrl(): string {
  const value = process.env.API_BASE_URL;
  if (!value) throw new ApiUnavailable("API_BASE_URL is not configured");
  return value;
}

/**
 * api stays IAM-restricted even once web sits behind IAP for end users — a
 * plain fetch() carries no proof of identity, so Cloud Run's own ingress
 * check would 403 it regardless of IAM bindings. K_SERVICE is a Cloud Run
 * signal, never set locally, so Compose keeps calling api with no header at
 * all, exactly as before.
 *
 * ponytail: refetched per request rather than cached against its ~1h expiry
 * — the metadata server call is local to the instance, and traffic here is
 * tens of concurrent users (NFR-S4), not enough to make that cost real.
 */
export async function identityToken(audience: string): Promise<string | null> {
  if (!process.env.K_SERVICE) return null;
  const url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;
  const response = await fetch(url, { headers: { "Metadata-Flavor": "Google" } });
  if (!response.ok) throw new ApiUnavailable(`identity token request returned ${response.status}`);
  return response.text();
}

export async function apiRequest(path: string, init: RequestInit = {}, sessionId?: string): Promise<Response> {
  try {
    const base = apiBaseUrl();
    const token = await identityToken(base);
    return await fetch(`${base}${path}`, {
      ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs()),
      headers: {
        ...(init.headers ?? {}),
        ...(sessionId ? { "x-session-id": sessionId } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (error) {
    throw new ApiUnavailable(`${init.method ?? "GET"} ${path} failed: ${(error as Error).message}`);
  }
}

function timeoutMs(): number {
  const configured = Number(process.env.API_TIMEOUT_MS);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

export async function getJson<T>(path: string, notFound?: () => T): Promise<T> {
  let response: Response;
  try {
    response = await apiRequest(`${API_PREFIX}${path}`);
  } catch (error) {
    // A timeout is treated as unreachable, with the same copy (rendering spec §8).
    throw new ApiUnavailable(`GET ${path} failed: ${(error as Error).message}`);
  }

  if (response.status === 404 && notFound) return notFound();
  if (!response.ok) {
    const body = await response.text();
    throw new ApiUnavailable(`GET ${path} returned ${response.status}: ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

