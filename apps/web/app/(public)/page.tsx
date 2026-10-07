import { fetchDashboard } from "../../src/shared/api/stats.api";
import type { LandingFigures } from "../../src/features/landing/landing.figures";
import { LandingView } from "../../src/views/LandingView";

// Figures come from a live API call (FR-E-1), so this page cannot be prerendered once at
// build time — a Cloud Run image built without API_BASE_URL would otherwise bake in
// whatever the build-time fetch returned (TOR-140), permanently, until the next build.
export const dynamic = "force-dynamic";

/**
 * The public homepage. Its headline figures come from the dashboard API, so
 * the homepage and the dashboard always show the same corpus. A failed load
 * renders the page without figures rather than with plausible placeholders.
 */
export default async function HomePage() {
  let figures: LandingFigures | null = null;
  try {
    const dashboard = await fetchDashboard({});
    figures = {
      torCount: dashboard.totals.torCount,
      budgetSum: dashboard.totals.budgetSum,
      agencyCount: dashboard.totals.agencyCount,
      anomalyCount: dashboard.flagged.count,
      lastIntakeAt: dashboard.meta.lastIntakeAt,
    };
  } catch (error) {
    console.error("[home] figures unavailable", error);
  }
  return <LandingView figures={figures} />;
}
