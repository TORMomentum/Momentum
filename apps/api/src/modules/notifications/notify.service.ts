import { randomUUID } from "node:crypto";
import type { Db, WithId } from "mongodb";
import type { Config } from "../../core/config.js";
import type { TorDocument } from "../../core/db.js";
import type { Mailer } from "../../ports/mailer.port.js";
import { calendarDate } from "../../lib/calendar-date.js";
import { scoreMatch } from "../matching/match-scorer.js";
import { MatchingRepository } from "../matching/matching.repository.js";
import { renderMatchEmail, type MatchedTor } from "./match-email.template.js";
import { NotifyRepository, type EligibleVendor } from "./notify.repository.js";
import { DEFAULT_NOTIFY } from "../profile/profile.routes.js";
import { BadRequestError } from "../../core/errors.js";

type Pending = { tor: WithId<TorDocument>; score: number; reasons: string[]; reason: "match" | "deadline-reminder" };
export type NotifyRunResult = { leased: boolean; vendors: number; claimed: number; sent: number; dryRun: boolean };

function dateAtBangkokNoon(value: string): Date { return new Date(`${value}T12:00:00+07:00`); }

function dailyPeriod(now: Date, timezone: string, boundary: string): string {
  const date = calendarDate(now, timezone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  if (time < boundary) {
    const prior = new Date(`${date}T12:00:00Z`); prior.setUTCDate(prior.getUTCDate() - 1);
    return prior.toISOString().slice(0, 10);
  }
  return date;
}

function open(record: TorDocument, today: string): boolean {
  const deadline = record.fields.deadline?.value;
  return !record.access.restricted && record.fields.torStatus?.value === "announced" && (typeof deadline !== "string" || deadline >= today);
}

function emailTor(tor: WithId<TorDocument>, score: number, reasons: string[], config: Config): MatchedTor {
  const deadline = tor.fields.deadline?.value;
  return {
    reference: tor.fields.referenceNo?.raw ?? tor._id.toString(),
    title: tor.fields.title?.raw ?? "",
    agency: tor.fields.agency?.raw ?? "",
    budgetThb: typeof tor.fields.budget?.value === "number" ? tor.fields.budget.value : null,
    deadline: typeof deadline === "string" ? dateAtBangkokNoon(deadline) : null,
    matchPercent: Math.round(score * 100),
    reasons,
    url: new URL(`/tors/${tor._id.toString()}`, config.appOrigin).toString(),
  };
}

/** Scores through the established matcher, claims each send atomically, then calls the Mailer port. */
export class NotifyService {
  private readonly repository: NotifyRepository;
  private readonly matching: MatchingRepository;

  constructor(private readonly db: Db, private readonly config: Config, private readonly mailer: Mailer, private readonly now: () => Date = () => new Date()) {
    this.repository = new NotifyRepository(db);
    this.matching = new MatchingRepository(db, config);
  }

  async dispatch(): Promise<NotifyRunResult> {
    const owner = randomUUID();
    if (!await this.repository.claimLease(owner, this.config.notifications.dispatchLeaseMs)) return { leased: false, vendors: 0, claimed: 0, sent: 0, dryRun: !this.config.notifications.dispatchEnabled };
    try {
      const vendors = await this.repository.eligibleVendors(this.config.notifications.batchSize);
      let claimed = 0; let sent = 0;
      for (const vendor of vendors) {
        const outcome = await this.dispatchVendor(vendor);
        claimed += outcome.claimed; sent += outcome.sent;
        // Recipient address and message body are deliberately never logged.
        console.log(JSON.stringify({ event: "notify_vendor_dispatched", accountId: vendor.account._id.toString(), claimed: outcome.claimed, sent: outcome.sent, dryRun: !this.config.notifications.dispatchEnabled }));
      }
      return { leased: true, vendors: vendors.length, claimed, sent, dryRun: !this.config.notifications.dispatchEnabled };
    } finally { await this.repository.releaseLease(owner); }
  }

  /** The vendor's own bar: "high" never drops below the configured floor. */
  private thresholdFor(notify: NonNullable<EligibleVendor["profile"]["notify"]>): number {
    return notify.preset === "high" ? Math.max(notify.minMatch, this.config.notifications.highMinMatch) : notify.minMatch;
  }

  /** Open TORs this vendor matches at or above `threshold`. Shared by both senders, so they cannot disagree. */
  private async currentMatches(vendor: EligibleVendor, threshold: number, today: string): Promise<Pending[]> {
    const found: Pending[] = [];
    for (const candidate of await this.matching.candidatesFor(vendor.profile)) {
      const result = scoreMatch(vendor.profile, candidate.record, candidate.classification, this.config, today);
      if (result.excluded === null && open(candidate.record, today) && result.score * 100 >= threshold) {
        found.push({ tor: candidate.record, score: result.score, reasons: result.reasons.map((reason) => reason.th), reason: "match" });
      }
    }
    return found;
  }

  /**
   * An admin's "send this vendor their matches now": one email, best first,
   * capped at manualEmailMaxTors. A person chose to send it, so it does not
   * wait for NOTIFY_DISPATCH_ENABLED — that switch governs automatic sending.
   * It still honours what the vendor chose: email off means no email, from an
   * admin as much as from the worker. It claims nothing, so it never stops
   * the automatic digest from including the same TORs later.
   */
  async sendMatchesNow(accountId: string): Promise<{ sent: number }> {
    const vendor = await this.repository.eligibleVendor(accountId);
    if (!vendor) throw new BadRequestError("ส่งได้เฉพาะบัญชีที่ยืนยันอีเมลแล้ว ยังใช้งานอยู่ และตั้งค่าโปรไฟล์แล้ว");
    const notify = vendor.profile.notify ?? DEFAULT_NOTIFY;
    if (notify.preset === "off") throw new BadRequestError("ผู้ใช้ปิดการแจ้งเตือนทางอีเมลไว้ — ส่งให้ไม่ได้");
    const now = this.now();
    const threshold = this.thresholdFor(notify);
    const matches = (await this.currentMatches(vendor, threshold, calendarDate(now, this.config.search.timeZone)))
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.matching.manualEmailMaxTors);
    if (matches.length === 0) return { sent: 0 };
    const email = renderMatchEmail({
      vendorName: vendor.account.displayName ?? "",
      minMatchPercent: threshold,
      tors: matches.map((item) => emailTor(item.tor, item.score, item.reasons, this.config)),
      settingsUrl: new URL("/profile", this.config.appOrigin).toString(),
      unsubscribeUrl: new URL("/profile", this.config.appOrigin).toString(),
      now,
    });
    await this.mailer.send({ to: vendor.account.email, ...email });
    return { sent: matches.length };
  }

  private async dispatchVendor(vendor: EligibleVendor): Promise<{ claimed: number; sent: number }> {
    const now = this.now(); const today = calendarDate(now, this.config.search.timeZone);
    const accountId = vendor.account._id.toString();
    const pending: Pending[] = [];
    // A profile saved before email preferences existed has no `notify` at all.
    // Its owner's profile page shows the default as chosen, so the worker uses
    // that same default — not "never email", which is what absent used to mean.
    const notify = vendor.profile.notify ?? DEFAULT_NOTIFY;
    // "off" is the vendor saying no email of any kind, reminders included.
    if (notify.preset === "off") return { claimed: 0, sent: 0 };
    const threshold = this.thresholdFor(notify);
    pending.push(...await this.currentMatches(vendor, threshold, today));
    if (notify.deadlineReminder) {
      for (const tor of await this.repository.bookmarkedTors(accountId)) {
        const deadline = tor.fields.deadline?.value;
        if (open(tor, today) && typeof deadline === "string") {
          const days = Math.floor((dateAtBangkokNoon(deadline).getTime() - dateAtBangkokNoon(today).getTime()) / 86_400_000);
          if (days >= 0 && days <= notify.leadDays) pending.push({ tor, score: 0, reasons: ["ใกล้ถึงกำหนดยื่นข้อเสนอ"], reason: "deadline-reminder" });
        }
      }
    }
    const dryRun = !this.config.notifications.dispatchEnabled;
    const period = dailyPeriod(now, this.config.search.timeZone, this.config.notifications.dailyBoundary);
    const matchOnly = pending.filter((item) => item.reason === "match");
    const reminders = pending.filter((item) => item.reason === "deadline-reminder");
    // A separate period marker prevents a second digest if a new TOR arrives
    // later in the same civil day. It is not a TOR notification and therefore
    // uses a synthetic key distinct from every real TOR id.
    const daily = notify.preset === "daily";
    const mayDigest = !daily || (matchOnly.length > 0 && await this.repository.claim({ accountId, torId: `digest:${period}`, reason: "daily-digest", dryRun, period, createdAt: now }));
    const selected = daily ? [...(mayDigest ? matchOnly : []), ...reminders] : pending;
    const claimed = [] as Pending[];
    for (const item of selected) if (await this.repository.claim({ accountId, torId: item.tor._id.toString(), reason: item.reason, dryRun, ...(notify.preset === "daily" ? { period } : {}), createdAt: now })) claimed.push(item);
    if (!claimed.length || dryRun) return { claimed: claimed.length, sent: 0 };
    // Daily match rows form one digest. Reminders remain actionable individual notices.
    const dailyMatches = claimed.filter((item) => item.reason === "match");
    const claimedReminders = claimed.filter((item) => item.reason === "deadline-reminder");
    const groups = daily
      ? [...(dailyMatches.length ? [dailyMatches] : []), ...claimedReminders.map((item) => [item])]
      : claimed.map((item) => [item]);
    let sent = 0;
    for (const group of groups) {
      const email = renderMatchEmail({ vendorName: vendor.account.displayName ?? "", minMatchPercent: threshold ?? 0, tors: group.map((item) => emailTor(item.tor, item.score, item.reasons, this.config)), settingsUrl: new URL("/profile", this.config.appOrigin).toString(), unsubscribeUrl: new URL("/profile", this.config.appOrigin).toString(), now });
      const response = await this.mailer.send({ to: vendor.account.email, ...email });
      await Promise.all(group.map((item) => this.repository.sent(accountId, item.tor._id.toString(), item.reason, false, response.messageId)));
      if (daily && group === dailyMatches) await this.repository.sent(accountId, `digest:${period}`, "daily-digest", false, response.messageId);
      sent += group.length;
    }
    return { claimed: claimed.length, sent };
  }
}
