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

export interface FieldPath {
  target: { id: string; th: string };
  sample: number;
  requirements: PathRequirement[];
  budget: { n: number; medianThb: number } | null;
  yourLargestProjectThb: number | null;
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
