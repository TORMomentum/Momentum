import type { Metadata } from "next";
import { Anuphan, IBM_Plex_Mono, IBM_Plex_Sans_Thai } from "next/font/google";
import "../src/shared/styles/tokens.css";
import { NotificationsProvider } from "../src/shared/lib/notifications";
import { ViewerProvider } from "../src/shared/lib/viewer";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${display.variable} ${body.variable} ${data.variable}`}>
      <body>
        {/* Session and notification read-state wrap EVERY route, public ones
            included: the landing page's own header has to know whether someone
            is signed in, and the bell's unread count must not reset when a
            reader crosses between the two layouts. */}
        <ViewerProvider>
          <NotificationsProvider>{children}</NotificationsProvider>
        </ViewerProvider>
      </body>
    </html>
  );
}
