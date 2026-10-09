import Link from "next/link";
import { ChecklistPanel } from "../features/tor-detail/ChecklistPanel";
import { OriginalPreview, type OriginalDocument } from "../features/tor-detail/OriginalPreview";
import styles from "../features/tor-detail/tor-detail.module.css";
import labels from "../shared/ui/labels.module.css";
import { BookmarkButton } from "../features/bookmarks/BookmarkButton";
import type { TorDetail, TorDetailField } from "../shared/api/tors.api";
import {
  addressFrom,
  DEADLINE_SOON_DAYS,
  daysLeftLabel,
  daysUntil,
  deadlineParts,
  formatBaht,
  formatThaiDate,
  formatThaiDateTime,
  websiteFrom,
} from "../shared/lib/format";

/**
 * TOR detail for a real, published record (FR-E-4) — the minimal version the
 * search screen needs so a result never leads to a 404.
 *
 * A server component: nothing here is interactive. Every value is shown as
 * extracted (NFR-F7) — in Arabic numerals, as the data client delivers it — each
 * unconfirmed one is marked, and the provenance line names the model that
 * produced them (NFR-F6). What the ported mockup shows but
 * nothing computes yet — match score, status history — is left out
 * rather than faked.
 */

/** Only statuses that change how a reader should treat the TOR; "announced" is the default state. */
const STATUS_LABELS: Record<string, string> = {
  closed: "ปิดรับแล้ว",
  awarded: "ประกาศผู้ชนะแล้ว",
  cancelled: "ยกเลิกแล้ว",
};

const CONFIDENCE_LABELS: Record<NonNullable<TorDetail["confidenceLevel"]>, string> = {
  high: "สูง",
  medium: "ปานกลาง",
  low: "ต่ำ",
};

function Unconfirmed({ field }: { field: TorDetailField | undefined }) {
  if (!field?.raw || field.verified) return null;
  return <span className={styles.unconfirmedMark}> · ยังไม่ยืนยัน</span>;
}

function Value({ field, missing }: { field: TorDetailField | undefined; missing: string }) {
  return field?.raw ? <>{field.raw}</> : <span className={styles.valueMissing}>{missing}</span>;
}

