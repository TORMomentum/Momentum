import { Router } from "express";
import type { WithId } from "mongodb";
import { z } from "zod";
import type { Config } from "../../core/config.js";
import type { TorDocument } from "../../core/db.js";
import { UnauthorizedError } from "../../core/errors.js";
import { ProfileRepository } from "../profile/profile.repository.js";
import { isOpenOn } from "../tors/tors.service.js";
import { scoreMatch } from "./match-scorer.js";
import { MatchingRepository } from "./matching.repository.js";
import { scoresForAccount } from "./matching.scores.js";

const querySchema = z.object({ page: z.coerce.number().int().nonnegative().default(0) }).strict();

type Shown<T> = { raw: string; value: T | null; verified: boolean };

function shown<T>(field: { raw?: string; value?: unknown; verified?: boolean } | undefined, isValue: (value: unknown) => value is T): Shown<T> {
  const value = field?.value;
  return { raw: field?.raw ?? "", value: isValue(value) ? value : null, verified: Boolean(field?.verified) };
}
const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";

/**
 * Only a record a vendor could still bid on is worth showing: published, not
 * taken down, and open by the same rule search uses — so a match never
 * contradicts the "เปิดรับข้อเสนอ" badge on the same TOR. Like search, a
 * project is listed once: its invitation to bid and any duplicate are not rows
 * of their own.
 */
function biddable(record: WithId<TorDocument>, today: string): boolean {
  return (
    record.pipeline.state === "published" &&
    !record.access.restricted &&
    record.documentType !== "invitation" &&
    !record.duplicateOf &&
    isOpenOn(
      {
        torStatus: { value: isString(record.fields.torStatus?.value) ? record.fields.torStatus.value : null },
        deadline: { value: isString(record.fields.deadline?.value) ? record.fields.deadline.value : null },
      },
      today,
    )
  );
}

export function buildMatchingRouter(deps: { config: Config; profiles: ProfileRepository; matching: MatchingRepository }): Router {
  const router = Router();
  router.get("/me/matches", async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const profile = await deps.profiles.findByAccountId(req.auth.account._id.toString());
    if (!profile?.categories.length) {
      res.json({ items: [], reason: "กรุณาเลือกหมวดหมู่งานเพื่อดูรายการที่เกี่ยวข้อง" });
      return;
    }
    const { page } = querySchema.parse(req.query);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: deps.config.search.timeZone });
    const scored = (await deps.matching.candidatesFor(profile))
      .filter(({ record }) => biddable(record, today))
      .map(({ record, classification }) => ({
        id: record._id.toString(),
        title: record.fields.title?.raw ?? "",
        // What a card needs to be read without opening the TOR. Values are as
        // extracted; `verified` lets the screen mark what is not confirmed yet.
        agency: record.fields.agency?.raw ?? "",
        budget: shown(record.fields.budget, isNumber),
        deadline: { ...shown(record.fields.deadline, isString), ...(record.fields.deadline?.fromDocument ? { fromDocument: record.fields.deadline.fromDocument } : {}) },
        unverified: record.unverified,
        ...scoreMatch(profile, record, classification, deps.config, today),
      }))
      .filter((match) => match.excluded === null)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    const start = page * deps.config.matching.pageSize;
    res.json({ items: scored.slice(start, start + deps.config.matching.pageSize), reason: null });
  });
  /**
   * Every current match's score, by TOR id, for marking a page of search
   * results. Search shows twenty rows of the whole corpus, not the vendor's
   * matches in order, so it needs to look scores up rather than page through
   * them. Bounded by the candidate cap, so it stays small.
   */
  router.get("/me/matches/scores", async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    res.json({ scores: await scoresForAccount(deps, req.auth.account._id.toString()) });
  });

  return router;
}
