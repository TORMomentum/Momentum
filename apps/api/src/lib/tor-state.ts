import { FINAL_STAGE_KINDS, type StageKind } from "@tor-radar/shared";

/** As extracted. Mirrors `TorFields["torStatus"]`'s value in the shared types. */
type TorStatus = "announced" | "closed" | "awarded" | "cancelled";

/**
 * What a reader actually wants to know about a TOR, which is not the same as
 * its extracted status.
 *
 * "announced" alone does not say whether a vendor can act: a TOR whose
 * invitation to bid is not out yet has no deadline to work to, and one whose
 * deadline has passed is no longer open however it is labelled. The five states
 * below are the ones the search results already badge, named once here so the
 * dashboard's counts and the badges beside them can never drift apart.
 */
export type TorState = "open" | "awaiting-invitation" | "closed" | "awarded" | "cancelled";

export const TOR_STATES: readonly TorState[] = ["open", "awaiting-invitation", "closed", "awarded", "cancelled"];

/**
 * The project's stage, when the source states one, decides first if it is final (TOR-205, spec
 * 2026-11-23-project-stages decision 7): the source saying a winner is announced outranks a model's
 * reading of a TOR published before it. A stage that is not final changes nothing.
 */
export function torStateOf(
  record: { torStatus: TorStatus | null; deadline: string | null; stageKind?: StageKind | null },
  today: string,
): TorState {
  if (record.stageKind === "cancelled") return "cancelled";
  if (record.stageKind === "awarded") return "awarded";
  if (record.torStatus === "cancelled") return "cancelled";
  if (record.torStatus === "awarded") return "awarded";
  if (record.torStatus !== "announced") return "closed";
  // Announced with no deadline: the draft scope is published, the invitation to
  // bid is not. Deadlines are ISO strings, so string order is date order.
  if (record.deadline === null) return "awaiting-invitation";
  return record.deadline >= today ? "open" : "closed";
}

/**
 * The same five states as a database predicate, for the paginated list that
 * cannot classify in memory.
 *
 * It lives beside `torStateOf` on purpose: two definitions of one rule drift,
 * and a drift here would mean a TOR counted as open on the dashboard and
 * missing from the open list. `tor-state.db.test.ts` inserts records, runs both,
 * and fails if they ever disagree.
 */
export function stateFilter(state: TorState, today: string): Record<string, unknown> {
  switch (state) {
    case "open":
      return { ...NOT_FINAL, "fields.torStatus.value": "announced", "fields.deadline.value": { $gte: today } };
    case "awaiting-invitation":
      // The scope is published; the invitation that carries the deadline is not.
      return { ...NOT_FINAL, "fields.torStatus.value": "announced", "fields.deadline.value": null };
    case "awarded":
    case "cancelled":
      // The stage says so, or extraction does and no final stage says otherwise.
      return { $or: [{ "stage.kind": state }, { ...NOT_FINAL, "fields.torStatus.value": state }] };
    case "closed":
      // Anything not announced, awarded or cancelled, plus an announcement whose
      // deadline has passed. A missing deadline is NOT closed — it is awaiting.
      return {
        ...NOT_FINAL,
        $or: [
          { "fields.torStatus.value": { $nin: ["announced", "awarded", "cancelled"] } },
          { "fields.torStatus.value": "announced", "fields.deadline.value": { $ne: null, $lt: today } },
        ],
      };
  }
}

/**
 * No final stage. `$nin` also matches a record with no stage at all, which is every record the stages
 * worker has not read and every non-e-GP record.
 */
export const NOT_FINAL = { "stage.kind": { $nin: [...FINAL_STAGE_KINDS] } } as const;

/**
 * Still taking bids on `today`: `open` and `awaiting-invitation` together (announced, the deadline today or
 * later or not yet stated) and no final stage. The list's open filter and its days-left bands start from
 * this rather than writing `fields.torStatus.value: "announced"` by hand.
 */
export function openFilter(today: string): Record<string, unknown> {
  return {
    ...NOT_FINAL,
    "fields.torStatus.value": "announced",
    $or: [{ "fields.deadline.value": null }, { "fields.deadline.value": { $gte: today } }],
  };
}
