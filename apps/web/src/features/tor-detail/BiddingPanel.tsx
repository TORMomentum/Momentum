import type { EvaluationCriterion, EvaluationMethod, RequiredDocument } from "@tor-radar/shared";
import type { TorDetailField } from "../../shared/api/tors.api";
import labels from "../../shared/ui/labels.module.css";
import styles from "./tor-detail.module.css";

/**
 * How the winner is chosen and what the bidder must show (TOR-209, TOR-210),
 * read by AI from the TOR. Both blocks say so and mark an unconfirmed value
 * (NFR-F6); names are shown as the document wrote them (NFR-F7). Records
 * extracted before these fields existed have none, and render nothing here.
 */

const METHOD_LABELS: Record<EvaluationMethod, string> = {
  lowest_price: "เกณฑ์ราคา — เลือกผู้เสนอราคาต่ำสุด",
  price_performance: "เกณฑ์ราคาและประสิทธิภาพ — ให้คะแนนตามหัวข้อ",
  other: "เกณฑ์อื่น",
};

const HOLDER_LABELS: Record<RequiredDocument["holder"], string> = {
  company: "เอกสารของบริษัท",
  personnel: "เอกสารของบุคลากร",
  unspecified: "ไม่ระบุว่าของใคร",
};
const HOLDER_ORDER: RequiredDocument["holder"][] = ["company", "personnel", "unspecified"];

function criteriaOf(value: unknown): EvaluationCriterion[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is EvaluationCriterion =>
      typeof item?.name === "string" && typeof item?.weight === "number",
  );
}

function documentsOf(value: unknown): RequiredDocument[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is RequiredDocument =>
      typeof item?.name === "string" && HOLDER_ORDER.includes(item?.holder),
  );
}

function methodOf(value: unknown): EvaluationMethod | null {
  return typeof value === "string" && value in METHOD_LABELS ? (value as EvaluationMethod) : null;
}

function Unconfirmed({ field }: { field: TorDetailField | undefined }) {
  if (!field || field.verified) return null;
  return <span className={styles.unconfirmedMark}> · ยังไม่ยืนยัน</span>;
}

export function BiddingPanel({
  evaluationMethod,
  evaluationWeights,
  requiredDocuments,
}: {
  evaluationMethod?: TorDetailField;
  evaluationWeights?: TorDetailField;
  requiredDocuments?: TorDetailField;
}) {
  const method = methodOf(evaluationMethod?.value);
  const criteria = criteriaOf(evaluationWeights?.value);
  const documents = documentsOf(requiredDocuments?.value);
  if (!method && criteria.length === 0 && documents.length === 0) return null;

  return (
    <>
      {(method || criteria.length > 0) && (
        <section className={styles.biddingBlock} aria-labelledby="evaluation-heading">
          <h2 id="evaluation-heading" className={labels.blockLabel}>
            เกณฑ์การพิจารณา — สกัดโดย AI
            <Unconfirmed field={evaluationMethod ?? evaluationWeights} />
          </h2>
          {method && <div className={styles.biddingMethod}>{METHOD_LABELS[method]}</div>}
          {evaluationMethod?.raw && <div className={styles.biddingRaw}>ตามเอกสาร: {evaluationMethod.raw}</div>}
          {criteria.length > 0 && (
            <table className={styles.criteriaTable}>
              <thead>
                <tr>
                  <th scope="col">หัวข้อ</th>
                  <th scope="col">น้ำหนัก (ร้อยละ)</th>
                </tr>
              </thead>
              <tbody>
                {criteria.map((criterion) => (
                  <tr key={criterion.name}>
                    <td>{criterion.name}</td>
                    <td className={styles.criteriaWeight}>{criterion.weight}</td>
                  </tr>
                ))}
              </tbody>
              {/* The sum is shown, never forced: when the document's own weights do not add up the reader sees it. */}
              <tfoot>
                <tr>
                  <th scope="row">รวม</th>
                  <td className={styles.criteriaWeight}>
                    {Math.round(criteria.reduce((sum, criterion) => sum + criterion.weight, 0) * 100) / 100}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>
      )}

      {documents.length > 0 && (
        <section className={styles.biddingBlock} aria-labelledby="documents-heading">
          <h2 id="documents-heading" className={labels.blockLabel}>
            เอกสารที่ต้องยื่น — สกัดโดย AI
            <Unconfirmed field={requiredDocuments} />
          </h2>
          {HOLDER_ORDER.map((holder) => {
            const group = documents.filter((document) => document.holder === holder);
            if (group.length === 0) return null;
            return (
              <div key={holder} className={styles.docGroup}>
                <div className={styles.docGroupLabel}>{HOLDER_LABELS[holder]}</div>
                <ul className={styles.docList}>
                  {group.map((document) => (
                    <li key={`${holder}:${document.name}`} className={styles.docItem}>
                      {document.name}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}
