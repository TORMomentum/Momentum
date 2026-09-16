"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useState,
  useTransition,
  type DragEvent,
} from "react";
import { uploadDocumentAction, type UploadState } from "./admin.actions";
import styles from "./admin.module.css";

const INITIAL_STATE: UploadState = { result: null, error: null };

// Same values as apps/api's MAX_UPLOAD_BYTES / ALLOWED_MIME_TYPES, passed
// through by next.config.ts — a hard-coded copy here would silently lie the
// moment either is overridden.
const MAX_UPLOAD_BYTES = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_BYTES) || 26_214_400;
const ACCEPT = process.env.NEXT_PUBLIC_ALLOWED_MIME_TYPES ?? "application/pdf,image/jpeg,image/png";
const MIME_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
};
const ACCEPT_HINT = ACCEPT.split(",")
  .map((type) => MIME_LABELS[type.trim()] ?? type.trim())
  .join(", ");
const MAX_UPLOAD_HINT = `สูงสุด ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadCloudIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 18a4.5 4.5 0 0 1-.4-8.98A5.5 5.5 0 0 1 17.5 9.5h.25a3.75 3.75 0 0 1 .5 7.47" />
      <path d="M12 21v-8" />
      <path d="M9 15.5 12 12.5 15 15.5" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z" />
      <path d="M14 3.5V8h4.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.3 2.3L16 10" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5v.01" />
    </svg>
  );
}

export function UploadForm({ onUploaded }: { onUploaded?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [state, formAction, pending] = useActionState(uploadDocumentAction, INITIAL_STATE);
  const [, startTransition] = useTransition();

  // A cleared selection reads as "ready for the next one", not as data loss —
  // the upload already succeeded and landed in the queue by this point.
  useEffect(() => {
    if (!state.result) return;
    setFile(null);
    onUploaded?.();
  }, [state.result, onUploaded]);

  const pickFile = useCallback((picked: File | null | undefined) => {
    if (picked) setFile(picked);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOver(false);
      pickFile(event.dataTransfer.files?.[0]);
    },
    [pickFile],
  );

  const submit = () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    // formAction is meant to be dispatched by <form action> or inside a
    // transition — calling it bare leaves `pending` out of sync (React warns).
    startTransition(() => formAction(formData));
  };

  return (
    <div className={styles.uploadCard}>
      <div
        className={`${styles.uploadDropzone} ${dragOver ? styles.uploadDropzoneOver : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept={ACCEPT}
          className={styles.uploadInputHidden}
          aria-label="เลือกไฟล์ TOR เพื่ออัปโหลด"
          onChange={(event) => pickFile(event.target.files?.[0])}
        />
        <UploadCloudIcon className={styles.uploadIcon} />
        <div className={styles.uploadDropzoneTitle}>ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์</div>
        <div className={styles.uploadDropzoneHint}>
          {ACCEPT_HINT} — {MAX_UPLOAD_HINT}
        </div>
      </div>

      {file && (
        <div className={styles.uploadFile}>
          <FileIcon className={styles.uploadFileIcon} />
          <div className={styles.uploadFileInfo}>
            <div className={styles.uploadFileName}>{file.name}</div>
            <div className={styles.uploadFileSize}>{formatBytes(file.size)}</div>
          </div>
          <button
            type="button"
            className={styles.uploadFileRemove}
            onClick={() => setFile(null)}
            aria-label="นำไฟล์ออก"
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {state.error && (
        <div className={styles.uploadError} role="alert">
          <AlertIcon />
          {state.error}
        </div>
      )}

      {state.result && (
        <div className={styles.uploadSuccess} role="status">
          <CheckCircleIcon />
          {state.result.duplicate
            ? "ไฟล์นี้ซ้ำกับเอกสารที่มีอยู่แล้วในระบบ"
            : "อัปโหลดสำเร็จ — เอกสารเข้าสู่คิวประมวลผลแล้ว"}
        </div>
      )}

      <button type="button" className={styles.adminApproveBtn} onClick={submit} disabled={!file || pending}>
        {pending ? "กำลังอัปโหลด…" : "อัปโหลดเอกสาร"}
      </button>
    </div>
  );
}
