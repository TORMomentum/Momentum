import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const STAFF_COOKIE_NAME = "tor_staff";
const TOKEN_VERSION = 1;
// One working day limits exposure if a staff browser is left signed in while
// avoiding repeated prompts during a normal review shift.
const STAFF_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1_000;

export class StaffAuthRequired extends Error {
  constructor() {
    super("Staff authentication is required");
    this.name = "StaffAuthRequired";
  }
}

function configuredSecret(): string {
  return process.env.STAFF_ACCESS_SECRET ?? "";
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload, "utf8").digest();
}

function signedToken(expiresAt: number, secret: string): string {
  const payload = `${TOKEN_VERSION}.${expiresAt}`;
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export async function signIn(secret: string): Promise<boolean> {
  const expectedSecret = configuredSecret();
  // Hashing first gives timingSafeEqual fixed-size inputs even when the
  // submitted and configured secrets have different lengths.
  const secretMatches = timingSafeEqual(digest(secret), digest(expectedSecret));

  if (!expectedSecret || !secretMatches) return false;

  const expiresAt = Date.now() + STAFF_SESSION_LIFETIME_MS;
  const cookieStore = await cookies();
  cookieStore.set(STAFF_COOKIE_NAME, signedToken(expiresAt, expectedSecret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(expiresAt),
  });
  return true;
}

export async function requireStaff(): Promise<void> {
  try {
    const secret = configuredSecret();
    if (!secret) throw new StaffAuthRequired();

    const token = (await cookies()).get(STAFF_COOKIE_NAME)?.value;
    if (!token) throw new StaffAuthRequired();

    const parts = token.split(".");
    if (parts.length !== 3) throw new StaffAuthRequired();

    const [versionText, expiresText, encodedSignature] = parts;
    if (versionText !== String(TOKEN_VERSION) || !/^\d+$/.test(expiresText)) {
      throw new StaffAuthRequired();
    }

    const expiresAt = Number(expiresText);
    if (!Number.isSafeInteger(expiresAt)) throw new StaffAuthRequired();

    const presentedSignature = Buffer.from(encodedSignature, "base64url");
    if (presentedSignature.toString("base64url") !== encodedSignature) {
      throw new StaffAuthRequired();
    }
    const expectedSignature = signature(`${versionText}.${expiresText}`, secret);
    if (
      presentedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(presentedSignature, expectedSignature)
    ) {
      throw new StaffAuthRequired();
    }

    if (expiresAt <= Date.now()) throw new StaffAuthRequired();
  } catch {
    // Authentication failures have one stable shape and never expose parsing,
    // cookie-store, or signature details to the caller.
    throw new StaffAuthRequired();
  }
}

/**
 * The same check, as a question rather than an exception.
 *
 * A page wants to redirect, and `redirect()` works by throwing. Asking first
 * keeps that throw on the straight path instead of inside a `catch` handling a
 * different exception — two control-flow exceptions in one place is a shape
 * worth avoiding even where it happens to work. Server Actions keep using
 * `requireStaff`, where throwing is the correct behaviour and nothing catches
 * it.
 */
export async function isStaff(): Promise<boolean> {
  try {
    await requireStaff();
    return true;
  } catch {
    return false;
  }
}

export async function signOut(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(STAFF_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(0),
  });
}
