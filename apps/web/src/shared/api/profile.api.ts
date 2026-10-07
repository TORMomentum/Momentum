import "server-only";
import { cookies } from "next/headers";
import { apiRequest } from "./api-client";

/**
 * The signed-in vendor's profile, read on the server from the session cookie.
 *
 * The browser never holds the session id and never addresses the API directly,
 * so this is the only place the profile is fetched for a first render; the
 * screen receives it as a prop and saves changes back through the Next route
 * handler (rendering spec: pages are server components, views hold no fetching).
 */
export interface VendorProfile {
  categories: string[];
  areas: string[];
  /** Work the taxonomy has no node for. Stored, but not matched against. */
  otherCategories: string[];
  budget: { minThb: number; maxThb: number } | null;
  notify: { preset: "all" | "daily" | "high" | "off"; minMatch: number; leadDays: number; deadlineReminder: boolean; anomalyAlert: boolean };
  taxonomyVersion: string;
  updatedAt: string | null;
}

export async function fetchOwnProfile(): Promise<VendorProfile | null> {
  const sessionId = (await cookies()).get("tor-radar-session")?.value;
  if (!sessionId) return null;
  try {
    const response = await apiRequest("/api/v1/me/profile", {}, sessionId);
    if (!response.ok) return null;
    return (await response.json()) as VendorProfile;
  } catch {
    // The screen renders its own unavailable state rather than inventing one.
    return null;
  }
}

export interface OwnAccount {
  email: string;
  displayName?: string;
  role: string;
  emailVerifiedAt?: string;
  consent: { noticeVersion: string; agreedAt: string; withdrawnAt?: string };
}

/** The signed-in account itself, read on the server from the session cookie. */
export async function fetchOwnAccount(): Promise<OwnAccount | null> {
  const sessionId = (await cookies()).get("tor-radar-session")?.value;
  if (!sessionId) return null;
  try {
    const response = await apiRequest("/api/v1/me", {}, sessionId);
    if (!response.ok) return null;
    return (await response.json()) as OwnAccount;
  } catch {
    return null;
  }
}
