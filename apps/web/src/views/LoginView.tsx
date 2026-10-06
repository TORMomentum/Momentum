"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import styles from "../features/auth/auth.module.css";
import { useViewer } from "../shared/lib/viewer";

/**
 * Sign in and registration (FR-D-1, FR-D-3).
 *
 * The password leaves this component exactly once, to the Next route handler
 * that forwards it to the API over the server-side connection; it is never
 * stored, never logged, and never put in a URL. The session that comes back
 * lives in an httpOnly cookie this code cannot read.
 *
 * Shape checks below are courtesy only — they catch a typo before a round trip.
 * The server decides every real question, and its answer for a failed sign-in
 * is deliberately the same whether the address is unknown, the password wrong,
 * or the account not yet verified.
 */

/** Account-creation rule, stated once. The signup placeholder reads from it. */
export const MIN_PASSWORD_LENGTH = 8;

/** Deliberately loose: one @, something either side, a dot in the domain.
 * The server decides whether an address is real; this only catches typos. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The server does not say which part was wrong, and neither does this. */
const AUTH_FAILURE = "อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือยังไม่ได้ยืนยันอีเมล";
const COPY = {
  login: {
    kicker: "เข้าสู่ระบบผู้ประกอบการ",
    title: "เข้าสู่ระบบเพื่อรับ TOR ที่ตรงกับคุณ",
    sub: "รับคะแนนจับคู่ตามทักษะ บันทึก TOR ที่สนใจ และรับอีเมลแจ้งเตือนภายใน 5 นาทีหลังประกาศ",
    cta: "เข้าสู่ระบบ",
    switchPrompt: "ยังไม่มีบัญชี?",
    switchCta: "ลงทะเบียนผู้ประกอบการ",
    pwPlaceholder: "รหัสผ่านของคุณ",
  },
  signup: {
    kicker: "ลงทะเบียนผู้ประกอบการ",
    title: "สร้างโปรไฟล์ทักษะครั้งเดียว",
    sub: "ให้ TOR ที่ตรงกับความสามารถของคุณวิ่งมาหาเอง — ฟรี ไม่มีค่าใช้จ่าย",
    cta: "สร้างบัญชี",
    switchPrompt: "มีบัญชีอยู่แล้ว?",
    switchCta: "เข้าสู่ระบบ",
    pwPlaceholder: `อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`,
  },
} as const;

const TRUST_POINTS = [
  {
    icon: (
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    ),
    text: "ข้อมูลมาจากประกาศสาธารณะเท่านั้น · เก็บต้นฉบับถาวรพร้อม SHA-256 และลิงก์กลับแหล่งที่มา",
  },
  {
    icon: (
      <>
        <circle cx="12" cy="12" r="9.5" />
        <path d="M12 16v-5" />
        <path d="M12 8h.01" />
      </>
    ),
    text: "เนื้อหาที่สกัดโดย AI มีป้ายกำกับและคะแนนความมั่นใจเสมอ — ไม่ใช่คำตัดสินทางกฎหมาย",
  },
  {
    icon: (
      <>
        <rect x="3.5" y="10.5" width="17" height="11" rx="2" />
        <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" />
      </>
    ),
    text: "บุ๊กมาร์กของคุณเป็นข้อมูลส่วนตัว ไม่แสดงต่อสาธารณะ · PDPA · ส่งออกหรือลบข้อมูลได้ทุกเมื่อ",
  },
];

