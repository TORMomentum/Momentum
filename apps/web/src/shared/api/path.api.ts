import "server-only";
import { cookies } from "next/headers";
import { apiRequest } from "./api-client";

export interface PathRequirement {
  kind: "certification" | "registration";
  id: string;
  th: string;
  asked: number;
  /** Null while the vendor has not stated what they hold. */
  holds: boolean | null;
}

/** TOR-284: one category of the field and how the announced wins in it are spread. Counts and a share only. */
export interface PathCategorySpread {
  category: string;
  awarded: number;
  winners: number;
  topShare: number;
}

export interface FieldPath {
  target: { id: string; th: string };
  sample: number;
  requirements: PathRequirement[];
  budget: { n: number; medianThb: number } | null;
  yourLargestProjectThb: number | null;
  /** Absent from an API that predates TOR-284. */
  winnerSpread?: { topWinners: number; minAwarded: number; comparable: PathCategorySpread[]; notComparable: number; lastAwardAt: string | null };
}

/** What the TORs in one field ask for, against the signed-in vendor's profile. Null when it cannot be read. */
export async function fetchFieldPath(target: string): Promise<FieldPath | null> {
  const sessionId = (await cookies()).get("tor-radar-session")?.value;
  if (!sessionId) return null;
  try {
    const response = await apiRequest(`/api/v1/me/path?target=${encodeURIComponent(target)}`, {}, sessionId);
    return response.ok ? ((await response.json()) as FieldPath) : null;
  } catch {
    return null;
  }
}
