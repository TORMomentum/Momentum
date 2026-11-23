import type { ProjectStageEntry, StageKind } from "@tor-radar/shared";
import { formatThaiDate, formatThaiDateTime } from "../../shared/lib/format";
import { OriginalPreview, type OriginalDocument } from "./OriginalPreview";
import styles from "./tor-detail.module.css";
import labels from "../../shared/ui/labels.module.css";

/** Our own Thai name for a stage the source left unnamed (e-GP names `BOQ` nothing). */
const KIND_LABELS: Record<StageKind, string> = {
  draft: "ร่างเอกสารประกวดราคา",
  "median-price": "ประกาศราคากลาง",
  invitation: "ประกาศเชิญชวน",
  awarded: "ประกาศผู้ชนะการเสนอราคา",
  cancelled: "ยกเลิกประกาศเชิญชวน",
  other: "ประกาศอื่นของโครงการ",
};

const FINAL_TAGS: Partial<Record<StageKind, { label: string; className: string }>> = {
  awarded: { label: "ได้ผู้ชนะแล้ว", className: styles.checkPass ?? "" },
  cancelled: { label: "ยกเลิก", className: styles.checkFail ?? "" },
};

/**
 * Oldest first. The source's table is not in date order, so it is sorted by day; a stable sort keeps the
 * source's order on a tie, which is its publication order, so the last row is the stage the API calls
 * current (`latestStage`, TOR-205).
 */
export function stagesInOrder(stages: readonly ProjectStageEntry[]): ProjectStageEntry[] {
  return [...stages].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
}

/** The stored original a stage's own document opens in, when we hold it and the reader may open it. */
function documentOf(stage: ProjectStageEntry, torId: string, originals: OriginalDocument[]): OriginalDocument | null {
  if (stage.kind === "draft" && stage.recordId === torId) return originals.find((doc) => doc.key === "tor") ?? null;
  if (stage.kind === "invitation" && stage.recordId) return originals.find((doc) => doc.key === "invitation") ?? null;
  return null;
}

/**
 * TOR-206: every stage the source published for this TOR's project, with its day, the current one marked,
 * and a link to its document when we hold it; the project on the source site for the rest (TOR-237).
 * Renders nothing for a record with no stages read — another source, or not read yet.
 */
export function StagePanel({
  torId,
  stages,
  current,
  checkedAt,
  projectUrl,
  originals,
  title,
  referenceNo,
}: {
  torId: string;
  stages?: ProjectStageEntry[];
  current?: { code: string; kind: StageKind; on: string } | null;
  checkedAt?: string | null;
  projectUrl?: string | null;
  originals: OriginalDocument[];
  /** For the document window's header, as the page's own "เปิดเอกสารต้นฉบับ" gives it. */
  title: string;
  referenceNo?: string;
}) {
  if (!stages || stages.length === 0) return null;
  const rows = stagesInOrder(stages);
  const last = rows.length - 1;

  return (
    <section className={styles.stageBlock} aria-labelledby="stages-heading">
      <h2 id="stages-heading" className={labels.blockLabel}>
        ขั้นตอนของโครงการ
      </h2>
      <ol className={styles.stageList}>
        {rows.map((stage, index) => {
          const isCurrent = Boolean(current) && index === last;
          const document = documentOf(stage, torId, originals);
          const tag = isCurrent ? FINAL_TAGS[stage.kind] : undefined;
          return (
            <li
              key={`${stage.code}-${stage.on}-${index}`}
              className={`${styles.stageItem} ${isCurrent ? styles.stageCurrent : ""}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className={styles.stageDot} aria-hidden="true" />
              <div className={styles.stageBody}>
                <div className={styles.stageName}>
                  {/* The source's own name, as published (NFR-F7); ours only when it gave none. */}
                  {stage.description ?? KIND_LABELS[stage.kind]}
                  {tag && <span className={`${styles.stageTag} ${tag.className}`}>{tag.label}</span>}
                  {isCurrent && !tag && <span className={styles.stageNow}>ขั้นตอนปัจจุบัน</span>}
                </div>
                <div className={styles.stageMeta}>
                  {formatThaiDate(stage.on)}
                  {document && (
                    <>
                      {" · "}
                      {/* The same window as "เปิดเอกสารต้นฉบับ", opened on this stage's document. */}
                      <OriginalPreview
                        documents={originals}
                        initial={document.key}
                        title={title}
                        referenceNo={referenceNo}
                        className={styles.sourceLink}
                      >
                        ดูเอกสาร
                      </OriginalPreview>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className={styles.stageFooter}>
        ข้อมูลจากระบบ e-GP{checkedAt ? ` · ตรวจล่าสุด ${formatThaiDateTime(checkedAt)}` : ""}
        {projectUrl && (
          <>
            {" · "}
            <a className={styles.sourceLink} href={projectUrl} target="_blank" rel="noreferrer">
              ดูทุกประกาศของโครงการใน e-GP ↗
            </a>
          </>
        )}
      </div>
    </section>
  );
}
