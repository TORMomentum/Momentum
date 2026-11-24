import type { TorAward } from "../../shared/api/tors.api";
import { formatBaht, formatThaiDate, formatThaiDateTime } from "../../shared/lib/format";
import { OriginalPreview, type OriginalDocument } from "./OriginalPreview";
import labels from "../../shared/ui/labels.module.css";
import styles from "./tor-detail.module.css";

/** A value's confidence as a whole percentage, as every AI value carries it (NFR-F6). */
function percent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/**
 * TOR-221: who won the project and at what price, read by AI from the agency's winner announcement. The block
 * says it is AI output, gives each value's confidence, the model, and the announcement itself (NFR-F6), and is
 * marked when the reading is not confirmed. A winner who is a natural person arrives from the API already
 * replaced by "บุคคลธรรมดา" (FR-B-5). Renders nothing when no announcement was collected.
 */
export function AwardPanel({
  award,
  originals,
  title,
  referenceNo,
}: {
  award?: TorAward | null;
  originals: OriginalDocument[];
  title: string;
  referenceNo?: string;
}) {
  if (!award) return null;
  const document = originals.find((doc) => doc.key === "award");

  return (
    <section className={styles.awardBlock} aria-labelledby="award-heading">
      <h2 id="award-heading" className={labels.blockLabel}>
        ผลการประกวดราคา — สกัดโดย AI
        {award.unverified && <span className={styles.unconfirmedMark}> · ยังไม่ยืนยัน</span>}
      </h2>
      <dl className={styles.awardList}>
        <div className={styles.awardRow}>
          <dt>ผู้ชนะการเสนอราคา</dt>
          {/* As the announcement wrote it (NFR-F7). */}
          <dd>
            {award.winner.value ?? "ไม่พบในเอกสาร"}
            {award.winner.value && <span className={styles.awardConfidence}> · ความเชื่อมั่น {percent(award.winner.confidence)}</span>}
          </dd>
        </div>
        <div className={styles.awardRow}>
          <dt>ราคาที่เสนอ</dt>
          <dd>
            {award.price.value !== null ? formatBaht(award.price.value) : "ไม่พบในเอกสาร"}
            {award.price.value !== null && <span className={styles.awardConfidence}> · ความเชื่อมั่น {percent(award.price.confidence)}</span>}
            {award.price.raw && <div className={styles.biddingRaw}>ตามเอกสาร: {award.price.raw}</div>}
          </dd>
        </div>
        {award.announcedOn && (
          <div className={styles.awardRow}>
            <dt>วันที่ประกาศ</dt>
            <dd>{formatThaiDate(award.announcedOn)}</dd>
          </div>
        )}
      </dl>
      <div className={styles.stageFooter}>
        จากประกาศผู้ชนะการเสนอราคาในระบบ e-GP · สกัดเมื่อ {formatThaiDateTime(award.provenance.extractedAt)} · โมเดล{" "}
        {award.provenance.extractModel}
        {award.provenance.modelVersion !== award.provenance.extractModel && <> ({award.provenance.modelVersion})</>}
        {document && (
          <>
            {" · "}
            <OriginalPreview documents={originals} initial="award" title={title} referenceNo={referenceNo} className={styles.sourceLink}>
              ดูประกาศผู้ชนะ
            </OriginalPreview>
          </>
        )}
      </div>
    </section>
  );
}
