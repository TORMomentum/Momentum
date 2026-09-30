import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchTor } from "../../../../../src/shared/api/tors.api";
import { originalDocuments } from "../../../../../src/features/tor-detail/original-documents";
import { TorOriginalView } from "../../../../../src/views/TorOriginalView";

const OBJECT_ID = /^[0-9a-f]{24}$/i;

export const metadata: Metadata = {
  title: "เอกสารต้นฉบับ",
  // The original is the agency's own publication; the record page is what to index.
  robots: { index: false, follow: true },
};

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

  const documents = originalDocuments(tor);
  const wantsInvitation = (await searchParams).doc === "invitation";
  const active = wantsInvitation && documents.some((document) => document.key === "invitation") ? "invitation" : "tor";

  return <TorOriginalView tor={tor} documents={documents} active={active} />;
}
