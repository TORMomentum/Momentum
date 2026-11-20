import "server-only";

import { isIP } from "node:net";
import { headers } from "next/headers";

/**
 * How many entries, counted from the right of the incoming X-Forwarded-For, were appended by
 * infrastructure we trust. Each trusted hop appends the address it received the request from,
 * so the entry just left of them is the real client; anything further left is client-supplied.
 * 1 suits Cloud Run behind Google's front end; 0 disables forwarding altogether.
 */
const DEFAULT_TRUSTED_PROXY_HOPS = 1;

function trustedHops(): number {
  const configured = process.env.TRUSTED_PROXY_HOPS;
  if (configured === undefined || configured.trim() === "") return DEFAULT_TRUSTED_PROXY_HOPS;
  const hops = Number(configured);
  return Number.isInteger(hops) && hops >= 0 ? hops : DEFAULT_TRUSTED_PROXY_HOPS;
}

/** The client address this server can vouch for, or null when the request names none it trusts. */
export function clientIpFrom(forwardedFor: string | null | undefined): string | null {
  const hops = trustedHops();
  if (!forwardedFor || hops === 0) return null;
  const chain = forwardedFor.split(",").map((part) => part.trim());
  const candidate = chain[chain.length - hops];
  return candidate && isIP(candidate) ? candidate : null;
}

/**
 * The one X-Forwarded-For the API gets from this server: exactly the client address derived
 * above, replacing (never appending to) whatever the caller sent. The API trusts that header
 * only from its own configured proxy hops (api `TRUST_PROXY`), so a caller cannot choose
 * its own rate-limit bucket by sending one.
 *
 * `incoming` is the request's headers where a handler has them; otherwise the ambient request
 * context is read, which does not exist outside a request (tests, build) - then nothing is sent.
 */
export async function forwardedClientHeaders(incoming?: Headers): Promise<Record<string, string>> {
  let source = incoming;
  if (!source) {
    try {
      source = await headers();
    } catch {
      return {};
    }
  }
  const ip = clientIpFrom(source.get("x-forwarded-for"));
  return ip ? { "x-forwarded-for": ip } : {};
}
