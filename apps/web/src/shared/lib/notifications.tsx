"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ALL_NOTIFICATIONS, type ListedNotification } from "../../data/notifications";

/**
 * Read state for the notification list, shared by the header bell and the
 * Notifications screen.
 *
 * The seed data carries each item's INITIAL unread flag; what a person has
 * since read lives here, so "อ่านทั้งหมด" in the bell and on the screen mean
 * the same thing and survive a reload. Slice 4 moves this to the account,
 * where read state belongs once there are real accounts (FR-G) — the surfaces
 * below keep reading it through this hook either way.
 */

const STORAGE_KEY = "tor-radar:notifications-read";

interface NotificationsState {
  /** The seed list with `unread` reflecting what has since been read. */
  items: ListedNotification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  /** False until stored read state is applied, so the badge does not flash. */
  ready: boolean;
}

const NotificationsContext = createContext<NotificationsState | null>(null);

function readStored(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [readIds, setReadIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReadIds(readStored());
    setReady(true);
  }, []);

  const persist = useCallback((next: string[]) => {
    setReadIds(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // the change still holds for this visit
    }
  }, []);

  const markRead = useCallback(
    (id: string) => {
      setReadIds((current) => {
        if (current.includes(id)) return current;
        const next = [...current, id];
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // as above
        }
        return next;
      });
    },
    [],
  );

  const markAllRead = useCallback(
    () => persist(ALL_NOTIFICATIONS.map((item) => item.id)),
    [persist],
  );

  const value = useMemo<NotificationsState>(() => {
    const items = ALL_NOTIFICATIONS.map((item) => ({
      ...item,
      unread: item.unread && !readIds.includes(item.id),
    }));
    return {
      items,
      unreadCount: items.filter((item) => item.unread).length,
      markRead,
      markAllRead,
      ready,
    };
  }, [readIds, markRead, markAllRead, ready]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsState {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used inside a NotificationsProvider");
  }
  return context;
}
