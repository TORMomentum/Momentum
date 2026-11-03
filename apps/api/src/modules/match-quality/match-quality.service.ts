import { createHash } from "node:crypto";
import type { Config } from "../../core/config.js";
import type { MatchLabelDocument } from "../../core/db.js";
import { BadRequestError } from "../../core/errors.js";
import { calendarDate } from "../../lib/calendar-date.js";
import { scoreMatch } from "../matching/match-scorer.js";
import type { MatchingRepository } from "../matching/matching.repository.js";
import { emailThreshold } from "../notifications/notify.service.js";
import type { ProfileRepository } from "../profile/profile.repository.js";
import { DEFAULT_NOTIFY } from "../profile/profile.routes.js";
import type { MatchLabelsRepository } from "./match-labels.repository.js";

export type Label = MatchLabelDocument["label"];

export interface WorksheetItem {
  torId: string;
  title: string;
  agency: string;
  score: number;
  /** Whether the vendor's email threshold would have sent it. */
  matched: boolean;
  reasons: string[];
  label: Label | null;
}

/**
 * The labelled benchmark design §7.8 requires before match emails ship.
 *
 * For one vendor it lays out the TORs to judge: their top matches, which test
 * precision ("are these right?"), and a sample of their categories' TORs that
 * did not make the cut, which tests recall ("did we miss any?"). The sample is
 * fixed per vendor (ordered by a hash, not at random), so a page reload does
 * not reshuffle what a labeller is half way through.
 */
export class MatchQualityService {
  constructor(
    private readonly deps: { config: Config; profiles: ProfileRepository; matching: MatchingRepository; labels: MatchLabelsRepository },
  ) {}

  private async scored(accountId: string) {
    const profile = await this.deps.profiles.findByAccountId(accountId);
    if (!profile || profile.categories.length === 0) {
      throw new BadRequestError("ผู้ใช้นี้ยังไม่ได้เลือกหมวดหมู่งาน — ยังไม่มีอะไรให้ตรวจ");
    }
    const threshold = emailThreshold(profile.notify ?? DEFAULT_NOTIFY, this.deps.config);
    const today = calendarDate(new Date(), this.deps.config.search.timeZone);
    const rows: Array<Omit<WorksheetItem, "label">> = [];
    for (const { record, classification } of await this.deps.matching.candidatesFor(profile)) {
      const result = scoreMatch(profile, record, classification, this.deps.config, today);
      if (result.excluded !== null) continue;
      rows.push({
        torId: record._id.toString(),
        title: String(record.fields.title?.value ?? record.fields.title?.raw ?? ""),
        agency: String(record.fields.agency?.raw ?? ""),
        score: result.score,
        // The same comparison the email sender makes.
        matched: result.score * 100 >= threshold,
        reasons: result.reasons.map((reason) => reason.th),
      });
    }
    return rows;
  }

  async worksheet(accountId: string): Promise<{ items: WorksheetItem[] }> {
    const [rows, labels] = await Promise.all([this.scored(accountId), this.deps.labels.forAccount(accountId)]);
    const order = (torId: string) => createHash("sha1").update(`${accountId}:${torId}`).digest("hex");
    const matched = rows
      .filter((row) => row.matched)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.deps.config.matching.labelMatchedShown);
    const unmatched = rows
      .filter((row) => !row.matched)
      .sort((a, b) => order(a.torId).localeCompare(order(b.torId)))
      .slice(0, this.deps.config.matching.labelUnmatchedShown);
    return { items: [...matched, ...unmatched].map((row) => ({ ...row, label: labels.get(row.torId) ?? null })) };
  }

  /** Records a judgement, freezing the pair's current score and match decision with it. */
  async label(accountId: string, torId: string, label: Label, labelledBy: string): Promise<void> {
    const row = (await this.scored(accountId)).find((item) => item.torId === torId);
    if (!row) throw new BadRequestError("TOR นี้ไม่อยู่ในรายการของผู้ใช้นี้แล้ว — โหลดหน้าใหม่");
    await this.deps.labels.save({ accountId, torId, label, score: row.score, matched: row.matched, labelledBy });
  }

  /**
   * Precision: of what email would send, how much a person judged relevant.
   * Recall: of what a person judged relevant, how much email would send —
   * estimated from the labelled sample, so it is only as good as the sample.
   * "Unsure" is reported, never counted for or against.
   */
  async figures() {
    const tally = await this.deps.labels.tally();
    const n = (matched: boolean, label: Label) => tally.find((row) => row.matched === matched && row.label === label)?.n ?? 0;
    const truePositive = n(true, "relevant");
    const falsePositive = n(true, "not-relevant");
    const falseNegative = n(false, "relevant");
    const unsure = n(true, "unsure") + n(false, "unsure");
    const total = tally.reduce((sum, row) => sum + row.n, 0);
    const ratio = (part: number, whole: number) => (whole === 0 ? null : part / whole);
    return {
      labelled: total,
      vendors: await this.deps.labels.vendorsLabelled(),
      precision: ratio(truePositive, truePositive + falsePositive),
      precisionOf: truePositive + falsePositive,
      recall: ratio(truePositive, truePositive + falseNegative),
      recallOf: truePositive + falseNegative,
      unsureRate: ratio(unsure, total),
    };
  }
}
