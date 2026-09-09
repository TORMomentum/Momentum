"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import styles from "../features/app-shell/login.module.css";
import { useViewer } from "../shared/lib/viewer";

/**
 * Sign in and registration (FR-D-1, FR-D-3). Ported from the "Login" screen of
 * mockups/TOR Radar App.dc.html.
 *
 * NOTHING IS AUTHENTICATED HERE. Slice 4 builds real accounts, password
 * hashing (NFR-S1) and consent records against the API. Until then the form
 * checks the SHAPE of what was typed and then signs the prototype viewer in
 * under that email, so the signed-in interaction can be reviewed. The password
 * is never sent anywhere and never stored — not in memory past this render,
 * not in localStorage.
 */

/** Account-creation rule, stated once. The signup placeholder reads from it. */
const MIN_PASSWORD_LENGTH = 8;

/** Deliberately loose: one @, something either side, a dot in the domain.
 * The server decides whether an address is real; this only catches typos. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
    text: "ดาวและบุ๊กมาร์กของคุณเป็นข้อมูลส่วนตัว ไม่แสดงต่อสาธารณะ · PDPA · ส่งออกหรือลบข้อมูลได้ทุกเมื่อ",
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

  function submit() {
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
    setPassword("");
    signIn({ email: address });
    // Registering lands on the profile, where skills are chosen — that is the
    // next thing a new vendor has to do before matching can say anything.
    router.push(isSignup ? "/profile" : "/dashboard");
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
              {!isSignup && <span className={styles.forgot}>ลืมรหัสผ่าน?</span>}
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

          <button type="submit" className={styles.submit}>
            {copy.cta}
          </button>
        </form>

        <div className={styles.divider}>
          <span className={styles.dividerLine} />
          <span className={styles.dividerWord}>หรือ</span>
          <span className={styles.dividerLine} />
        </div>

        <div className={styles.alternatives}>
          {/* Both are placeholders for identity providers that slice 4 wires
              up; neither can sign anyone in yet, so they say so rather than
              silently doing what the password form does. */}
          <button
            type="button"
            className={styles.alternative}
            onClick={() => setError("ThaiD จะเปิดใช้งานเมื่อระบบบัญชีจริงพร้อม")}
          >
            <span className={styles.thaid}>ThaiD</span>
            ดำเนินการต่อด้วย ThaiD
          </button>
          <button
            type="button"
            className={styles.alternative}
            onClick={() => setError("การเข้าสู่ระบบด้วยอีเมลองค์กรจะเปิดใช้งานเมื่อระบบบัญชีจริงพร้อม")}
          >
            ดำเนินการต่อด้วยอีเมลองค์กร
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
