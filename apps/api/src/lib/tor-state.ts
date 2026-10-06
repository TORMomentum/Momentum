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
