import { NextRequest, NextResponse } from "next/server";
import { apiRequest } from "../../../../src/shared/api/api-client";

/** Download and delete one of the vendor's own files, through the server that owns the session cookie. */
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

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const response = await apiRequest(`/api/v1/me/vault/${encodeURIComponent(id)}/file`, {}, request.cookies.get(COOKIE)?.value);
  if (!response.ok) return NextResponse.json({ error: "not found" }, { status: response.status === 404 ? 404 : 502 });
  const headers = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
  for (const name of ["content-type", "content-disposition", "content-length"]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(response.body, { status: 200, headers });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await context.params;
  const response = await apiRequest(
    `/api/v1/me/vault/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: { Origin: process.env.APP_ORIGIN! } },
    request.cookies.get(COOKIE)?.value,
  );
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}

export const dynamic = "force-dynamic";
