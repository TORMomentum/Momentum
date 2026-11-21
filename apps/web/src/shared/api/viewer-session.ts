import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Account } from "../lib/viewer";
import { apiRequest } from "./api-client";

// Shared within one server render, including its layout and page.
export const readViewerSession = cache(async (): Promise<{ account: Account | null; expired: boolean }> => {
  const id = (await cookies()).get("tor-radar-session")?.value;
  if (!id) return { account: null, expired: false };
  try {
    const response = await apiRequest("/api/v1/me", {}, id);
    if (!response.ok) return { account: null, expired: response.status === 401 };

    const me = await response.json();
    if (typeof me?.email !== "string") return { account: null, expired: false };
    return {
      account: {
        email: me.email,
        name: typeof me.displayName === "string" ? me.displayName : me.email.split("@")[0],
        role: me.role === "admin" ? "admin" : "vendor",
      },
      expired: false,
    };
  } catch {
    return { account: null, expired: false };
  }
});

export async function redirectExpiredVendor() {
  if ((await readViewerSession()).expired) redirect("/api/auth/expired");
}
