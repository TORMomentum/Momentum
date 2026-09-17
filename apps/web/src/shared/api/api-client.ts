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

function timeoutMs(): number {
  const configured = Number(process.env.API_TIMEOUT_MS);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

export async function getJson<T>(path: string, notFound?: () => T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${API_PREFIX}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs()),
    });
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

