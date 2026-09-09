"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Who is looking at the page, and which account they are using.
 *
 * This is a PROTOTYPE stand-in for a session, not authentication. It exists so
 * the signed-in and signed-out interactions in the mockup can be built and
 * reviewed before slice 4 delivers real accounts (FR-D-1).
 *
 * What it does NOT do, and must never be extended to fake: it does not verify
 * a password, it does not issue a token, it does not protect a route, and it
 * NEVER stores a password — the sign-in form's password is read for its shape
 * and then dropped. Only the account's display identity is kept, in this
 * browser. Slice 4 replaces this file with a real session against the API.
 */

const STORAGE_KEY = "tor-radar:viewer";

export interface Account {
  email: string;
  /** Display name. Derived from the email when the form did not collect one. */
  name: string;
  /** Shown under the name in the account menu, as the mockup's profile does. */
  role: string;
}

const DEFAULT_ROLE = "FREELANCE FULL-STACK";

/** "somchai.dev@gmail.com" → "somchai.dev", which beats showing the raw email. */
export function nameFromEmail(email: string): string {
  return email.split("@")[0]?.trim() || email;
}

interface ViewerState {
  signedIn: boolean;
  account: Account | null;
  /** False until the stored value has been read, so nothing flashes the wrong branch. */
  ready: boolean;
  signIn: (account: { email: string; name?: string; role?: string }) => void;
  signOut: () => void;
}

const ViewerContext = createContext<ViewerState | null>(null);

function readStored(): Account | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // Anything the browser hands back is untrusted: an older shape, a hand-
    // edited value, or another tab's junk. Only a well-formed record signs in.
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Account).email === "string" &&
      (parsed as Account).email.length > 0
    ) {
      const account = parsed as Account;
      return {
        email: account.email,
        name: typeof account.name === "string" && account.name ? account.name : nameFromEmail(account.email),
        role: typeof account.role === "string" && account.role ? account.role : DEFAULT_ROLE,
      };
    }
  } catch {
    // private windows, blocked storage and malformed JSON all land here
  }
  return null;
}

export function ViewerProvider({ children }: { children: React.ReactNode }) {
  // The server cannot know who is looking, so both sides start signed out and
  // agree; the stored account is applied in the effect below.
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);

  // Read in an effect, never during render: touching localStorage while
  // rendering makes the server and client disagree, which React reports as a
  // hydration mismatch. This repo has hit that bug before.
  useEffect(() => {
    setAccount(readStored());
    setReady(true);
  }, []);

  // A sign-in in one tab applies to the others, which is what a real session
  // would do.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY) setAccount(readStored());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const signIn = useCallback((input: { email: string; name?: string; role?: string }) => {
    const next: Account = {
      email: input.email.trim(),
      name: input.name?.trim() || nameFromEmail(input.email),
      role: input.role?.trim() || DEFAULT_ROLE,
    };
    setAccount(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // the sign-in still holds for this visit
    }
  }, []);

  const signOut = useCallback(() => {
    setAccount(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // nothing to clear
    }
  }, []);

  const value = useMemo<ViewerState>(
    () => ({ signedIn: account !== null, account, ready, signIn, signOut }),
    [account, ready, signIn, signOut],
  );

  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export function useViewer(): ViewerState {
  const context = useContext(ViewerContext);
  if (!context) {
    throw new Error("useViewer must be used inside a ViewerProvider");
  }
  return context;
}
