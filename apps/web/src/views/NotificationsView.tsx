"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../features/app-shell/screens-2.module.css";
import { ALL_NOTIFICATIONS, NOTIFICATION_TABS, type NotificationTabKey } from "../data/notifications";

const DOT_CLASS = { match: styles.notifDotMatch, deadline: styles.notifDotWarn, anomaly: styles.notifDotWarn };
const TAG_CLASS = { match: styles.notifTagMatch, deadline: styles.notifTagWarn, anomaly: styles.notifTagWarn };

/**
 * Notifications screen (FR-B/FR-G). Ported from the "Notifications" screen of
 * mockups/TOR Radar App.dc.html, reachable from the header bell's "ดูการแจ้ง
 * เตือนทั้งหมด →" link.
 *
 * The mockup's "อ่านทั้งหมด" button only zeroes the header's own unread
 * counter (`s.unread`), decoupled from each item's own hard-coded `unread`
 * flag — the items never visually change in the prototype either way. This
 * app has no shared client store between the header and this route (see
 * VendorProfileView's starred/bookmarked-list note), so "อ่านทั้งหมด" here
 * instead clears this screen's own local read-state, which is the
 * meaningful, faithful behaviour for a button that lives on this page.
 */
export function NotificationsView() {
  const [filter, setFilter] = useState<NotificationTabKey>("all");
  const [allRead, setAllRead] = useState(false);

  const items = ALL_NOTIFICATIONS.map((n) => ({ ...n, unread: n.unread && !allRead }));
  const shown =
    filter === "all"
      ? items
      : filter === "unread"
        ? items.filter((n) => n.unread)
        : items.filter((n) => n.kind === filter);

  return (
    <main className={styles.notifPage}>
      <div className={styles.notifHead}>
        <div>
          <h1 className={styles.notifTitle}>การแจ้งเตือน</h1>
          <div className={styles.notifCount}>{ALL_NOTIFICATIONS.length} รายการ · เก็บย้อนหลัง 90 วัน</div>
        </div>
        <div className={styles.notifHeadActions}>
          <button type="button" className={styles.notifMarkReadBtn} onClick={() => setAllRead(true)}>
            อ่านทั้งหมด
          </button>
          <Link href="/profile#notif-settings" className={styles.notifSettingsBtn}>
            ตั้งค่าการแจ้งเตือน
          </Link>
        </div>
      </div>

      <div className={styles.notifTabs}>
        {NOTIFICATION_TABS.map((tab) => (
          <button
            type="button"
            key={tab.key}
            className={`${styles.notifTab} ${filter === tab.key ? styles.notifTabOn : ""}`}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.notifList}>
        {shown.map((n) => (
          <Link
            key={n.id}
            href={`/tors/${n.torSlug}`}
            className={`${styles.notifRow} ${n.unread ? styles.notifRowUnread : ""}`}
          >
            <span className={`${styles.notifDot} ${n.unread ? DOT_CLASS[n.kind] : styles.notifDotRead}`} />
            <div className={styles.notifBody}>
              <div className={styles.notifTagRow}>
                <span className={`${styles.notifTag} ${TAG_CLASS[n.kind]}`}>{n.tag}</span>
                <span className={styles.notifTime}>{n.time}</span>
              </div>
              <div className={styles.notifItemTitle}>{n.title}</div>
              <div className={styles.notifMeta}>{n.meta}</div>
            </div>
          </Link>
        ))}

        {shown.length === 0 && (
          <div className={styles.notifEmpty}>ไม่มีการแจ้งเตือนในหมวดนี้</div>
        )}

        <div className={styles.notifFoot}>การแจ้งเตือนเป็นข้อมูลส่วนตัว · อีเมลส่งตามการตั้งค่าของคุณ</div>
      </div>
    </main>
  );
}
