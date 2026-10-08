import "server-only";

import { cookies } from "next/headers";
import { apiRequest } from "./api-client";

export interface BookmarkRow {
  id: string;
  title: string;
  agency: string;
  deadline: string | null;
  budget: number | null;
  open: boolean;
  savedAt: string;
}

async function ownRequest(path: string): Promise<Response | null> {
  const sessionId = (await cookies()).get("tor-radar-session")?.value;
  if (!sessionId) return null;
  try { return await apiRequest(`/api/v1${path}`, {}, sessionId); } catch { return null; }
}

/** Saved rows for the profile; unavailable data is distinct from an empty list. */
export async function fetchOwnBookmarks(): Promise<BookmarkRow[] | null> {
  const response = await ownRequest("/me/bookmarks");
  if (!response?.ok) return null;
  return (await response.json()) as BookmarkRow[];
}

/** One server request marks every saved result in the rendered search page. */
export async function fetchOwnBookmarkIds(torIds: string[]): Promise<Set<string>> {
  if (torIds.length === 0) return new Set();
  const query = new URLSearchParams();
  torIds.forEach((id) => query.append("torId", id));
  const response = await ownRequest(`/me/bookmarks/ids?${query}`);
  if (!response?.ok) return new Set();
  return new Set(((await response.json()) as { ids: string[] }).ids);
}
