import { cookies } from "next/headers";
import { proxyDocument } from "../../../../src/shared/api/document-proxy";

/**
 * The filtered TOR list as CSV (TOR-69). Relayed from the API without buffering; the session goes
 * along only so a signed-in vendor's "match %" filter applies, exactly as on /search.
 */
async function handle(request: Request): Promise<Response> {
  const sessionId = (await cookies()).get("tor-radar-session")?.value;
  return proxyDocument(request, "/export/tors.csv", sessionId ? { "x-session-id": sessionId } : {});
}

export { handle as GET };
