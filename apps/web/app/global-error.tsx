"use client";

import { useEffect, type CSSProperties } from "react";

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "48px 24px",
  background: "Canvas",
  color: "CanvasText",
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const cardStyle: CSSProperties = { maxWidth: "460px", textAlign: "center" };
const codeStyle: CSSProperties = { marginBottom: "18px", fontSize: "56px", fontWeight: 600, lineHeight: 1 };
const titleStyle: CSSProperties = { margin: "0 0 12px", fontSize: "24px", lineHeight: 1.4 };
const bodyStyle: CSSProperties = { margin: "0 0 26px", fontSize: "14px", lineHeight: 1.9 };
const actionsStyle: CSSProperties = { display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "10px" };
const actionStyle: CSSProperties = {
  border: "1px solid ButtonBorder",
  borderRadius: "6px",
  padding: "11px 22px",
  background: "ButtonFace",
  color: "ButtonText",
  font: "600 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  cursor: "pointer",
  textDecoration: "none",
};
const digestStyle: CSSProperties = { marginTop: "22px", color: "GrayText", fontSize: "11px" };

/**
 * The root-layout boundary cannot assume that fonts, providers, or the token
 * stylesheet loaded successfully, so the complete document is self-contained.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="th">
      <body style={{ margin: 0 }}>
        <main style={pageStyle}>
          <div style={cardStyle}>
            <div style={codeStyle}>500</div>
            <h1 style={titleStyle}>ระบบเปิดหน้านี้ไม่สำเร็จ</h1>
            <p style={bodyStyle}>
              ลองเปิดใหม่อีกครั้ง หรือกลับไปหน้าแรกเพื่อเริ่มต้นใหม่
            </p>
            <div style={actionsStyle}>
              <button type="button" onClick={reset} style={actionStyle}>
                ลองใหม่
              </button>
              <a href="/" style={actionStyle}>
                กลับหน้าแรก
              </a>
            </div>
            {error.digest && <div style={digestStyle}>รหัสอ้างอิง: {error.digest}</div>}
          </div>
        </main>
      </body>
    </html>
  );
}
