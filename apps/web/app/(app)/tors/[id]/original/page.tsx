import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchTor } from "../../../../../src/shared/api/tors.api";
import { TorOriginalView, type OriginalDocument } from "../../../../../src/views/TorOriginalView";

const OBJECT_ID = /^[0-9a-f]{24}$/i;

export const metadata: Metadata = {
  title: "เอกสารต้นฉบับ",
  // The original is the agency's own publication; the record page is what to index.
  robots: { index: false, follow: true },
};

/** The proxy route that streams a stored original (spec §5.1 — the only path to it). */
function documentHref(id: string, disposition: "inline" | "attachment"): string {
  return `/tors/${encodeURIComponent(id)}/document?disposition=${disposition}`;
}

/**
 * The in-app viewer for a TOR's stored original — the one place an original is
 * served inline rather than as a download (CLAUDE.md, security baseline).
 *
 * `?doc=invitation` shows the project's invitation to bid instead, but only the
 * one this TOR's deadline was read from: the id comes from the record, never
 * from the URL, so the page cannot be pointed at an arbitrary stored file.
 *
 * Like the record page, this segment has no loading.tsx, so an unknown or
 * taken-down record answers 404 rather than a 404 screen with a 200.
 */
export default async function TorOriginalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!OBJECT_ID.test(id)) notFound();

  const tor = await fetchTor(id);
  if (!tor) notFound();

  const invitationId = tor.fields.deadline?.fromDocument;
  const hasInvitation = typeof invitationId === "string" && OBJECT_ID.test(invitationId);
  const wantsInvitation = (await searchParams).doc === "invitation";

  const documents: OriginalDocument[] = [
    {
      key: "tor",
      label: "ร่างขอบเขตของงาน (TOR)",
      href: `/tors/${encodeURIComponent(id)}/original`,
      inlineUrl: documentHref(id, "inline"),
      downloadUrl: documentHref(id, "attachment"),
      contentHash: tor.contentHash,
      contentType: tor.contentType,
    },
  ];
  if (hasInvitation) {
    documents.push({
      key: "invitation",
      label: "ประกาศเชิญชวน",
      href: `/tors/${encodeURIComponent(id)}/original?doc=invitation`,
      inlineUrl: documentHref(invitationId, "inline"),
      downloadUrl: documentHref(invitationId, "attachment"),
      contentHash: null,
      contentType: null,
    });
  }

  const active = wantsInvitation && hasInvitation ? "invitation" : "tor";

  return <TorOriginalView tor={tor} documents={documents} active={active} />;
}
