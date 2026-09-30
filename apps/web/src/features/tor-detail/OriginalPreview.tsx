"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import styles from "./tor-original.module.css";

/** One stored original the viewer can show: the TOR itself, or its invitation to bid. */
export interface OriginalDocument {
  key: "tor" | "invitation";
  label: string;
  /** The full-page viewer for this document — where the trigger goes without JavaScript. */
  href: string;
  /** The proxy route, inline — what the frame displays. */
  inlineUrl: string;
  /** The proxy route, as an attachment — the download button. */
  downloadUrl: string;
  /** Known for the TOR; an invitation is not a public record, so its hash is not. */
  contentHash: string | null;
  contentType: string | null;
}

/**
 * A trigger that opens a TOR's stored original in a dialog over the page, with
 * the page dimmed behind it. Without JavaScript the trigger is a plain link to
 * the full-page viewer, so the document is always reachable.
 *
 * The frame mounts only while the dialog is open: a closed preview never
 * downloads a PDF the reader did not ask for.
 */
export function OriginalPreview({
  documents,
  initial = "tor",
  title,
  referenceNo,
  className,
  children,
}: {
  documents: OriginalDocument[];
  initial?: OriginalDocument["key"];
  title: string;
  referenceNo?: string;
  className?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(initial);

  const start = documents.find((document) => document.key === initial) ?? documents[0];
  const current = documents.find((document) => document.key === active) ?? start;
  const isImage = current.contentType?.startsWith("image/") ?? false;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // The page behind stays put while the reader scrolls the document.
      document.body.style.overflow = "hidden";
    }
    if (!open && dialog.open) dialog.close();
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  function show(event: MouseEvent<HTMLAnchorElement>) {
    // A new-tab or modified click keeps the link's own behaviour.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    setActive(initial);
    setOpen(true);
  }

  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    // The dialog box itself is the target only where the backdrop shows.
    if (event.target === dialogRef.current) setOpen(false);
  }

  return (
    <>
      <a href={start.href} className={className} onClick={show}>
        {children}
      </a>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-label={`เอกสารต้นฉบับ: ${title}`}
        onClose={() => setOpen(false)}
        onClick={closeOnBackdrop}
      >
        {open && (
          <div className={styles.dialogBox}>
            <div className={styles.dialogHead}>
              <div className={styles.dialogHeadText}>
                <div className={styles.kicker}>
                  เอกสารต้นฉบับ{referenceNo && <> · เลขที่โครงการ {referenceNo}</>}
                </div>
                <div className={styles.dialogTitle}>{title}</div>
              </div>
              <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="ปิด">
                ×
              </button>
            </div>

            <div className={styles.dialogBar}>
              {documents.length > 1 ? (
                <div className={styles.dialogTabs} role="tablist" aria-label="เลือกเอกสาร">
                  {documents.map((document) => (
                    <button
                      key={document.key}
                      type="button"
                      role="tab"
                      aria-selected={document.key === current.key}
                      className={`${styles.tab} ${document.key === current.key ? styles.tabOn : ""}`}
                      onClick={() => setActive(document.key)}
                    >
                      {document.label}
                    </button>
                  ))}
                </div>
              ) : (
                <span className={styles.dialogLabel}>{current.label}</span>
              )}
              <div className={styles.dialogActions}>
                <a className={styles.smallSecondary} href={current.inlineUrl} target="_blank" rel="noreferrer">
                  เปิดในแท็บใหม่ ↗
                </a>
                <a className={styles.smallPrimary} href={current.downloadUrl}>
                  ดาวน์โหลด
                </a>
              </div>
            </div>

            <div className={styles.dialogViewer}>
              <div className={styles.loading} aria-hidden="true">
                <span className={styles.spinner} />
                กำลังโหลดเอกสาร…
              </div>
              {isImage ? (
                // A stored original, streamed as-is through the proxy: no image optimisation.
                <img className={styles.image} src={current.inlineUrl} alt={`${current.label}: ${title}`} />
              ) : (
                <iframe key={current.key} className={styles.frame} src={current.inlineUrl} title={`${current.label}: ${title}`} />
              )}
            </div>

            <div className={styles.dialogFoot}>
              <span className={styles.sealSmall}>✓</span>
              เอกสารจากหน่วยงานตามที่เผยแพร่ · เก็บถาวร ไม่มีการแก้ไข
              {current.contentHash && (
                <span className={styles.hashShort} title={`SHA-256 ${current.contentHash}`}>
                  SHA-256 {current.contentHash.slice(0, 12)}…
                </span>
              )}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
