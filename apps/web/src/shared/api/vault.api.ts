import "server-only";
import { cookies } from "next/headers";
import { apiRequest } from "./api-client";

export type VaultKind = "cv" | "certificate" | "past_work";

/** One file the vendor keeps. The storage key never leaves the API. */
export interface VaultDocument {
  id: string;
  kind: VaultKind;
  /** The vendor's own statement of which listed certificate this is. */
  certificationId?: string;
  filename: string;
  contentType: string;
  bytes: number;
  uploadedAt: string;
}

export interface Vault {
  documents: VaultDocument[];
  limits: { maxFileBytes: number; maxFiles: number };
}

/** The signed-in vendor's kept files, read on the server from the session cookie. Null when it cannot be read. */
export async function fetchOwnVault(): Promise<Vault | null> {
  const sessionId = (await cookies()).get("tor-radar-session")?.value;
  if (!sessionId) return null;
  try {
    const response = await apiRequest("/api/v1/me/vault", {}, sessionId);
    if (!response.ok) return null;
    return (await response.json()) as Vault;
  } catch {
    return null;
  }
}