export function LoginView() {
  const router = useRouter();
  const params = useSearchParams();
  const { signIn } = useViewer();

  const isSignup = params.get("mode") === "signup";
  const copy = isSignup ? COPY.signup : COPY.login;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const address = email.trim();

    if (!EMAIL_SHAPE.test(address)) {
      setError("กรุณากรอกอีเมลให้ถูกต้อง");
      return;
    }
    if (!password) {
      setError("กรุณากรอกรหัสผ่าน");
      return;
    }
    // Length is an account-CREATION rule. On sign-in the stored password is
    // whatever it is, and only the server can judge it.
    if (isSignup && password.length < MIN_PASSWORD_LENGTH) {
      setError(`รหัสผ่านสั้นเกินไป (อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร)`);
      return;
    }
    if (isSignup && !consented) {
      setError("กรุณายอมรับนโยบายความเป็นส่วนตัวก่อนสร้างบัญชี");
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${isSignup ? "register" : "login"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          isSignup ? { email: address, password, consent: true } : { email: address, password },
        ),
      });
      // Held no longer than the request that needed it.
      setPassword("");

      if (!response.ok) {
        setError(isSignup ? "สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" : AUTH_FAILURE);
        return;
      }

      if (isSignup) {
        // Registration never signs anyone in: the address has to be confirmed
        // first, and the reply is the same whether or not it was already taken.
        setSent(true);
        return;
      }

      signIn({ email: address });
      // The header and every other server-rendered part of the page were drawn
      // for a signed-out reader; without this they stay that way.
      router.refresh();
      router.push("/dashboard");
    } catch {
      setError("เชื่อมต่อไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.split}>
      <div className={styles.formSide}>
        <div className={styles.kicker}>{copy.kicker}</div>
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.sub}>{copy.sub}</p>

        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div>
            <label className={styles.label} htmlFor="login-email">
              อีเมล
            </label>
            <input
              id="login-email"
              type="email"
              className={styles.input}
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </div>

          <div>
            <div className={styles.labelRow}>
              <label className={styles.label} htmlFor="login-password">
                รหัสผ่าน
              </label>
              {!isSignup && <Link className={styles.forgot} href="/forgot-password">ลืมรหัสผ่าน?</Link>}
            </div>
            <input
              id="login-password"
              type="password"
              className={styles.input}
              placeholder={copy.pwPlaceholder}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isSignup ? "new-password" : "current-password"}
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}

          {sent && (
            <div className={styles.error} role="status">
              ส่งลิงก์ยืนยันไปที่อีเมลของคุณแล้ว โปรดตรวจกล่องขาเข้าเพื่อยืนยันบัญชี
            </div>
          )}

          {isSignup && (
            <button
              type="button"
              className={styles.consent}
              onClick={() => setConsented((on) => !on)}
              aria-pressed={consented}
            >
              <span className={`${styles.consentBox} ${consented ? styles.consentOn : ""}`}>
                {consented ? "✓" : ""}
              </span>
              <span>
                ยินยอมให้เก็บและประมวลผลข้อมูลตามนโยบายความเป็นส่วนตัว (PDPA) ·
                ขอส่งออกหรือลบข้อมูลได้ทุกเมื่อ
              </span>
            </button>
          )}

          <button type="submit" className={styles.submit} disabled={busy}>
            {busy ? "กำลังดำเนินการ…" : copy.cta}
          </button>
        </form>

        <div className={styles.divider}>
          <span className={styles.dividerLine} />
          <span className={styles.dividerWord}>หรือ</span>
          <span className={styles.dividerLine} />
        </div>

        <div className={styles.alternatives}>
          {/* Google is the only identity provider. ThaiD and an organisation
              directory were dropped deliberately: this is a public platform for
              vendors, so sign-in must not require a government identity, and no
              national ID or tax ID is collected anywhere (SRS Appendix, TOR-156). */}
          <button
            type="button"
            className={styles.alternative}
            onClick={() => setError("การเข้าสู่ระบบด้วย Google จะเปิดใช้งานเมื่อเชื่อมต่อบัญชีแล้ว")}
          >
            <svg className={styles.providerMark} viewBox="0 0 48 48" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8a10 10 0 0 1-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1z"
              />
              <path
                fill="#34A853"
                d="M24 46c6 0 11-2 14.5-5.4l-7.1-5.5A13 13 0 0 1 24 37c-5.8 0-10.7-3.9-12.4-9.1H4.3v5.7A22 22 0 0 0 24 46z"
              />
              <path fill="#FBBC05" d="M11.6 27.9a13 13 0 0 1 0-8.4v-5.7H4.3a22 22 0 0 0 0 19.8l7.3-5.7z" />
              <path
                fill="#EA4335"
                d="M24 11c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.5 30 2.4 24 2.4A22 22 0 0 0 4.3 13.8l7.3 5.7C13.3 14.3 18.2 11 24 11z"
              />
            </svg>
            ดำเนินการต่อด้วย Google
          </button>
        </div>

        <div className={styles.switch}>
          {copy.switchPrompt}{" "}
          <Link
            className={styles.switchLink}
            href={isSignup ? "/login" : "/login?mode=signup"}
          >
            {copy.switchCta}
          </Link>
        </div>

        <Link className={styles.publicEscape} href="/dashboard">
          ← ดูแดชบอร์ดสาธารณะโดยไม่เข้าสู่ระบบ
        </Link>
      </div>

      <aside className={styles.trustSide}>
        <div>
          <div className={styles.trustBrand}>TOR RADAR</div>
          <div className={styles.trustHeadline}>
            ข้อมูลจัดซื้อจัดจ้างภาครัฐ
            <br />
            <span>ที่ตรวจสอบย้อนกลับได้ทุกบรรทัด</span>
          </div>
        </div>

        <div className={styles.trustPoints}>
          {TRUST_POINTS.map((point) => (
            <div className={styles.trustPoint} key={point.text}>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {point.icon}
              </svg>
              <div>{point.text}</div>
            </div>
          ))}
        </div>

        <div className={styles.trustFoot}>
          แพลตฟอร์มอิสระ — ไม่ใช่หน่วยงานราชการ
          <br />
          แดชบอร์ดและการค้นหา TOR ใช้ฟรีโดยไม่ต้องมีบัญชี
        </div>
      </aside>
    </main>
  );
}
