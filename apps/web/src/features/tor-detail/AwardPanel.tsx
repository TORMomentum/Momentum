import type { TorAward } from "../../shared/api/tors.api";
import { formatBaht, formatThaiDate, formatThaiDateTime } from "../../shared/lib/format";
import { OriginalPreview, type OriginalDocument } from "./OriginalPreview";
import labels from "../../shared/ui/labels.module.css";
import styles from "./tor-detail.module.css";

/** A value's confidence as a whole percentage, as every AI value carries it (NFR-F6). */
function percent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/** The winning price against the TOR's own budget: how far apart, and on which side. */
export interface PriceComparison {
  /** The two figures compared, as numbers. */
  price: number;
  budget: number;
  side: "below" | "above" | "equal";
  /** Baht, always positive. */
  difference: number;
  /** Of the budget, one decimal, always positive. */
  percent: number;
}

/**
 * TOR-278: the price the announcement names against the budget the TOR names. Both must be real, positive numbers;
 * otherwise there is nothing to compare and nothing is shown. The result is arithmetic and no more: it does not say
 * the gap is good or bad (NFR-F5).
 */
export function comparePrice(price: unknown, budget: unknown): PriceComparison | null {
  if (typeof price !== "number" || typeof budget !== "number" || !Number.isFinite(price) || !Number.isFinite(budget) || price <= 0 || budget <= 0) return null;
  const difference = Math.abs(budget - price);
  return {
    price,
    budget,
    side: price < budget ? "below" : price > budget ? "above" : "equal",
    difference,
    percent: Math.round((difference / budget) * 1000) / 10,
  };
}

const SIDE_TH = { below: "ต่ำกว่า", above: "สูงกว่า" } as const;

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
  budget,
}: {
  award?: TorAward | null;
  originals: OriginalDocument[];
  title: string;
  referenceNo?: string;
  /** The TOR's budget as extracted; with the winning price it gives the comparison row (TOR-278). */
  budget?: { value?: unknown; verified?: boolean } | null;
}) {
  if (!award) return null;
  const document = originals.find((doc) => doc.key === "award");
  const comparison = comparePrice(award.price.value, budget?.value);
  // Either reading may be one the pipeline has not confirmed; the comparison inherits the doubt.
  const comparisonUnconfirmed = award.unverified || budget?.verified === false;

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
        {comparison && (
          <div className={styles.awardRow}>
            <dt>เทียบกับงบประมาณ</dt>
            <dd>
              {comparison.side === "equal" ? (
                <>เท่ากับงบประมาณ {formatBaht(comparison.budget)}</>
              ) : (
                <>
                  {SIDE_TH[comparison.side]}งบประมาณ {formatBaht(comparison.difference)} ({comparison.percent}%)
                </>
              )}
              {comparisonUnconfirmed && <span className={styles.unconfirmedMark}> · ยังไม่ยืนยัน</span>}
              <div className={styles.biddingRaw}>
                งบประมาณ {formatBaht(comparison.budget)} ตามที่สกัดจาก TOR · ราคาที่เสนอ {formatBaht(comparison.price)} ตามประกาศผู้ชนะ
              </div>
            </dd>
          </div>
        )}
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
