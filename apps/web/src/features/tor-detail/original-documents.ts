import type { TorDetail } from "../../shared/api/tors.api";
import type { OriginalDocument } from "./OriginalPreview";

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** The proxy route that streams a stored original (spec §5.1 — the only path to it). */
function documentHref(id: string, disposition: "inline" | "attachment"): string {
  return `/tors/${encodeURIComponent(id)}/document?disposition=${disposition}`;
}

/**
 * The originals a reader can open for one TOR: its own document, the
 * project's invitation to bid when the deadline was read from one, and its
 * winner announcement when one was read (TOR-221). Each id comes from the
 * record, never from the URL, so no viewer can be pointed at an arbitrary
 * stored file.
 */
export function originalDocuments(tor: TorDetail): OriginalDocument[] {
  const id = encodeURIComponent(tor.id);
  const documents: OriginalDocument[] = [
    {
      key: "tor",
      label: "ร่างขอบเขตของงาน (TOR)",
      href: `/tors/${id}/original`,
      inlineUrl: documentHref(tor.id, "inline"),
      downloadUrl: documentHref(tor.id, "attachment"),
      contentHash: tor.contentHash,
      contentType: tor.contentType,
    },
  ];

  const invitationId = tor.fields.deadline?.fromDocument;
  if (typeof invitationId === "string" && OBJECT_ID.test(invitationId)) {
    documents.push({
      key: "invitation",
      label: "ประกาศเชิญชวน",
      href: `/tors/${id}/original?doc=invitation`,
      inlineUrl: documentHref(invitationId, "inline"),
      downloadUrl: documentHref(invitationId, "attachment"),
      contentHash: null,
      contentType: null,
    });
  }

  const awardId = tor.award?.recordId;
  if (typeof awardId === "string" && OBJECT_ID.test(awardId)) {
    documents.push({
      key: "award",
      label: "ประกาศผู้ชนะการเสนอราคา",
      href: `/tors/${id}/original?doc=award`,
      inlineUrl: documentHref(awardId, "inline"),
      downloadUrl: documentHref(awardId, "attachment"),
      contentHash: null,
      contentType: null,
    });
  }
  return documents;
}
