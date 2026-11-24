import { DashboardView } from "../../../src/views/DashboardView";
import { fetchOwnMatches } from "../../../src/shared/api/matches.api";
import { fetchCompetition, fetchDashboard, StatsApiUnavailable } from "../../../src/shared/api/stats.api";
import { parseDashboardFilters } from "../../../src/shared/lib/dashboard-filters";

/**
 * The dashboard's data is fetched here, on the server, and handed down.
 *
 * Filters live in the URL rather than in component state, so a filtered view is
 * shareable and survives a reload, and the figures are computed before the page
 * is sent (rendering spec §2). The view itself holds no fetching.
 *
 * A failed load renders the view's error state instead of falling back to
 * sample figures. Numbers on a transparency dashboard must be real or absent —
 * never plausible-looking placeholders.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseDashboardFilters(await searchParams);
  // A signed-in vendor also sees what may be relevant to them; anyone else sees
  // the public dashboard only (FR-E-1). Fetched alongside, never instead.
  const matches = fetchOwnMatches();
  // Read beside the dashboard but never required by it: if it fails the panel is simply absent.
  const competition = fetchCompetition().catch((error: unknown) => {
    console.error("[dashboard] competition load failed", error);
    return null;
  });
  try {
    const dashboard = await fetchDashboard(filters);
    return <DashboardView dashboard={dashboard} filters={filters} matches={await matches} competition={await competition} />;
  } catch (error) {
    console.error("[dashboard] load failed", error);
    return <DashboardView filters={filters} error={error instanceof StatsApiUnavailable} />;
  }
}
