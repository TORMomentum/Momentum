import type { Config } from "../../core/config.js";
import type { SourceHealthDocument } from "../../core/db.js";
import { logger } from "../../core/logger.js";
import type { Mailer } from "../../ports/mailer.port.js";
import type { RunOutcome, SourceHealthRepository } from "./source-health.repository.js";
import { renderSourceAlert } from "./source-alert.template.js";
import { SOURCES, type SourceDefinition } from "./sources.registry.js";

export type SourceStatus = "ok" | "failing" | "stale" | "never";

/** A failure message is kept this long at most: enough to read, never a page of a source's HTML. */
export const ERROR_MAX_CHARS = 300;

export interface SourceView {
  id: string;
  name: string;
  kind: SourceDefinition["kind"];
  status: SourceStatus;
  lastSeenAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastRun: { at: Date; items: number; failed: number } | null;
  records: number;
  latestRecordAt: Date | null;
  alertSentAt: Date | null;
}

/**
 * A source's health (spec 2026-11-24-source-health decision 5). Automatic: failing after `alertFailures`
 * failed runs in a row, stale when not seen for `staleMs`. Manual: failing when its last run failed, never
 * stale. No record at all: never run.
 */
export function healthOf(
  source: Pick<SourceDefinition, "kind">,
  record: Pick<SourceHealthDocument, "lastSeenAt" | "consecutiveFailures"> | null,
  now: Date,
  settings: Config["sources"],
): SourceStatus {
  if (!record) return "never";
  if (source.kind === "manual") return record.consecutiveFailures > 0 ? "failing" : "ok";
  if (record.consecutiveFailures >= settings.alertFailures) return "failing";
  if (!record.lastSeenAt || now.getTime() - record.lastSeenAt.getTime() > settings.staleMs) return "stale";
  return "ok";
}

/** Ingestion-source health (TOR-87): what each source reports, the admin view of it, and the admin alert. */
export class SourceHealthService {
  /** `mailer` is left out by the API, which reads health and never alerts. */
  constructor(private readonly deps: { repo: SourceHealthRepository; config: Config; mailer?: Mailer }) {}

  async recordRun(id: string, outcome: RunOutcome, at = new Date()): Promise<void> {
    const error = outcome.ok ? null : (outcome.error ?? "unknown").slice(0, ERROR_MAX_CHARS);
    await this.deps.repo.recordRun(id, { ...outcome, error }, at);
  }

  async heartbeat(id: string, at = new Date()): Promise<void> {
    await this.deps.repo.heartbeat(id, at);
  }

  async overview(now = new Date()): Promise<{ checkedAt: Date; settings: { alertFailures: number; staleHours: number }; sources: SourceView[] }> {
    const settings = this.deps.config.sources;
    const byId = new Map((await this.deps.repo.all()).map((record) => [record._id, record]));
    const sources = await Promise.all(
      SOURCES.map(async (source): Promise<SourceView> => {
        const record = byId.get(source.id) ?? null;
        const { records, latestRecordAt } = await this.deps.repo.recordsOf(source);
        return {
          id: source.id,
          name: source.name,
          kind: source.kind,
          status: healthOf(source, record, now, settings),
          lastSeenAt: record?.lastSeenAt ?? null,
          lastSuccessAt: record?.lastSuccessAt ?? null,
          lastFailureAt: record?.lastFailureAt ?? null,
          lastError: record?.lastError ?? null,
          consecutiveFailures: record?.consecutiveFailures ?? 0,
          lastRun: record?.lastRun ?? null,
          records,
          latestRecordAt,
          alertSentAt: record?.alert?.sentAt ?? null,
        };
      }),
    );
    return { checkedAt: now, settings: { alertFailures: settings.alertFailures, staleHours: settings.staleMs / 3_600_000 }, sources };
  }

  /**
   * Emails the admins once when an automatic source becomes failing or stale, and once when it is ok again
   * (decision 7). A source that never ran is not alerted (decision 9).
   */
  async checkSources(now = new Date()): Promise<{ alerted: number; recovered: number }> {
    const { repo, config } = this.deps;
    const byId = new Map((await repo.all()).map((record) => [record._id, record]));
    let alerted = 0;
    let recovered = 0;
    for (const source of SOURCES) {
      if (source.kind !== "automatic") continue;
      const record = byId.get(source.id);
      if (!record) continue;
      const status = healthOf(source, record, now, config.sources);
      if ((status === "failing" || status === "stale") && !record.alert) {
        if (!await repo.claimAlert(source.id, status, now)) continue;
        await this.tell(source, record, status, now);
        alerted += 1;
      } else if (status === "ok" && record.alert) {
        if (!await repo.clearAlert(source.id, now)) continue;
        await this.tell(source, record, "recovered", now);
        recovered += 1;
      }
    }
    if (alerted || recovered) logger.info("source_check", { alerted, recovered });
    return { alerted, recovered };
  }

  private async tell(source: SourceDefinition, record: SourceHealthDocument, event: "failing" | "stale" | "recovered", now: Date): Promise<void> {
    const { repo, config, mailer } = this.deps;
    const recipients = await repo.adminEmails();
    // Claimed regardless, so an empty admin list is logged once, not retried every check.
    if (!mailer || recipients.length === 0) {
      logger.warn("source_alert_no_recipients", { source: source.id, event });
      return;
    }
    const email = renderSourceAlert({
      source: source.name,
      event,
      record,
      settings: { alertFailures: config.sources.alertFailures, staleHours: config.sources.staleMs / 3_600_000 },
      pageUrl: new URL("/admin/sources", config.appOrigin).toString(),
      timeZone: config.search.timeZone,
      now,
    });
    for (const to of recipients) {
      try {
        await mailer.send({ to, ...email });
      } catch (error) {
        // One unreachable admin must not keep the rest from hearing.
        logger.error("source_alert_send_failed", { source: source.id, event, error: error instanceof Error ? error.message : "unknown" });
      }
    }
    // Recipient addresses are deliberately never logged.
    logger.info("source_alert_sent", { source: source.id, event, recipients: recipients.length });
  }
}
