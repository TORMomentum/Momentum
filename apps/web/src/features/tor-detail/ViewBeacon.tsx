"use client";

import { useEffect } from "react";

/**
 * Tells the API this signed-in, consenting vendor opened this TOR. Rendered only when the server already knows
 * consent is on, so it never fires for anyone else; a failure is ignored, because a missed view must never
 * disturb reading the page.
 */
export function ViewBeacon({ torId }: { torId: string }) {
  useEffect(() => {
    fetch("/api/auth/me/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ torId, type: "view" }),
      keepalive: true,
    }).catch(() => undefined);
  }, [torId]);
  return null;
}