export function TorRecordView({
  tor,
  originals,
  bookmarked = false,
}: {
  tor: TorDetail;
  /** The stored originals a reader can open: the TOR, and its invitation to bid when the deadline came from one. */
  originals: OriginalDocument[];
  /**
   * Whether the signed-in vendor has saved this TOR. Optional, because most
   * readers are not signed in and have saved nothing — absent means not saved.
   */
  bookmarked?: boolean;
}) {
  const { fields, budgetYear } = tor;
  // Our own formatting of the normalised date and stated time, in Arabic numerals.
  // The document's wording is still shown beneath it, exactly as extracted (NFR-F7).
  const deadline = fields.deadline;
  const deadlineText = deadline
    ? deadlineParts(typeof deadline.value === "string" ? deadline.value : null, deadline.raw)
    : null;
  const status = typeof fields.torStatus?.value === "string" ? fields.torStatus.value : null;
  // Counted only while the TOR is open: announced, as the API's own rule for "open" has it.
  const daysLeft = status === "announced" ? daysUntil(typeof deadline?.value === "string" ? deadline.value : null) : null;
  const daysLeftText = daysLeftLabel(daysLeft);
  const qualifications = Array.isArray(fields.qualifications?.value)
    ? (fields.qualifications.value as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const website = websiteFrom(fields.contact?.raw);
  const hasInvitation = originals.some((document) => document.key === "invitation");
  const previewProps = {
    documents: originals,
    title: fields.title?.raw || "ไม่พบชื่อโครงการในเอกสาร",
    referenceNo: fields.referenceNo?.raw || undefined,
  };
  const address = addressFrom(fields.contact?.raw);

  return (
    <main className={styles.detailPage}>
      <div className={styles.detailMain}>
        <Link href="/search" className={styles.backLink}>
          ← กลับไปผลการค้นหา
        </Link>

        <div className={styles.detailKicker}>
          {status && STATUS_LABELS[status] && (
            <>
              <span className={styles.statusClosed}>{STATUS_LABELS[status]}</span> ·{" "}
            </>
          )}
          {tor.announcedAt && <>ประกาศ {formatThaiDate(tor.announcedAt)}</>}
        </div>
        <h1 className={`${styles.detailTitle} ${styles.detailTitleSpaced}`}>
          <Value field={fields.title} missing="ไม่พบชื่อโครงการในเอกสาร" />
        </h1>

        {tor.unverified && (
          <div className={styles.unverifiedBanner} role="note">
            ข้อมูลที่สกัดยังไม่ได้รับการยืนยันทั้งหมด — ค่าที่มีเครื่องหมาย “ยังไม่ยืนยัน”
            ควรตรวจสอบกับเอกสารต้นฉบับ
          </div>
        )}

        <div className={styles.factGrid}>
          <div className={styles.factCell}>
            <div className={styles.factLabel}>เลขที่โครงการ</div>
            <div className={styles.factValue}>
              <Value field={fields.referenceNo} missing="ไม่ระบุ" />
            </div>
            <div className={styles.factNote}>
              <Unconfirmed field={fields.referenceNo} />
            </div>
          </div>
          <div className={styles.factCell}>
            <div className={styles.factLabel}>งบประมาณ</div>
            <div className={styles.factValue}>
              {typeof fields.budget?.value === "number" && fields.budget.raw ? (
                formatBaht(fields.budget.value)
              ) : (
                <Value field={fields.budget} missing="ไม่ระบุ" />
              )}
            </div>
            <div className={styles.factNote}>
              {fields.budget?.origin === "source" ? "ตามข้อมูลจากระบบ e-GP ของหน่วยงาน" : "ตามที่ระบุในเอกสาร"}
              <Unconfirmed field={fields.budget} />
            </div>
          </div>
          <div className={styles.factCell}>
            <div className={styles.factLabel}>กำหนดยื่นซอง</div>
            <div className={styles.factValue}>
              {deadlineText ? (
                deadlineText.date
              ) : (
                <Value field={fields.deadline} missing="ยังไม่ประกาศเชิญชวน" />
              )}
            </div>
            {deadlineText?.window && <div className={styles.deadlineWindow}>เวลา {deadlineText.window}</div>}
            {daysLeftText && (
              <div
                className={`${styles.daysLeft} ${daysLeft !== null && daysLeft <= DEADLINE_SOON_DAYS ? styles.daysLeftSoon : ""}`}
              >
                {daysLeftText}
              </div>
            )}
            <div className={styles.factNote}>
              {deadlineText && deadline?.raw && (
                <span className={styles.asWritten}>ตามเอกสาร: {deadline.raw}</span>
              )}
              {fields.deadline?.fromDocument &&
                (hasInvitation ? (
                  <OriginalPreview {...previewProps} initial="invitation" className={styles.sourceLink}>
                    จากประกาศเชิญชวน →
                  </OriginalPreview>
                ) : (
                  "จากประกาศเชิญชวน"
                ))}
              <Unconfirmed field={fields.deadline} />
            </div>
          </div>
          <div className={styles.factCell}>
            <div className={styles.factLabel}>ปีงบประมาณ</div>
            <div className={styles.factValue}>{budgetYear ?? "ไม่ระบุ"}</div>
            {/* Derived from the announcement date, not read from the document,
                so it is labelled as such rather than passed off as extracted. */}
            <div className={styles.factNote}>{budgetYear ? "คำนวณจากวันที่ประกาศ (ต.ค.–ก.ย.)" : "ไม่มีวันที่ประกาศ"}</div>
          </div>
          <div className={styles.factCell}>
            <div className={styles.factLabel}>หมวดหมู่</div>
            <div className={styles.factValueSmall}>
              {/* The category is a classification onto the closed list, so its value is what a reader
                  compares and filters by; the document's own wording is kept beneath it (NFR-F7). */}
              {typeof fields.category?.value === "string" && fields.category.value ? (
                fields.category.value
              ) : (
                <Value field={fields.category} missing="ไม่ระบุ" />
              )}
              <Unconfirmed field={fields.category} />
            </div>
            {typeof fields.category?.value === "string" &&
              fields.category.raw &&
              fields.category.raw !== fields.category.value && (
                <div className={styles.factNote}>
                  {/* Not "ตามเอกสาร": the document does not name a category — this is the text it was filed from. */}
                  <span className={styles.asWritten}>จัดหมวดจาก: “{fields.category.raw}”</span>
                </div>
              )}
          </div>
        </div>

        {fields.scopeSummary?.raw && (
          <div className={styles.scopeBlock}>
            <div className={labels.blockLabel}>
              ขอบเขตงาน — สรุปโดย AI
              <Unconfirmed field={fields.scopeSummary} />
            </div>
            <p className={styles.scopeText}>{fields.scopeSummary.raw}</p>
          </div>
        )}

        <dl className={styles.agencyBlock}>
          <div className={styles.agencyRow}>
            <dt className={styles.agencyLabel}>หน่วยงาน:</dt>
            <dd className={styles.agencyValue}>
              <Value field={fields.agency} missing="ไม่ระบุหน่วยงาน" />
              <Unconfirmed field={fields.agency} />
            </dd>
          </div>
          <div className={styles.agencyRow}>
            <dt className={styles.agencyLabel}>อีเมล:</dt>
            <dd className={styles.agencyValue}>
              <span className={styles.valueMissing}>ยังไม่มีข้อมูล</span>
            </dd>
          </div>
          <div className={styles.agencyRow}>
            <dt className={styles.agencyLabel}>เว็บไซต์:</dt>
            <dd className={styles.agencyValue}>
              {website ? (
                <a className={styles.sourceLink} href={website} target="_blank" rel="noreferrer">
                  {website} ↗
                </a>
              ) : (
                <span className={styles.valueMissing}>ยังไม่มีข้อมูล</span>
              )}
            </dd>
          </div>
          <div className={styles.agencyRow}>
            <dt className={styles.agencyLabel}>ที่ตั้ง:</dt>
            <dd className={styles.agencyValue}>
              {address ? (
                address
              ) : (
                <span className={styles.valueMissing}>ยังไม่มีข้อมูล</span>
              )}
            </dd>
          </div>
        </dl>

        {qualifications.length > 0 && (
          <div className={styles.qualsBlock}>
            <div className={labels.blockLabel}>
              คุณสมบัติผู้ยื่นข้อเสนอ
              <Unconfirmed field={fields.qualifications} />
            </div>
            <div className={styles.qualsRow}>
              {qualifications.map((qualification) => (
                <span key={qualification} className={styles.qualPill}>
                  {qualification}
                </span>
              ))}
            </div>
          </div>
        )}

        {tor.checklist && <ChecklistPanel checklist={tor.checklist} />}

        <div className={styles.provenance}>
          {tor.provenance && (
            <>
              สกัดเมื่อ {formatThaiDateTime(tor.provenance.extractedAt)} · โมเดล {tor.provenance.extractModel}
              {tor.provenance.modelVersion !== tor.provenance.extractModel && <> ({tor.provenance.modelVersion})</>}
              {tor.confidenceLevel && <> · ความเชื่อมั่น{CONFIDENCE_LABELS[tor.confidenceLevel]}</>}
              <br />
            </>
          )}
          เนื้อหาสกัดโดย AI — ตรวจสอบกับเอกสารต้นฉบับเสมอ
        </div>
      </div>

      <div className={styles.detailSide}>
        <div className={styles.sideActions}>
          <BookmarkButton torId={tor.id} initial={bookmarked} />
          <OriginalPreview {...previewProps} className={styles.openDocBtn}>
            เปิดเอกสารต้นฉบับ
          </OriginalPreview>
        </div>

        {tor.sourceProject && (
          <a className={styles.sourceProjectBtn} href={tor.sourceProject.url} target="_blank" rel="noreferrer">
            ดูโครงการนี้ในระบบ e-GP ↗
          </a>
        )}

        <div className={styles.docBlock}>
          <div className={`${labels.blockLabel} ${labels.blockLabelMid}`}>แหล่งที่มา</div>
          {tor.sourceUrl ? (
            <a className={styles.sourceLink} href={tor.sourceUrl} target="_blank" rel="noreferrer">
              ประกาศต้นทางของหน่วยงาน ↗
            </a>
          ) : (
            <span className={styles.valueMissing}>นำเข้าโดยการอัปโหลด ไม่มีลิงก์ต้นทาง</span>
          )}
          <div className={styles.docHash}>
            ยืนยันด้วย SHA-256 · เก็บถาวรไม่แก้ไข
            <br />
            <span className={styles.hashValue}>{tor.contentHash}</span>
          </div>
        </div>
      </div>
    </main>
  );
}
