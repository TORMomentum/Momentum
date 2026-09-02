"use client";

import { useEffect, useRef, useState } from "react";

const COUNT_DURATION_MS = 1400;
const REVEAL_THRESHOLD = 0.16;
const NAV_HIDE_AFTER_PX = 120;
const NAV_SHADOW_AFTER_PX = 20;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

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

    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }

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
      { threshold: REVEAL_THRESHOLD },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [target]);

  return { ref, text: value.toFixed(decimals) };
}

/** Fades a section up the first time it enters the viewport. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (prefersReducedMotion()) {
      node.dataset.reveal = "shown";
      return;
    }

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
