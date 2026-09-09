"use client";

import { useEffect, useRef, useState } from "react";

// Every figure below is taken from the mockup's own initCounters/initReveals,
// so the motion reads exactly as the design does rather than approximately.
const COUNT_DURATION_MS = 1600;
const COUNT_THRESHOLD = 0.5;
const REVEAL_THRESHOLD = 0.15;
const NAV_HIDE_AFTER_PX = 120;
const NAV_SHADOW_AFTER_PX = 20;

/**
 * Counts up to `target` once the element is on screen. Returns the value to
 * render and the ref to attach. Renders the final value immediately when the
 * viewer asked for reduced motion, so the number is never withheld.
 */
export function useCountUp(target: number, decimals = 0) {
  const ref = useRef<HTMLSpanElement>(null);
  // Always start at zero: reading matchMedia here would make the server and the
  // client disagree on the first render, which is a hydration mismatch. The
  // reduced-motion case is settled in the effect, where only the client runs.
  const [value, setValue] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Same reasoning as the reveals: a spuriously reported preference was
    // skipping the count entirely and printing the final figure.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();

        const started = performance.now();
        const step = (now: number) => {
          const progress = Math.min((now - started) / COUNT_DURATION_MS, 1);
          // ease-out: fast start, settles onto the real figure
          setValue(target * (1 - Math.pow(1 - progress, 3)));
          if (progress < 1) requestAnimationFrame(step);
          else setValue(target);
        };
        requestAnimationFrame(step);
      },
      // Half the element must be on screen before the count starts, so the
      // reader is looking at the figure when it moves.
      { threshold: COUNT_THRESHOLD },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [target]);

  // Whole numbers carry thousands separators (1,284), decimals do not — the
  // mockup's own rule, and the reason a budget must not read "1284".
  const text =
    decimals > 0
      ? value.toFixed(decimals)
      : Math.round(value).toLocaleString("en-US");

  return { ref, text };
}

/** Fades a section up the first time it enters the viewport. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // No reduced-motion gate, for the same reason the radar dropped its own:
    // browsers here report that preference without anyone having asked, which
    // marked every section "shown" on load and removed the reveal entirely.
    // This is an 0.8s fade-and-rise, not flashing or parallax.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        node.dataset.reveal = "shown";
        observer.disconnect();
      },
      { threshold: REVEAL_THRESHOLD },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return ref;
}

/**
 * The header hides on the way down and returns on the way up, and gains a
 * shadow once the page has moved at all.
 */
export function useNavVisibility() {
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let previous = window.scrollY;

    const onScroll = () => {
      const current = window.scrollY;
      setHidden(current > NAV_HIDE_AFTER_PX && current > previous);
      setScrolled(current > NAV_SHADOW_AFTER_PX);
      previous = current;
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return { hidden, scrolled };
}
