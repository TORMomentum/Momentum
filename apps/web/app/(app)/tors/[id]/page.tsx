import { notFound } from "next/navigation";
import { getTorBySlug } from "../../../../src/data/tor-samples";
import { fetchTorDocumentUrl } from "../../../../src/shared/api/tors.api";
import { TorDetailView } from "../../../../src/views/TorDetailView";

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * This segment deliberately has NO loading.tsx.
 *
 * A loading file wraps the segment in a Suspense boundary, which makes the
 * shell flush before the page has decided anything. `notFound()` after that
 * point renders the right screen with an HTTP 200 — measured: with a loading
 * file present an unknown record answered 200, without it 404.
 *
 * This is a public page that crawlers index, and a wrong status is worse than
 * a missing skeleton. The page's own work is one signed-URL call.
 */

export default async function TorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tor = getTorBySlug(id);

  // Resolve existence before any document request can suspend and start
  // streaming. Calling notFound() after streaming begins would show the right
  // UI with an HTTP 200 response, which is wrong for crawlers.
  if (!tor) notFound();

  let documentUrl: string | null = null;

  if (OBJECT_ID.test(id)) {
    try {
      documentUrl = await fetchTorDocumentUrl(id);
    } catch (error) {
      console.error("tor_document_url_fetch_failed", { id, error });
    }
  }

  return <TorDetailView tor={tor} documentUrl={documentUrl} />;
}
