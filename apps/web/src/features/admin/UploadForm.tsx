"use client";

import { useEffect, useRef, useActionState } from "react";
import { uploadDocumentAction, type UploadState } from "./admin.actions";
import styles from "./admin.module.css";

const INITIAL_STATE: UploadState = { result: null, error: null };

export function UploadForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(uploadDocumentAction, INITIAL_STATE);

  // A cleared file input reads as "ready for the next one", not as data loss —
  // the upload already succeeded and landed in the queue by this point.
  useEffect(() => {
    if (state.result) formRef.current?.reset();
  }, [state.result]);

  return (
    <form ref={formRef} action={formAction} className={styles.uploadForm}>
      <label className={styles.adminFieldLabel} htmlFor="upload-file">
        ไฟล์ TOR (PDF, JPG, PNG — สูงสุด 25MB)
      </label>
      <input
        id="upload-file"
        name="file"
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className={styles.uploadInput}
        required
      />

      <button type="submit" className={styles.adminApproveBtn} disabled={pending}>
        {pending ? "กำลังอัปโหลด…" : "อัปโหลด"}
      </button>

      {state.error && (
        <div className={styles.overviewOffline} role="alert">
          {state.error}
        </div>
      )}

      {state.result && (
        <div className={styles.uploadSuccess} role="status">
          {state.result.duplicate
            ? "ไฟล์นี้ซ้ำกับเอกสารที่มีอยู่แล้วในระบบ"
            : "อัปโหลดสำเร็จ — เอกสารเข้าสู่คิวประมวลผลแล้ว"}
        </div>
      )}
    </form>
  );
}
