import { fetchTorDocumentUrl } from "../../../../src/shared/api/tors.api";
import { TorDetailView } from "../../../../src/views/TorDetailView";

const OBJECT_ID = /^[0-9a-f]{24}$/i;

export default async function TorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let documentUrl: string | null = null;

  if (OBJECT_ID.test(id)) {
    try {
      documentUrl = await fetchTorDocumentUrl(id);
    } catch (error) {
      console.error("tor_document_url_fetch_failed", { id, error });
    }
  }

  return <TorDetailView documentUrl={documentUrl} />;
}
