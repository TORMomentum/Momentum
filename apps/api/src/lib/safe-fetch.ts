import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { BadRequestError } from "../core/errors.js";

/**
 * The ranges this server must never be tricked into fetching (spec §5.6):
 * loopback, link-local — which is where the cloud metadata address
 * 169.254.169.254 lives — private, and unique-local. Matching is delegated to
 * `net.BlockList` rather than hand-written string prefixes, because it also
 * resolves IPv4-mapped IPv6 forms such as `::ffff:169.254.169.254` against the
 * IPv4 rules; a prefix comparison would wave those straight through.
 */
const BLOCKED_RANGES = new BlockList();
BLOCKED_RANGES.addSubnet("0.0.0.0", 8, "ipv4"); // "this network"
BLOCKED_RANGES.addSubnet("10.0.0.0", 8, "ipv4"); // private
BLOCKED_RANGES.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
BLOCKED_RANGES.addSubnet("169.254.0.0", 16, "ipv4"); // link-local, incl. cloud metadata
BLOCKED_RANGES.addSubnet("172.16.0.0", 12, "ipv4"); // private
BLOCKED_RANGES.addSubnet("192.168.0.0", 16, "ipv4"); // private
BLOCKED_RANGES.addAddress("::", "ipv6"); // unspecified
BLOCKED_RANGES.addAddress("::1", "ipv6"); // loopback
BLOCKED_RANGES.addSubnet("fc00::", 7, "ipv6"); // unique-local
BLOCKED_RANGES.addSubnet("fe80::", 10, "ipv6"); // link-local

/**
 * True when an address is one this server must never be tricked into fetching.
 * Anything that does not parse as an IP address is blocked too: a value this
 * function cannot classify is a value it cannot vouch for.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return BLOCKED_RANGES.check(address, family === 4 ? "ipv4" : "ipv6");
}

export function assertAllowedUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BadRequestError(`Unsupported URL scheme: ${url.protocol}`);
  }
}

/**
 * Resolves the hostname and rejects the request if it points anywhere internal.
 *
 * A hostname may answer with several A or AAAA records, so this checks *every*
 * record and rejects if any one of them is blocked (spec §5.6). Validating only
 * the first record would leave a rebinding bypass: the caller would clear a
 * public address and then connect to a private sibling.
 */
export async function assertResolvesPublicly(url: URL): Promise<void> {
  let addresses;
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new BadRequestError("URL hostname did not resolve");
  }
  if (addresses.length === 0) {
    throw new BadRequestError("URL hostname did not resolve");
  }
  if (addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new BadRequestError("URL resolves to a non-public address");
  }
}

export interface FetchedDocument {
  bytes: Buffer;
  declaredType: string;
  finalUrl: string;
}

export interface FetchLimits {
  timeoutMs: number;
  maxRedirects: number;
  maxBytes: number;
}

/**
 * Reads a response body while enforcing the size cap, rejecting a declared
 * `Content-Length` over the cap before any bytes are read and aborting mid-body
 * the moment the running total crosses it. Buffering the whole body first and
 * measuring afterwards would let an oversized source exhaust memory before the
 * cap ever had a say.
 */
async function readCappedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new BadRequestError("Document exceeds the maximum accepted size");
  }
  if (response.body === null) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let total = 0;
  // Throwing out of `for await` cancels the stream, so the connection is not left open.
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new BadRequestError("Document exceeds the maximum accepted size");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

/**
 * Fetches a user-supplied URL with every control from spec §5.6: scheme
 * allowlist, resolved-address check re-run after each redirect, redirect cap,
 * response size cap, and a hard timeout.
 */
export async function safeFetchDocument(
  rawUrl: string,
  limits: FetchLimits,
): Promise<FetchedDocument> {
  let current = new URL(rawUrl);
  for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
    assertAllowedUrl(current);
    await assertResolvesPublicly(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
    try {
      // Redirects are followed by hand so each hop is re-checked against the
      // rules above; letting fetch follow them would skip every check but the first.
      const response = await fetch(current, { redirect: "manual", signal: controller.signal });
      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new BadRequestError("Redirect without a location header");
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new BadRequestError(`Source responded with status ${response.status}`);
      }
      return {
        bytes: await readCappedBody(response, limits.maxBytes),
        declaredType: response.headers.get("content-type") ?? "application/octet-stream",
        finalUrl: current.toString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new BadRequestError("Too many redirects");
}
