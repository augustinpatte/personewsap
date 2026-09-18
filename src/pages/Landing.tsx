import { useEffect } from "react";
import SiteHeader from "@/components/landing/SiteHeader";
import SiteFooter from "@/components/landing/SiteFooter";
import Hero from "@/components/landing/sections/Hero";
import Product from "@/components/landing/sections/Product";
import HowItWorks from "@/components/landing/sections/HowItWorks";
import Topics from "@/components/landing/sections/Topics";
import Personalization from "@/components/landing/sections/Personalization";
import Engage from "@/components/landing/sections/Engage";
import Mission from "@/components/landing/sections/Mission";
import ComingSoon from "@/components/landing/sections/ComingSoon";
import { useLandingCopy } from "@/landing/useLandingCopy";
import { useReveal } from "@/landing/useReveal";

/**
 * The public home page: PersoNewsAP as a mobile app, coming soon on iOS and
 * Android. One page, anchor navigation, the product doing most of the talking.
 */
const Landing = () => {
  const { copy } = useLandingCopy();
  useReveal();

  useEffect(() => {
    document.title = copy.meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", copy.meta.description);
  }, [copy]);

  return (
    <div id="top" className="min-h-screen overflow-x-clip bg-pn-paper font-sans text-pn-ink antialiased">
      <a
        href="#main"
        className="pn-focus sr-only z-[60] rounded-full bg-pn-ink px-4 py-2 text-sm font-semibold text-pn-paper focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        {copy.a11y.skip}
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="focus:outline-none">
        <Hero />
        <Product />
        <HowItWorks />
        <Topics />
        <Personalization />
        <Engage />
        <Mission />
        <ComingSoon />
      </main>
      <SiteFooter />
    </div>
  );
};

export default Landing;
