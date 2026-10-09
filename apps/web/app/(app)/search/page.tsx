import type { Metadata } from "next";
import {
  fetchTorFacets,
  searchQueryMaxChars,
  searchTors,
  type TorFacets,
  type TorSearchResult,
} from "../../../src/shared/api/tors.api";
import {
  parseSearchParams,
  toSearchQuery,
  type RawSearchParams,
} from "../../../src/features/search/search.params";
import { SearchView } from "../../../src/views/SearchView";
import { fetchOwnBookmarkIds } from "../../../src/shared/api/bookmarks.api";

export const metadata: Metadata = {
  title: "ค้นหา TOR",
  // Filter permutations are not pages to index (rendering spec §10).
  robots: { index: false, follow: true },
};

/**
 * Search (FR-E-3). Rendered on the server from the URL, uncached (rendering
 * spec §6.1): the filters live in `searchParams`, so a result is linkable and
 * the back button works. The view is a client component only for its controls.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const filters = parseSearchParams(await searchParams);

  // Parallel: the options and the results do not depend on each other.
  const [facets, results] = await Promise.allSettled([
    fetchTorFacets(),
    searchTors(toSearchQuery(filters)),
  ]);
  const savedIds = results.status === "fulfilled" ? await fetchOwnBookmarkIds(results.value.items.map((item) => item.id)) : new Set<string>();

  if (results.status === "rejected") {
    console.error("tor_search_failed", { reason: String(results.reason) });
  }

  const emptyFacets: TorFacets = { agencies: [], categories: [], budget: null };

  return (
    <SearchView
      filters={filters}
      facets={facets.status === "fulfilled" ? facets.value : emptyFacets}
      results={results.status === "fulfilled" ? (results.value as TorSearchResult) : null}
      queryMaxChars={searchQueryMaxChars()}
      savedIds={[...savedIds]}
    />
  );
}
