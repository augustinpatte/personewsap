import { useLandingCopy } from "@/landing/useLandingCopy";
import { Container } from "../Section";
import StoreBadges from "../StoreBadges";

const ComingSoon = () => {
  const { copy } = useLandingCopy();
  const d = copy.download;

  return (
    <section id="download" aria-labelledby="download-title" className="scroll-mt-20 pb-20 sm:pb-28">
      <Container>
        <div className="pn-reveal relative overflow-hidden rounded-[2rem] bg-pn-teal-deep px-6 py-12 text-pn-night-ink sm:px-12 sm:py-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border border-white/10"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full border border-white/10"
          />
          <div className="relative flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <img
                src="/app-icon-256.png"
                alt=""
                width={96}
                height={96}
                loading="lazy"
                decoding="async"
                className="h-20 w-20 rounded-[22px] shadow-[0_18px_40px_-16px_rgba(0,0,0,0.6)] sm:h-24 sm:w-24"
              />
              <div className="max-w-xl">
                <p className="pn-eyebrow text-[#9FD6D0]">{d.eyebrow}</p>
                <h2 id="download-title" className="mt-2 font-serif text-[2rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[2.4rem]">
                  {d.title}
                </h2>
                <p className="mt-2 text-[1.02rem] leading-relaxed text-pn-night-soft">{d.lede}</p>
              </div>
            </div>
            <StoreBadges tone="light" className="md:flex-col" />
          </div>
          <p className="relative mt-8 border-t border-white/10 pt-5 text-[13.5px] text-pn-night-soft">{d.note}</p>
        </div>
      </Container>
    </section>
  );
};

export default ComingSoon;
