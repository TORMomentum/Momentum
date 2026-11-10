import Link from "next/link";
import type { RequiredDocument } from "@tor-radar/shared";
import type { TorDetailField } from "../../shared/api/tors.api";
import type { Vault } from "../../shared/api/vault.api";
import labels from "../../shared/ui/labels.module.css";
import { documentsOf } from "./BiddingPanel";
import { readinessOf } from "./readiness";
import styles from "./tor-detail.module.css";

/**
 * The documents this TOR asks for, against the files the signed-in vendor keeps (TOR-219). Only what can be
 * matched is matched: a document the TOR ties to a listed certification is checked against the vendor's own
 * certificate files, anything else is left to the vendor to check, never guessed (see readiness.ts). The vault
 * holds the vendor's own statement of what each certificate is; nothing here reads a file.
 */
export function ReadinessPanel({ requiredDocuments, vault }: { requiredDocuments?: TorDetailField; vault: Vault | null }) {
  const documents: RequiredDocument[] = documentsOf(requiredDocuments?.value);
  if (!vault || documents.length === 0) return null;

  const rows = readinessOf(documents, vault.documents);
  const checkable = rows.filter((row) => row.status !== "manual");
  const have = rows.filter((row) => row.status === "have").length;
  const manual = rows.length - checkable.length;

  return (
    <section className={styles.biddingBlock} aria-labelledby="readiness-heading">
      <h2 id="readiness-heading" className={labels.blockLabel}>
        ความพร้อมของเอกสารคุณ
      </h2>
      <div className={styles.biddingRaw}>
        เทียบกับไฟล์ที่คุณเก็บไว้: มีแล้ว {have} จาก {checkable.length} รายการที่ตรวจได้
        {manual > 0 && <> · อีก {manual} รายการต้องตรวจเอง</>}
        {requiredDocuments && !requiredDocuments.verified && <> · รายการเอกสารยังไม่ยืนยัน</>}
      </div>
      <ul className={styles.docList}>
        {rows.map((row) => (
          <li key={`${row.document.holder}:${row.document.name}`} className={styles.docItem}>
            {row.document.name}
            {row.status === "have" && (
              <span className={styles.readyHave}>
                {" "}
                · มีไฟล์ <a href={`/api/vault/${row.file.id}`}>{row.file.filename}</a>
              </span>
            )}
            {row.status === "missing" && (
              <span className={styles.readyMissing}>
                {" "}
                · ยังไม่มีไฟล์ — <Link href="/profile">เพิ่มที่โปรไฟล์</Link>
              </span>
            )}
            {row.status === "manual" && <span className={styles.readyManual}> · ระบบเทียบให้ไม่ได้ กรุณาตรวจเอง</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
