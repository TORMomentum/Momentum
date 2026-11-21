import { NextResponse, type NextRequest } from "next/server";
import { generateNonce, securityHeaders } from "./src/shared/lib/security-headers";

/**
 * Next 16's `proxy` (the former `middleware`). Sets the security headers on every page and route
 * response, and hands the per-request nonce to the render as the `x-nonce` request header
 * (https://nextjs.org/docs/app/guides/content-security-policy).
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const headers = securityHeaders(nonce, request.nextUrl.pathname);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next reads the CSP from the REQUEST to find the nonce it must stamp on its own scripts.
  requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: [
    {
      // Not static assets; not prefetches (they are not rendered, so need no nonce).
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
