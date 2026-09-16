import { DashboardView } from "../../../src/views/DashboardView";
import { fetchDashboard, StatsApiUnavailable } from "../../../src/shared/api/stats.api";
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
  try {
    const dashboard = await fetchDashboard(filters);
    return <DashboardView dashboard={dashboard} filters={filters} />;
  } catch (error) {
    console.error("[dashboard] load failed", error);
    return <DashboardView filters={filters} error={error instanceof StatsApiUnavailable} />;
  }
}
