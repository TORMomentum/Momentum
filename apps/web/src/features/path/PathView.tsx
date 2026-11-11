import Link from "next/link";
import { WORK_CATEGORIES } from "@tor-radar/seeds";
import type { FieldPath, PathRequirement } from "../../shared/api/path.api";
import { formatBaht } from "../../shared/lib/format";
import styles from "./path.module.css";

const HOLDS: Record<string, string> = { true: "คุณมีแล้ว", false: "ยังไม่มีในโปรไฟล์", null: "ยังไม่ได้ระบุในโปรไฟล์" };

function Row({ item, sample }: { item: PathRequirement; sample: number }) {
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.name}>{item.th}</div>
        <div className={styles.meta}>
          {item.asked} จาก {sample} TOR{item.kind === "registration" ? " (งานตั้งแต่เกณฑ์งบที่ต้องขึ้นทะเบียน)" : ""}
        </div>
      </div>
      <span className={`${styles.status} ${item.holds === false ? styles.lacking : ""}`}>{HOLDS[String(item.holds)]}</span>
    </li>
  );
}

/**
 * The company path (TOR-224): pick a field, see what the TORs collected in it ask for and which of that the
 * vendor has not stated. A plain GET form, so the target lives in the URL and nothing about the choice is stored.
 */
export function PathView({ target, result }: { target: string | null; result: FieldPath | null }) {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>เส้นทางของบริษัท: สาขางานที่อยากขยาย</h1>
      <p className={styles.note}>
        เลือกสาขางานที่ต้องการเติบโต ระบบจะสรุปว่า TOR ในสาขานั้นที่เก็บไว้ขอใบรับรองหรือทะเบียนอะไรบ้าง เทียบกับสิ่งที่คุณระบุไว้ในโปรไฟล์
      </p>

      <form method="get" className={styles.picker}>
        <select name="target" aria-label="สาขางานเป้าหมาย" defaultValue={target ?? ""} className={styles.select}>
          <option value="" disabled>
            เลือกสาขางาน
          </option>
          {WORK_CATEGORIES.map((group) => (
            <optgroup key={group.id} label={group.th}>
              <option value={group.id}>ทั้งกลุ่ม: {group.th}</option>
              {group.children.map((leaf) => (
                <option key={leaf.id} value={leaf.id}>
                  {leaf.th}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button type="submit" className={styles.button}>
          ดูช่องว่าง
        </button>
      </form>

      {target && !result && (
        <p className={styles.error} role="alert">
          ดูข้อมูลของสาขานี้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
        </p>
      )}

      {result && (
        <section className={styles.result} aria-label={`ช่องว่างของสาขา ${result.target.th}`}>
          <h2 className={styles.subtitle}>{result.target.th}</h2>
          {result.sample === 0 ? (
            <p className={styles.note}>ยังไม่มี TOR ในสาขานี้ที่เก็บไว้ จึงยังสรุปไม่ได้</p>
          ) : (
            <>
              <p className={styles.note}>
                สรุปจาก {result.sample} TOR ที่เผยแพร่แล้วในสาขานี้ นับเฉพาะที่ระบบอ่านจากเอกสารได้มั่นใจ ตัวเลขนี้เป็นภาพรวมของ TOR ที่เก็บไว้เท่านั้น ไม่ใช่เงื่อนไขของทุกโครงการ
              </p>
              {result.requirements.length === 0 ? (
                <p className={styles.note}>TOR ในสาขานี้ที่อ่านได้ ไม่ได้ระบุใบรับรองหรือทะเบียนที่อยู่ในรายการของเรา</p>
              ) : (
                <ul className={styles.list}>
                  {result.requirements.map((item) => (
                    <Row key={`${item.kind}:${item.id}`} item={item} sample={result.sample} />
                  ))}
                </ul>
              )}
              {result.budget && (
                <p className={styles.note}>
                  งบกลางของ TOR ในสาขานี้ประมาณ {formatBaht(result.budget.medianThb)} (จาก {result.budget.n} TOR ที่ระบุงบ)
                  {result.yourLargestProjectThb !== null
                    ? ` · ผลงานที่ใหญ่ที่สุดที่คุณระบุไว้ ${formatBaht(result.yourLargestProjectThb)}`
                    : " · คุณยังไม่ได้ระบุมูลค่าผลงานในโปรไฟล์"}
                </p>
              )}
              <p className={styles.note}>
                ถ้ารายการใดแสดงว่ายังไม่ได้ระบุ ให้เพิ่มที่ <Link href="/profile">โปรไฟล์</Link> ระบบจะไม่ถือว่าคุณขาดจนกว่าคุณจะระบุว่ามีอะไรบ้าง
              </p>
            </>
          )}
        </section>
      )}
    </main>
  );
}
