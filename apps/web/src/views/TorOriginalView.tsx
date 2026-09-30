import Link from "next/link";
import type { OriginalDocument } from "../features/tor-detail/OriginalPreview";
import styles from "../features/tor-detail/tor-original.module.css";
import type { TorDetail } from "../shared/api/tors.api";
import { formatThaiDate } from "../shared/lib/format";

/**
 * The stored original of a TOR, shown inside the app (FR-A-2, NFR-F6): the
 * agency's own document exactly as collected, with the record it belongs to,
 * its source, and the hash that proves it has never been altered.
 *
 * A server component. The frame is the browser's own document viewer, which
 * already pages, zooms and searches, so nothing here re-implements those.
 */
export function TorOriginalView({
  tor,
  documents,
  active,
}: {
  tor: TorDetail;
  documents: OriginalDocument[];
  active: OriginalDocument["key"];
}) {
  const current = documents.find((document) => document.key === active) ?? documents[0];
  const title = tor.fields.title?.raw || "ไม่พบชื่อโครงการในเอกสาร";
  const agency = tor.fields.agency?.raw;
  const referenceNo = tor.fields.referenceNo?.raw;
  const isImage = current.contentType?.startsWith("image/") ?? false;

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <Link href={`/tors/${encodeURIComponent(tor.id)}`} className={styles.back}>
          ← กลับไปหน้ารายละเอียด
        </Link>

        <div className={styles.headRow}>
          <div className={styles.headText}>
            <div className={styles.kicker}>
              เอกสารต้นฉบับ
              {referenceNo && <> · เลขที่โครงการ {referenceNo}</>}
              {tor.announcedAt && <> · ประกาศ {formatThaiDate(tor.announcedAt)}</>}
            </div>
            <h1 className={styles.title}>{title}</h1>
            {agency && <div className={styles.agency}>{agency}</div>}
          </div>

          <div className={styles.actions}>
            <a className={styles.primaryAction} href={current.downloadUrl}>
              ดาวน์โหลด
            </a>
            <a className={styles.secondaryAction} href={current.inlineUrl} target="_blank" rel="noreferrer">
              เปิดเต็มหน้าจอ ↗
            </a>
            {tor.sourceProject && (
              <a className={styles.secondaryAction} href={tor.sourceProject.url} target="_blank" rel="noreferrer">
                ดูใน e-GP ↗
              </a>
            )}
          </div>
        </div>

        {documents.length > 1 && (
          <nav className={styles.tabs} aria-label="เลือกเอกสาร">
            {documents.map((document) => (
              <Link
                key={document.key}
                href={document.href}
                className={`${styles.tab} ${document.key === current.key ? styles.tabOn : ""}`}
                aria-current={document.key === current.key ? "page" : undefined}
                scroll={false}
              >
                {document.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <section className={styles.viewer} aria-label={current.label}>
        {/* Sits behind the frame and shows until the document paints over it. */}
        <div className={styles.loading} aria-hidden="true">
          <span className={styles.spinner} />
          กำลังโหลดเอกสาร…
        </div>
        {isImage ? (
          // A stored original, streamed as-is through the proxy: no image optimisation.
          <img className={styles.image} src={current.inlineUrl} alt={`${current.label}: ${title}`} />
        ) : (
          <iframe
            key={current.key}
            className={styles.frame}
            src={current.inlineUrl}
            title={`${current.label}: ${title}`}
          />
        )}
      </section>

      <footer className={styles.foot}>
        <div className={styles.provenance}>
          <span className={styles.seal}>✓</span>
          <div>
            <div className={styles.provenanceTitle}>เอกสารจากหน่วยงานตามที่เผยแพร่ · เก็บถาวร ไม่มีการแก้ไข</div>
            {current.contentHash ? (
              <div className={styles.hash}>SHA-256 {current.contentHash}</div>
            ) : (
              <div className={styles.hash}>ประกาศเชิญชวนของโครงการเดียวกัน ใช้อ่านกำหนดยื่นซอง</div>
            )}
          </div>
        </div>
        {tor.sourceUrl && (
          <a className={styles.sourceLink} href={tor.sourceUrl} target="_blank" rel="noreferrer">
            ประกาศต้นทางของหน่วยงาน ↗
          </a>
        )}
      </footer>

      <p className={styles.mobileNote}>
        บนมือถือ บางเบราว์เซอร์แสดงได้เฉพาะหน้าแรก กด “เปิดเต็มหน้าจอ” เพื่ออ่านทั้งฉบับ
      </p>
    </main>
  );
}
