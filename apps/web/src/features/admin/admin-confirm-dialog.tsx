"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./admin.module.css";

export type AdminConfirmTone = "danger" | "primary";

export interface AdminConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  tone: AdminConfirmTone;
  reason?: { label: string };
  onClose: () => void;
  onConfirm: (reason?: string) => Promise<void>;
}

export function AdminConfirmDialog({
  open,
  title,
  body,
  cancelLabel,
  confirmLabel,
  tone,
  reason,
  onClose,
  onConfirm,
}: AdminConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(false);
  const titleId = useId();
  const bodyId = useId();
  const [reasonValue, setReasonValue] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      triggerRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      setReasonValue("");
      dialog.showModal();
      cancelRef.current?.focus();
      return;
    }

    if (!open && dialog.open) {
      dialog.close();
      triggerRef.current?.focus();
      triggerRef.current = null;
    }
  }, [open]);

  useEffect(() => () => triggerRef.current?.focus(), []);

  function requestClose() {
    if (!pending) onClose();
  }

  async function submit() {
    const trimmedReason = reasonValue.trim();
    if (pendingRef.current || (reason && !trimmedReason)) return;

    pendingRef.current = true;
    setPending(true);
    try {
      await onConfirm(reason ? trimmedReason : undefined);
      onClose();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.adminConfirmDialog}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <form
        className={styles.adminConfirmForm}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 id={titleId} className={styles.adminConfirmTitle}>{title}</h2>
        <div id={bodyId} className={styles.adminConfirmBody}>{body}</div>

        {reason && (
          <label className={styles.adminConfirmReason}>
            <span>{reason.label}</span>
            <textarea
              className={styles.adminConfirmTextarea}
              value={reasonValue}
              onChange={(event) => setReasonValue(event.target.value)}
              disabled={pending}
              required
              rows={4}
            />
          </label>
        )}

        <div className={styles.adminConfirmActions}>
          <button
            ref={cancelRef}
            type="button"
            className={styles.adminConfirmCancel}
            onClick={requestClose}
            disabled={pending}
            autoFocus
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            className={`${styles.adminConfirmSubmit} ${tone === "danger" ? styles.adminConfirmDanger : styles.adminConfirmPrimary}`}
            disabled={pending || Boolean(reason && !reasonValue.trim())}
          >
            {pending ? "กำลังดำเนินการ…" : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
