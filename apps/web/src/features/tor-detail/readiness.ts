import type { RequiredDocument } from "@tor-radar/shared";
import { certificationsMentioned } from "@tor-radar/seeds";
import type { VaultDocument } from "../../shared/api/vault.api";

/**
 * One required document against what the vendor keeps (TOR-219).
 *
 * - `have`: the TOR names a listed certification and the vault holds a certificate the vendor marked as that one.
 * - `missing`: the same, and the vault has none.
 * - `manual`: the TOR names no listed certification, so there is nothing to match on. The document's name is
 *   free text; guessing from it would call a file "there" or "missing" on a coincidence of words, so the
 *   vendor is told to check it themselves. So is a name that mentions more than one listed certification:
 *   extraction tags only the first, and "ISO 9001 and ISO 14001" (both needed) and "ISO 9001 or ISO 14001"
 *   (either will do) cannot be told apart here. Read from the name, not the tag, so records extracted
 *   before this check, which carry just the first tag, are covered too.
 */
export type Readiness =
  | { status: "have"; document: RequiredDocument; file: VaultDocument }
  | { status: "missing"; document: RequiredDocument }
  | { status: "manual"; document: RequiredDocument };

export function readinessOf(required: RequiredDocument[], vault: readonly VaultDocument[]): Readiness[] {
  return required.map((document) => {
    if (!document.certification || certificationsMentioned(document.name).length > 1) return { status: "manual", document };
    const file = vault.find((item) => item.kind === "certificate" && item.certificationId === document.certification);
    return file ? { status: "have", document, file } : { status: "missing", document };
  });
}
