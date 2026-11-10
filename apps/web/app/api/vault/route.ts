import { NextRequest, NextResponse } from "next/server";
import { apiRequest } from "../../../src/shared/api/api-client";

/**
 * Uploading to the vendor's vault. The browser never holds the session id, so the upload goes through here,
 * and unlike the account handler it passes the BYTES through: reading a multipart body as text would damage
 * the file.
 *
 * Nothing is read until the request has earned it: no session cookie, a foreign origin, or a body that says
 * it is too big is refused first, and what is read is counted and stopped at the limit. The API enforces the
 * same size on the file itself; this is so the web process never holds more than a file's worth of an upload
 * it was going to refuse.
 */
const COOKIE = "tor-radar-session";
const DEFAULT_MAX_FILE_BYTES = 10_485_760;
/** The multipart framing and the few text fields around the file. */
const MULTIPART_OVERHEAD_BYTES = 1_048_576;

function maxBodyBytes(): number {
  const configured = Number(process.env.VAULT_MAX_FILE_BYTES);
  return (Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_FILE_BYTES) + MULTIPART_OVERHEAD_BYTES;
}

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

/** The body, or null once it passes `limit` (the rest is not read). */
async function readLimited(request: NextRequest, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sessionId = request.cookies.get(COOKIE)?.value;
  if (!sessionId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = maxBodyBytes();
  const tooLarge = () => NextResponse.json({ error: { code: "payload_too_large", message: "ไฟล์ใหญ่เกินที่รับได้" } }, { status: 413 });
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return tooLarge();
  const body = await readLimited(request, limit);
  if (body === null) return tooLarge();

  const response = await apiRequest(
    "/api/v1/me/vault",
    {
      method: "POST",
      body,
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
