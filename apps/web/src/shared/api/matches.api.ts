import "server-only";

import { cookies } from "next/headers";
import { apiRequest } from "./api-client";

interface MatchField<T> {
  raw: string;
  value: T | null;
  verified: boolean;
}

/** One TOR that may be relevant to the signed-in vendor, as `/me/matches` scores it. */
export interface MatchRow {
  id: string;
  title: string;
  agency: string;
  budget: MatchField<number>;
  deadline: MatchField<string> & { fromDocument?: string };
  unverified: boolean;
  score: number;
  reasons: Array<{ code: string; th: string }>;
}

export interface OwnMatches {
  items: MatchRow[];
  /** Set when the profile cannot be matched yet — no work categories chosen. */
  reason: string | null;
}

/**
 * The signed-in vendor's best matches, read on the server from the session
 * cookie. `undefined` means nobody is signed in, so the dashboard stays the
 * public one; `null` means the matches could not be read, which the panel says
 * rather than showing an empty list that would read as "nothing fits you".
 */
export async function fetchOwnMatches(): Promise<OwnMatches | null | undefined> {
  const sessionId = (await cookies()).get("tor-radar-session")?.value;
  if (!sessionId) return undefined;
  try {
    const response = await apiRequest("/api/v1/me/matches", {}, sessionId);
    // An expired session is a signed-out visitor, not a failure.
    if (response.status === 401) return undefined;
    if (!response.ok) {
      // The panel only says "could not load"; the cause belongs in the log.
      console.error("own_matches_failed", { status: response.status, body: (await response.text()).slice(0, 300) });
      return null;
    }
    return (await response.json()) as OwnMatches;
  } catch (error) {
    console.error("own_matches_failed", { reason: String(error) });
    return null;
  }
}

/**
 * Score by TOR id, for marking a page of search results. Empty for a signed-out
 * visitor or on any failure: a missing badge is a smaller harm than a search
 * page that will not render.
 */
export async function fetchOwnMatchScores(): Promise<Map<string, number>> {
  const sessionId = (await cookies()).get("tor-radar-session")?.value;
  if (!sessionId) return new Map();
  try {
    const response = await apiRequest("/api/v1/me/matches/scores", {}, sessionId);
    if (!response.ok) return new Map();
    const { scores } = (await response.json()) as { scores: Record<string, number> };
    return new Map(Object.entries(scores));
  } catch {
    return new Map();
  }
}
