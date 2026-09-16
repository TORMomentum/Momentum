/** Pipeline state, in Thai, shared by the activity log and the upload screen. */
export const STATE_LABELS: Record<string, string> = {
  queued: "เข้าคิว",
  extracting: "กำลังสกัด",
  published: "เผยแพร่",
  failed: "ไม่สำเร็จ",
  restricted: "จำกัดการเข้าถึง",
};

export function stateLabel(value: string | null): string {
  if (!value) return "—";
  return STATE_LABELS[value] ?? value;
}
