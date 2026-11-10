import { NextRequest, NextResponse } from "next/server";
import { apiRequest } from "../../../src/shared/api/api-client";

/**
 * Uploading to the vendor's vault. The browser never holds the session id, so the upload goes through here,
 * and unlike the account handler it passes the BYTES through: reading a multipart body as text would damage
 * the file.
 */
const COOKIE = "tor-radar-session";

function sameOrigin(request: NextRequest): boolean {
  const expected = process.env.APP_ORIGIN;
  if (!expected) throw new Error("APP_ORIGIN is required to serve vault routes");
  const provenance = request.headers.get("Origin") ?? request.headers.get("Referer");
  try {
    return provenance !== null && new URL(provenance).origin === expected;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sessionId = request.cookies.get(COOKIE)?.value;
  const response = await apiRequest(
    "/api/v1/me/vault",
    {
      method: "POST",
      body: Buffer.from(await request.arrayBuffer()),
      headers: {
        "content-type": request.headers.get("content-type") ?? "multipart/form-data",
        // The API checks the origin it sees; the browser's was checked above.
        Origin: process.env.APP_ORIGIN!,
      },
    },
    sessionId,
  );
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}

export const dynamic = "force-dynamic";
