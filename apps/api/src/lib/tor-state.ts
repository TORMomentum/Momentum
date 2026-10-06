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

export function torStateOf(
  record: { torStatus: TorStatus | null; deadline: string | null },
  today: string,
): TorState {
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
      return { "fields.torStatus.value": "announced", "fields.deadline.value": { $gte: today } };
    case "awaiting-invitation":
      // The scope is published; the invitation that carries the deadline is not.
      return { "fields.torStatus.value": "announced", "fields.deadline.value": null };
    case "awarded":
    case "cancelled":
      return { "fields.torStatus.value": state };
    case "closed":
      // Anything not announced, awarded or cancelled, plus an announcement whose
      // deadline has passed. A missing deadline is NOT closed — it is awaiting.
      return {
        $or: [
          { "fields.torStatus.value": { $nin: ["announced", "awarded", "cancelled"] } },
          { "fields.torStatus.value": "announced", "fields.deadline.value": { $ne: null, $lt: today } },
        ],
      };
  }
}
