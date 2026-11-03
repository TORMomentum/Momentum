"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Who is looking at the page (FR-D-1).
 *
 * This holds no credential and decides nothing. The session lives in a
 * host-only httpOnly cookie the browser cannot read, the account behind it is
 * resolved on the SERVER in the root layout and handed in as `initialAccount`,
 * and every authorization decision is taken by the API against the account row
 * as it is at that moment. What is here is display identity, so the header can
 * show a name without a second round trip.
 */

export type AccountRole = "vendor" | "admin";

export interface Account {
  email: string;
  /** Display name. Derived from the email when the account did not state one. */
  name: string;
  /** The authorization role as the API reports it — never a label to render. */
  role: AccountRole;
}

/** What the role means to a reader. The role itself is never shown raw. */
const ROLE_LABELS: Record<AccountRole, string> = {
  vendor: "ผู้ประกอบการ",
  admin: "ผู้ดูแลระบบ",
};

export function roleLabel(role: AccountRole): string {
  return ROLE_LABELS[role];
}

/** "somchai.dev@gmail.com" → "somchai.dev", which beats showing the raw email. */
export function nameFromEmail(email: string): string {
  return email.split("@")[0]?.trim() || email;
}

interface ViewerState {
  signedIn: boolean;
  account: Account | null;
  /**
   * Always true. The server resolves the session before the first paint, so
   * there is no window in which the answer is unknown. Kept so the screens that
   * guard on it do not all have to change at once.
   */
  ready: boolean;
  signIn: (account: { email: string; name?: string; role?: AccountRole }) => void;
  signOut: () => void;
}

const ViewerContext = createContext<ViewerState | null>(null);

export function ViewerProvider({
  children,
  initialAccount = null,
}: {
  children: React.ReactNode;
  initialAccount?: Account | null;
}) {
  // Resolved on the server from the session cookie, so the first render is
  // already correct and nothing flashes the signed-out branch.
  const [account, setAccount] = useState<Account | null>(initialAccount);
  const router = useRouter();

  const signIn = useCallback((input: { email: string; name?: string; role?: AccountRole }) => {
    setAccount({
      email: input.email.trim(),
      name: input.name?.trim() || nameFromEmail(input.email),
      role: input.role ?? "vendor",
    });
  }, []);

  const signOut = useCallback(() => {
    setAccount(null);
    // The cookie is cleared by the route handler, but every server component
    // on screen was rendered for the signed-in reader; without this they keep
    // showing that reader's name until a full reload.
    void fetch("/api/auth/logout", { method: "POST" }).finally(() => router.refresh());
  }, [router]);

  const value = useMemo<ViewerState>(
    () => ({ signedIn: account !== null, account, ready: true, signIn, signOut }),
    [account, signIn, signOut],
  );

  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

/**
 * The viewer, or null when there is no provider above this component.
 *
 * For controls that hide themselves when nobody is signed in — a bookmark
 * button, say. They already behave correctly with no account, so a page
 * rendered without account context should show them hidden, not crash.
 * Everything that genuinely needs an account keeps using useViewer, which
 * throws, so a missing provider is still caught where it matters.
 */
export function useOptionalViewer(): ViewerState | null {
  return useContext(ViewerContext);
}

export function useViewer(): ViewerState {
  const context = useContext(ViewerContext);
  if (!context) {
    throw new Error("useViewer must be used inside a ViewerProvider");
  }
  return context;
}
