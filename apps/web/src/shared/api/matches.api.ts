import "server-only";

import { cookies } from "next/headers";
import { apiRequest } from "./api-client";

/**
 * The signed-in vendor's matches, read on the server from the session cookie,
 * like the profile and bookmarks. A signed-out visitor has no matches, which is
 * a different answer from "the service is unavailable" — so the list returns
 * null only when it could not be fetched.
 */

export interface MatchReason {
  code: string;
  th: string;
}

export interface MatchRow {
  id: string;
  title: string;
  score: number;
  reasons: MatchReason[];
}

export interface OwnMatches {
  items: MatchRow[];
  /** Why the list is empty when the vendor has not chosen any work yet. */
  reason: string | null;
}

async function ownRequest(path: string): Promise<Response | null> {
  const sessionId = (await cookies()).get("tor-radar-session")?.value;
  if (!sessionId) return null;
  try {
    return await apiRequest(`/api/v1${path}`, {}, sessionId);
  } catch {
    return null;
  }
}

/** Best first, with the Thai reasons each match carries. */
export async function fetchOwnMatches(): Promise<OwnMatches | null> {
  const response = await ownRequest("/me/matches");
  if (!response?.ok) return null;
  return (await response.json()) as OwnMatches;
}

/**
 * Score by TOR id, for marking a page of search results. Empty for a signed-out
 * visitor or on any failure: a missing badge is a smaller harm than a search
 * page that will not render.
 */
export async function fetchOwnMatchScores(): Promise<Map<string, number>> {
  const response = await ownRequest("/me/matches/scores");
  if (!response?.ok) return new Map();
  const { scores } = (await response.json()) as { scores: Record<string, number> };
  return new Map(Object.entries(scores));
}
