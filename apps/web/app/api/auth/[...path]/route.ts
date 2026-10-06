import { NextRequest, NextResponse } from "next/server";
import { apiRequest } from "../../../../src/shared/api/api-client";

/**
 * The browser's half of a session. The cookie is set and read only here: the
 * session id is forwarded to the API in a header, and never reaches client
 * JavaScript, which is the whole point of marking the cookie httpOnly.
 */
const COOKIE = "tor-radar-session";

/** The routes whose replies are passed through. Everything else is summarised. */
const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function appOrigin(): string {
  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new Error("APP_ORIGIN is required to serve account routes");
  return origin;
}

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = path.join("/");

  // The API sees this handler's own Origin, not the browser's, so its
  // same-origin check cannot defend a request that arrives here. The check has
  // to happen at the edge the browser actually talks to.
  if (METHODS_WITH_BODY.has(request.method)) {
    // Read before the try: a missing APP_ORIGIN is a misconfiguration and must
    // fail loudly, not arrive as "your request was forbidden" on every sign-in.
    const expected = appOrigin();
    const provenance = request.headers.get("Origin") ?? request.headers.get("Referer");
    let allowed = false;
    try {
      allowed = provenance !== null && new URL(provenance).origin === expected;
    } catch {
      // An unparseable Origin is not a same-origin request.
      allowed = false;
    }
    if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sessionId = request.cookies.get(COOKIE)?.value;
  const body = request.method === "GET" ? undefined : await request.text();
  const response = await apiRequest(
    `/auth/${route}`,
    {
      method: request.method,
      body: body || undefined,
      headers: {
        "content-type": request.headers.get("content-type") ?? "application/json",
        Origin: appOrigin(),
      },
    },
    sessionId,
  );

  const responseText = await response.text();

  if (route === "login" && response.ok) {
    // The session id goes into the cookie and NOWHERE else. Passing the API's
    // reply through verbatim would hand the id straight back to the page's
    // JavaScript and undo the httpOnly cookie it was just put in.
    const value = JSON.parse(responseText) as { sessionId: string; expiresAt: string };
    const output = NextResponse.json({ ok: true });
    output.cookies.set(COOKIE, value.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV !== "development",
      path: "/",
      expires: new Date(value.expiresAt),
    });
    return output;
  }

  const output = new NextResponse(responseText, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
  if (route === "logout") output.cookies.delete(COOKIE);
  return output;
}

export const POST = forward;
export const GET = forward;

/**
 * Every reply here depends on the request's own cookie and Origin, so there is
 * nothing to prerender. Saying so also keeps the handler out of the build-time
 * worker, which does not run next.config.ts and so cannot see APP_ORIGIN.
 */
export const dynamic = "force-dynamic";
