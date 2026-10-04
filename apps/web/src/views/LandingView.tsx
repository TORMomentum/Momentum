import { SampleDataNotice, SiteFooter, SiteNav } from "../features/landing/SiteChrome";
import { Hero, Marquee, Stats } from "../features/landing/HeroBlock";
import {
  AnomalyPlot,
  Closing,
  HowItWorks,
  QualityChecklist,
} from "../features/landing/ProofSections";
import type { LandingFigures } from "../features/landing/landing.figures";
import { RadarBackdrop } from "../features/landing/RadarBackdrop";

/**
 * The public landing page, composed from the landing feature's sections. The
 * headline figures are the real corpus's; the plot and checklist further down
 * are labelled illustrations of how the product works.
 */
export function LandingView({ figures }: { figures: LandingFigures | null }) {
  return (
    <>
      <RadarBackdrop />
      <SiteNav />
      {!figures && <SampleDataNotice />}
      <Hero figures={figures} />
      <Marquee figures={figures} />
      <Stats figures={figures} />
      <HowItWorks />
      <AnomalyPlot />
      <QualityChecklist />
      <Closing />
      <SiteFooter />
    </>
  );
}
