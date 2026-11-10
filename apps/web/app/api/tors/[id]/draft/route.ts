import { NextRequest, NextResponse } from "next/server";
import { apiRequest } from "../../../../../src/shared/api/api-client";

/**
 * Asking the API for an AI draft of a cover letter (TOR-220), through the server that owns the session cookie.
 * Nothing is read from the browser's request: the TOR is the id in the path and everything the draft is made from
 * is the signed-in vendor's own data, which the API reads itself.
 *
 * A model call takes far longer than the 5 s every other call is given, so this one has its own deadline: the
 * API's own limit plus a few seconds, so the API's answer (or its failure) is what the vendor sees.
 */
const COOKIE = "tor-radar-session";
const DEFAULT_DRAFT_TIMEOUT_MS = 45_000;
const SLACK_MS = 5_000;

function sameOrigin(request: NextRequest): boolean {
  const expected = process.env.APP_ORIGIN;
  if (!expected) throw new Error("APP_ORIGIN is required to serve draft routes");
  const provenance = request.headers.get("Origin") ?? request.headers.get("Referer");
  try {
    return provenance !== null && new URL(provenance).origin === expected;
  } catch {
    return false;
  }
}

function timeoutMs(): number {
  const configured = Number(process.env.DRAFT_TIMEOUT_MS);
  return (Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_DRAFT_TIMEOUT_MS) + SLACK_MS;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sessionId = request.cookies.get(COOKIE)?.value;
  if (!sessionId) return NextResponse.json({ error: { code: "unauthorized", message: "กรุณาเข้าสู่ระบบ" } }, { status: 401 });
  const { id } = await context.params;
  try {
    const response = await apiRequest(
      `/api/v1/me/tors/${encodeURIComponent(id)}/draft`,
      { method: "POST", headers: { Origin: process.env.APP_ORIGIN! } },
      sessionId,
      timeoutMs(),
    );
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: { code: "unavailable", message: "AI ร่างจดหมายไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" } }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";
