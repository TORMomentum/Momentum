import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiRequest } from "./api-client";

// Shared within one server render, including its layout and page.
export const readViewerSession = cache(async () => {
  const id = (await cookies()).get("tor-radar-session")?.value;
  if (!id) return null;
  try {
    return await apiRequest("/api/v1/me", {}, id);
  } catch {
    return null;
  }
});

export async function redirectExpiredVendor() {
  if ((await readViewerSession())?.status === 401) redirect("/api/auth/expired");
}
