import { notFound } from "next/navigation";
import { getTorBySlug } from "../../../../src/data/tor-samples";
import { fetchTor, type TorDetail } from "../../../../src/shared/api/tors.api";
import { TorDetailView } from "../../../../src/views/TorDetailView";
import { originalDocuments } from "../../../../src/features/tor-detail/original-documents";
import { TorRecordView } from "../../../../src/views/TorRecordView";
import { fetchOwnBookmarkIds } from "../../../../src/shared/api/bookmarks.api";

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
 * a missing skeleton.
 *
 * A record id renders the published record from the API; any other id is one
 * of the ported sample TORs.
 */

export default async function TorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (OBJECT_ID.test(id)) {
    // Resolve existence before anything can stream: an unknown or taken-down
    // record must answer 404, not a 404 screen with a 200.
    const tor: TorDetail | null = await fetchTor(id);
    if (!tor) notFound();

    // Originals open in a preview over the page, streamed through the proxy
    // route (object storage spec §5). The deadline may come from the project's
    // invitation to bid; the reader gets that original too, not only this
    // TOR's (NFR-F6).
    const savedIds = await fetchOwnBookmarkIds([tor.id]);
    return <TorRecordView tor={tor} originals={originalDocuments(tor)} bookmarked={savedIds.has(tor.id)} />;
  }

  const sample = getTorBySlug(id);
  if (!sample) notFound();

  // Sample records have no stored original to stream.
  return <TorDetailView tor={sample} documentHref={null} />;
}
