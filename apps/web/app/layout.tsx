import type { Metadata } from "next";
import { Anuphan, IBM_Plex_Mono, IBM_Plex_Sans_Thai } from "next/font/google";
import "../src/shared/styles/tokens.css";
import { NotificationsProvider } from "../src/shared/lib/notifications";
import { nameFromEmail, ViewerProvider, type Account } from "../src/shared/lib/viewer";
import { cookies } from "next/headers";
import { apiRequest } from "../src/shared/api/api-client";

// Self-hosted at build time: no render-blocking request, no layout shift.
const display = Anuphan({
  subsets: ["thai", "latin"],
  weight: ["500", "600", "700"], // Anuphan has no 800
  variable: "--font-display",
});

const body = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});

const data = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-data",
});

export const metadata: Metadata = {
  title: "TOR Radar — การจัดซื้อภาครัฐ มองเห็นได้ ตรวจสอบได้",
  description:
    "แพลตฟอร์มรวม TOR จากประกาศจัดซื้อจัดจ้างภาครัฐ — สกัดข้อมูลด้วย AI จับคู่ผู้ประกอบการตามทักษะ และเปิดข้อมูลราคาให้ประชาชนตรวจสอบ",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Who is signed in is decided here, once, from the cookie — the browser is
  // never asked and never told the session id.
  const sessionId = (await cookies()).get("tor-radar-session")?.value;
  let account: Account | null = null;
  if (sessionId) {
    try {
      const response = await apiRequest("/api/v1/me", {}, sessionId);
      if (response.ok) {
        const me = (await response.json()) as { email: string; displayName?: string; role: string };
        // An unrecognised role is treated as the least privileged one rather
        // than passed through: this value reaches no authorization decision,
        // but it must never become one by accident either.
        account = {
          email: me.email,
          name: me.displayName ?? nameFromEmail(me.email),
          role: me.role === "admin" ? "admin" : "vendor",
        };
      }
    } catch { /* Public pages remain available if the API is unavailable. */ }
  }
  return (
    <html lang="th" className={`${display.variable} ${body.variable} ${data.variable}`}>
      <body>
        {/* Session and notification read-state wrap EVERY route, public ones
            included: the landing page's own header has to know whether someone
            is signed in, and the bell's unread count must not reset when a
            reader crosses between the two layouts. */}
        <ViewerProvider initialAccount={account}>
          <NotificationsProvider>{children}</NotificationsProvider>
        </ViewerProvider>
      </body>
    </html>
  );
}
