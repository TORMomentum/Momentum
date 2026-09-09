"use client";

import { useReveal } from "./useLandingMotion";

/**
 * Fades one element up the first time it reaches the viewport.
 *
 * The mockup marks eleven separate elements with `data-rv`, not five sections:
 * the three step cards each carry their own, which is why they arrive one after
 * another as you scroll rather than as a single slab. Wrapping per element is
 * what reproduces that.
 */
export function Reveal({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useReveal<HTMLDivElement>();

  return (
    <div ref={ref} data-reveal className={className} style={style}>
      {children}
    </div>
  );
}
