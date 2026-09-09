"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Who is looking at the page.
 *
 * This is a PROTOTYPE stand-in for a session, not authentication. It exists so
 * the signed-out interaction in the mockup can be built and reviewed before
 * slice 4 delivers real accounts (FR-D-1). It stores a boolean in the browser
 * and nothing else: no credentials are checked, no token is issued, and no
 * route is protected by it. Slice 4 replaces this file — it must not be
 * extended into something that looks like auth.
 */

const STORAGE_KEY = "tor-radar:viewer";

interface ViewerState {
  signedIn: boolean;
  /** False until the stored value has been read, so nothing flashes the wrong branch. */
  ready: boolean;
  signIn: () => void;
  signOut: () => void;
}

const ViewerContext = createContext<ViewerState | null>(null);

export function ViewerProvider({ children }: { children: React.ReactNode }) {
  // The mockup's default is signed OUT (`loggedIn` placeholder is false), and
  // the server has no way to know better, so both start there and agree.
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);

  // Read in an effect, never during render: touching localStorage while
  // rendering makes the server and client disagree, which React reports as a
  // hydration mismatch. This repo has hit that bug before.
  useEffect(() => {
    try {
      setSignedIn(window.localStorage.getItem(STORAGE_KEY) === "in");
    } catch {
      // private windows and blocked storage both throw; signed out stands
    }
    setReady(true);
  }, []);

  const persist = useCallback((next: boolean) => {
    setSignedIn(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "in" : "out");
    } catch {
      // the choice still applies for this visit
    }
  }, []);

  const value = useMemo<ViewerState>(
    () => ({
      signedIn,
      ready,
      signIn: () => persist(true),
      signOut: () => persist(false),
    }),
    [signedIn, ready, persist],
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
