import { useLandingCopy } from "@/landing/useLandingCopy";
import { Container, Eyebrow } from "../Section";
import StoreBadges from "../StoreBadges";
import { PhoneFrame } from "../mockups/PhoneFrame";
import { CaseScreen, EditionScreen } from "../mockups/screens";

const Hero = () => {
  const { copy } = useLandingCopy();

  return (
    <section aria-labelledby="hero-title" className="relative overflow-x-clip">
      <Container className="relative grid items-center gap-12 pb-16 pt-10 sm:pt-14 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:pb-24 lg:pt-16">
        <div className="max-w-xl">
          <Eyebrow>{copy.hero.eyebrow}</Eyebrow>
          <h1
            id="hero-title"
            className="mt-4 font-serif text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.025em] text-pn-ink sm:text-[3.6rem] lg:text-[4.1rem]"
          >
            {copy.hero.titleLead}
            {" "}
            <br />
            <span className="text-pn-teal">{copy.hero.titleTail}</span>
          </h1>
          <p className="mt-6 max-w-[34rem] text-[1.1rem] leading-relaxed text-pn-ink-soft sm:text-[1.2rem]">
            {copy.hero.lede}
          </p>

          <div className="mt-8">
            <p className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-pn-ink">
              <span aria-hidden="true" className="inline-flex h-2 w-2 shrink-0 rounded-full bg-pn-gold" />
              {copy.hero.availability}
            </p>
            <StoreBadges />
          </div>
        </div>

        {/* The product, as it looks: the edition in front, a Mini Case behind (from 640px). */}
        <div className="relative mx-auto flex w-full max-w-[34rem] justify-center lg:justify-end">
          <div className="relative text-[12.5px] sm:text-[14px] lg:text-[14.5px]">
            <div className="absolute -left-[9.5em] top-[4.5em] hidden rotate-[-5deg] opacity-95 sm:block">
              <PhoneFrame>
                <CaseScreen />
              </PhoneFrame>
            </div>
            <PhoneFrame label={copy.hero.visualLabel} className="relative">
              <EditionScreen />
            </PhoneFrame>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default Hero;
