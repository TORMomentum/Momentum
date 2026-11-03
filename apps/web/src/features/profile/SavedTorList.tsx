"use client";

import Link from "next/link";
import { useState } from "react";
import type { BookmarkRow } from "../../shared/api/bookmarks.api";
import { formatBaht, formatThaiDate } from "../../shared/lib/format";
import { BookmarkButton } from "../bookmarks/BookmarkButton";
import styles from "./profile.module.css";

export function SavedTorList({ initial }: { initial: BookmarkRow[] | null }) {
  const [rows, setRows] = useState(initial);
  if (rows === null) return <p className={styles.trackEmpty}>ยังโหลด TOR ที่บันทึกไว้ไม่ได้ในขณะนี้</p>;
  if (rows.length === 0) return <p className={styles.trackEmpty}>ยังไม่มี TOR ที่บันทึกไว้</p>;
  return <div className={styles.trackList}>{rows.map((row) => (
    <div className={styles.trackRow} key={row.id}>
      <Link href={`/tors/${row.id}`} className={styles.savedTorLink}>
        <div className={styles.trackTitle}>{row.title || "ไม่พบชื่อโครงการในเอกสาร"}</div>
        <div className={styles.trackAgency}>{row.agency || "ไม่ระบุหน่วยงาน"}{row.deadline && ` · ยื่นภายใน ${formatThaiDate(row.deadline)}`}{typeof row.budget === "number" && ` · ${formatBaht(row.budget)}`}</div>
      </Link>
      <BookmarkButton torId={row.id} initial onChanged={(saved) => { if (!saved) setRows((current) => current?.filter((item) => item.id !== row.id) ?? null); }} />
    </div>
  ))}</div>;
}

/** Profile-owned composition keeps saved TOR presentation out of the route view. */
export function SavedTorsSection({ initial }: { initial: BookmarkRow[] | null }) {
  return (
    <section className={styles.profileCard}>
      <h2 className={styles.profileFactTitle}>TOR ที่บันทึกไว้</h2>
      <SavedTorList initial={initial} />
    </section>
  );
}
