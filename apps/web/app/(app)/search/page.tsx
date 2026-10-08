import type { Metadata } from "next";
import {
  fetchTorFacets,
  searchQueryMaxChars,
  searchOwnTors,
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
import { fetchOwnMatchScores } from "../../../src/shared/api/matches.api";

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
    filters.minMatch === null && filters.maxMatch === null ? searchTors(toSearchQuery(filters)) : searchOwnTors(toSearchQuery(filters)),
  ]);
  const [savedIds, matchScores] =
    results.status === "fulfilled"
      ? await Promise.all([
          fetchOwnBookmarkIds(results.value.items.map((item) => item.id)),
          fetchOwnMatchScores(),
        ])
      : [new Set<string>(), new Map<string, number>()];

  // The badge slot already existed on every row (ตรงกับคุณ N%); it was simply
  // never filled. A row that is not one of this vendor's matches carries no
  // score at all, rather than a zero — no match is not a bad match.
  const scoredResults: TorSearchResult | null =
    results.status === "fulfilled"
      ? {
          ...results.value,
          items: results.value.items.map((item) =>
            matchScores.has(item.id) ? { ...item, matchScore: matchScores.get(item.id) } : item,
          ),
        }
      : null;

  if (results.status === "rejected") {
    console.error("tor_search_failed", { reason: String(results.reason) });
  }

  const emptyFacets: TorFacets = { agencies: [], categories: [], budget: null };

  return (
    <SearchView
      filters={filters}
      facets={facets.status === "fulfilled" ? facets.value : emptyFacets}
      results={scoredResults}
      queryMaxChars={searchQueryMaxChars()}
      savedIds={[...savedIds]}
    />
  );
}
