import type { CgdBranchId } from "@tor-radar/seeds";
import type { TorDocument } from "../../core/db.js";
import type { TorClassification } from "./tor-classifier.js";

/**
 * Which กรมบัญชีกลาง branch a TOR's work falls under, when that can be told.
 *
 * Inferred from the classified kind of work and the title, so it is a guess:
 * the scorer uses it to lower a score and say why, never to hide a TOR. A TOR
 * whose branch is not clear returns null and is left alone.
 */
export function cgdBranchOf(record: Pick<TorDocument, "fields">, classification: TorClassification): CgdBranchId | null {
  const leaves = new Set(classification.leaves.map((leaf) => leaf.id));
  const title = String(record.fields.title?.value ?? record.fields.title?.raw ?? "");

  // Order matters: the more specific wording wins over the leaf it sits in.
  if (/ขุดลอก/.test(title)) return /ทะเล|ชายฝั่ง/.test(title) ? "dredging-coastal" : "dredging-inland";
  if (/เขื่อนป้องกันตลิ่ง|ป้องกันตลิ่ง|กัดเซาะชายฝั่ง/.test(title)) return "bank-protection";
  if (leaves.has("construction.road")) return /สะพาน/.test(title) ? "bridge" : "road";
  if (leaves.has("construction.irrigation") && /ชลประทาน|ฝาย|คลองส่งน้ำ|อ่างเก็บน้ำ|ประตูระบายน้ำ/.test(title)) return "irrigation";
  if (leaves.has("construction.building") && /ก่อสร้าง/.test(title)) return "building";
  return null;
}
