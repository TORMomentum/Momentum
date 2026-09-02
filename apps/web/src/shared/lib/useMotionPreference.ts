"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "tor-radar:motion";
const MOTION_ATTRIBUTE = "data-motion";

export type MotionChoice = "on" | "off" | "system";

function systemPrefersMotion(): boolean {
  if (typeof window === "undefined") return true;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readStoredChoice(): MotionChoice {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "on" || stored === "off" ? stored : "system";
  } catch {
    // private windows and blocked storage both throw; the system setting stands
    return "system";
  }
}

/**
 * Whether this page should animate.
 *
 * The operating system's setting is respected by default. A reader can override
 * it on the page and the choice persists, which matters because some browsers
 * report `reduce` when the reader never asked for it — an embedded webview, or
 * a machine where the OS animation setting means something slightly different.
 * The system preference decides until someone says otherwise.
 */
export function useMotionPreference() {
  const [choice, setChoice] = useState<MotionChoice>("system");
  const [systemMotion, setSystemMotion] = useState(true);

  // Read on the client only: touching localStorage or matchMedia during render
  // makes the server and client disagree, which React reports as a mismatch.
  useEffect(() => {
    setChoice(readStoredChoice());
    setSystemMotion(systemPrefersMotion());

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setSystemMotion(!query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const animate = choice === "system" ? systemMotion : choice === "on";

  // CSS keys off this attribute rather than the media query alone, so the
  // override reaches stylesheets as well as scripts.
  useEffect(() => {
    document.documentElement.setAttribute(MOTION_ATTRIBUTE, animate ? "on" : "off");
  }, [animate]);

  const toggle = useCallback(() => {
    const next: MotionChoice = animate ? "off" : "on";
    setChoice(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // the choice still applies for this visit
    }
  }, [animate]);

  return { animate, choice, toggle };
}
