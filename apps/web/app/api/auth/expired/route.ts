import { NextResponse } from "next/server";

/**
 * Where the layout sends a reader whose session cookie the API rejected. The
 * cookie is dropped here (a layout cannot set one) and the reader lands on the
 * sign-in page with the reason, instead of being sent round again by a dead cookie.
 */
export function GET() {
  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new Error("APP_ORIGIN is required to serve account routes");
  const output = NextResponse.redirect(new URL("/login?reason=expired", origin));
  output.cookies.delete("tor-radar-session");
  return output;
}

export const dynamic = "force-dynamic";
