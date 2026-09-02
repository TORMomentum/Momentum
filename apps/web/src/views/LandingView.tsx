import { SampleDataNotice, SiteFooter, SiteNav } from "../features/landing/SiteChrome";
import { Hero, Marquee, Stats } from "../features/landing/HeroBlock";
import {
  AnomalyPlot,
  Closing,
  HowItWorks,
  QualityChecklist,
} from "../features/landing/ProofSections";

/** The public landing page, composed from the landing feature's sections. */
export function LandingView() {
  return (
    <>
      <SiteNav />
      <SampleDataNotice />
      <Hero />
      <Marquee />
      <Stats />
      <HowItWorks />
      <AnomalyPlot />
      <QualityChecklist />
      <Closing />
      <SiteFooter />
    </>
  );
}
