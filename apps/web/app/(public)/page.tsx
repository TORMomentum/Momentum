import { fetchDashboard } from "../../src/shared/api/stats.api";
import type { LandingFigures } from "../../src/features/landing/landing.figures";
import { LandingView } from "../../src/views/LandingView";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * The public homepage. Its headline figures come from the dashboard API, so
 * the homepage and the dashboard always show the same corpus. A failed load
 * renders the page without figures rather than with plausible placeholders.
 */
export default async function HomePage() {
  if ((await cookies()).has("tor-radar-session")) redirect("/dashboard");
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
