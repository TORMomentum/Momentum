import { NextRequest, NextResponse } from "next/server";
import { apiRequest } from "../../../../src/shared/api/api-client";
import { STAFF_COOKIE_NAME } from "../../../../src/shared/lib/staff-session";

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

/** The browser's half of a Google sign-in attempt, held only for as long as the attempt can last. */
const GOOGLE_BINDING_COOKIE = "tor-radar-google-binding";
const GOOGLE_TICKET_COOKIE = "tor-radar-google-ticket";
const GOOGLE_COOKIE_PATH = "/api/auth/google";
const GOOGLE_COOKIE_MAX_AGE_S = 600;

function sessionCookie(output: NextResponse, value: { sessionId: string; expiresAt: string }): void {
  output.cookies.set(COOKIE, value.sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV !== "development",
    path: "/",
    expires: new Date(value.expiresAt),
  });
  // Signing in as an account is a new identity, and it must not inherit the
  // staff pass a previous visit left in this browser — otherwise a vendor
  // signing in on a reviewer's machine walks straight into the staff area.
  // Staff mode is entered again, deliberately, at /admin/login.
  output.cookies.set(STAFF_COOKIE_NAME, "", { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", expires: new Date(0) });
}

function googleCookie(output: NextResponse, name: string, value: string): void {
  output.cookies.set(name, value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV !== "development", path: GOOGLE_COOKIE_PATH, maxAge: GOOGLE_COOKIE_MAX_AGE_S });
}

function clearGoogleCookies(output: NextResponse): NextResponse {
  for (const name of [GOOGLE_BINDING_COOKIE, GOOGLE_TICKET_COOKIE]) output.cookies.set(name, "", { httpOnly: true, sameSite: "lax", path: GOOGLE_COOKIE_PATH, maxAge: 0 });
  return output;
}

/** Every failure lands on the login page; the reason stays in the API's reply and is never put in the URL. */
function googleFailure(): NextResponse {
  return clearGoogleCookies(NextResponse.redirect(new URL("/login?error=google", appOrigin())));
}

/**
 * Sign in with Google (TOR-315). The API owns the protocol (PKCE, state, nonce, ID-token validation); this
 * handler owns the browser: the cookie that binds a callback to the browser that started it, the redirects, and the
 * session cookie. Neither the code nor any token is logged, and the session id never reaches client JavaScript.
 */
async function googleFlow(request: NextRequest, route: string): Promise<NextResponse> {
  if (route === "google/start" && request.method === "GET") {
    const link = request.nextUrl.searchParams.get("link") === "1";
    const currentSession = link ? request.cookies.get(COOKIE)?.value : undefined;
    if (link && !currentSession) return googleFailure();
    const reply = await apiRequest("/auth/google/start", { method: "GET" }, currentSession).catch(() => null);
    if (!reply?.ok) return googleFailure();
    const { url, binding } = (await reply.json()) as { url: string; binding: string };
    const output = NextResponse.redirect(url);
    googleCookie(output, GOOGLE_BINDING_COOKIE, binding);
    output.headers.set("cache-control", "no-store");
    return output;
  }

  if (route === "google/callback" && request.method === "GET") {
    const query = request.nextUrl.searchParams;
    const code = query.get("code");
    const state = query.get("state");
    const binding = request.cookies.get(GOOGLE_BINDING_COOKIE)?.value;
    // `error` is what Google sends when the person declines; nothing to exchange.
    if (query.get("error") || !code || !state || !binding) return googleFailure();
    const reply = await apiRequest("/auth/google/callback", {
      method: "POST",
      body: JSON.stringify({ code, state, binding }),
      headers: { "content-type": "application/json", Origin: appOrigin() },
    }, request.cookies.get(COOKIE)?.value).catch(() => null);
    if (!reply?.ok) return googleFailure();
    const result = (await reply.json()) as { status: "signed_in"; sessionId: string; expiresAt: string } | { status: "consent_required"; ticket: string; checkMailbox?: boolean };
    if (result.status === "consent_required") {
      const output = clearGoogleCookies(NextResponse.redirect(new URL(result.checkMailbox ? "/google-consent?check=mail" : "/google-consent", appOrigin())));
      googleCookie(output, GOOGLE_TICKET_COOKIE, result.ticket);
      return output;
    }
    const output = clearGoogleCookies(NextResponse.redirect(new URL("/dashboard", appOrigin())));
    sessionCookie(output, result);
    return output;
  }

  if (route === "google/complete" && request.method === "POST") {
    const ticket = request.cookies.get(GOOGLE_TICKET_COOKIE)?.value;
    if (!ticket) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { consent?: unknown; behaviourConsent?: unknown; proof?: unknown };
    const reply = await apiRequest("/auth/google/complete", {
      method: "POST",
      body: JSON.stringify({ ticket, consent: body.consent, proof: body.proof, ...(body.behaviourConsent === true ? { behaviourConsent: true } : {}) }),
      headers: { "content-type": "application/json", Origin: appOrigin() },
    }).catch(() => null);
    if (!reply?.ok) return clearGoogleCookies(NextResponse.json({ error: "failed" }, { status: reply?.status === 400 ? 400 : 401 }));
    const value = (await reply.json()) as { sessionId: string; expiresAt: string };
    const output = clearGoogleCookies(NextResponse.json({ ok: true }));
    sessionCookie(output, value);
    return output;
  }

  return NextResponse.json({ error: "not_found" }, { status: 404 });
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

  if (route.startsWith("google/")) return googleFlow(request, route);

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
    sessionCookie(output, value);
    return output;
  }

  const output = new NextResponse(responseText, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      ...(response.headers.get("content-disposition") ? { "content-disposition": response.headers.get("content-disposition")! } : {}),
      ...(response.headers.get("cache-control") ? { "cache-control": response.headers.get("cache-control")! } : {}),
    },
  });
  if (route === "logout" || (route === "me" && request.method === "DELETE" && response.ok)) output.cookies.delete(COOKIE);
  // Sign-out also empties what the browser kept for this origin (ASVS V14.3.1). It has to be on the reply the
  // browser receives, which is this one, not the API's.
  if (route === "logout") output.headers.set("clear-site-data", '"cache", "cookies", "storage"');
  return output;
}

export const POST = forward;
export const GET = forward;
export const PUT = forward;
export const DELETE = forward;

/**
 * Every reply here depends on the request's own cookie and Origin, so there is
 * nothing to prerender. Saying so also keeps the handler out of the build-time
 * worker, which does not run next.config.ts and so cannot see APP_ORIGIN.
 */
export const dynamic = "force-dynamic";
