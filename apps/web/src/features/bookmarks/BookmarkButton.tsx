"use client";

import { useState } from "react";
import icons from "../../shared/ui/tor-actions.module.css";
import { useViewer } from "../../shared/lib/viewer";

export function BookmarkButton({ torId, initial, className = "", onChanged }: { torId: string; initial: boolean; className?: string; onChanged?: (saved: boolean) => void }) {
  const { signedIn } = useViewer();
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  async function toggle(event: React.SyntheticEvent) {
    event.preventDefault(); event.stopPropagation();
    if (saving) return;
    const previous = saved; const next = !previous;
    setSaved(next); setSaving(true); onChanged?.(next);
    try {
      const response = await fetch(`/api/auth/me/bookmarks/${encodeURIComponent(torId)}`, { method: next ? "PUT" : "DELETE" });
      if (!response.ok) throw new Error("bookmark request failed");
    } catch {
      setSaved(previous); onChanged?.(previous);
    } finally { setSaving(false); }
  }
  if (!signedIn) return null;
  return (
    <button type="button" className={`${icons.bookmarkBtn} ${className}`.trim()} aria-pressed={saved} aria-label={saved ? "เลิกบันทึก TOR" : "บันทึก TOR"} title={saved ? "เลิกบันทึก TOR" : "บันทึก TOR"} onClick={toggle} disabled={saving}>
      <svg width="15" height="15" viewBox="0 0 24 24" className={`${icons.bookIcon} ${saved ? icons.bookIconOn : ""}`} strokeWidth="2" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>
    </button>
  );
}
