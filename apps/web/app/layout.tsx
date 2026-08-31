import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "TOR Radar BKK",
  description: "แพลตฟอร์มรวมศูนย์ประกาศ TOR จัดซื้อจัดจ้างของกรุงเทพมหานคร",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
