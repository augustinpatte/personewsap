import { useLandingCopy } from "@/landing/useLandingCopy";
import { Container, Eyebrow } from "../Section";

const Mission = () => {
  const { copy } = useLandingCopy();
  const m = copy.mission;

  return (
    <section id="about" aria-labelledby="about-title" className="scroll-mt-20 py-20 sm:py-28">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div>
            <Eyebrow>{m.eyebrow}</Eyebrow>
            <h2
              id="about-title"
              className="mt-4 font-serif text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.025em] text-pn-ink sm:text-[3.4rem]"
            >
              {m.titleLead}
              {" "}
              <br />
              <span className="text-pn-teal">{m.titleTail}</span>
            </h2>
          </div>
          <div className="space-y-4 text-[1.08rem] leading-relaxed text-pn-ink-soft lg:pt-10">
            {m.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>

        <ul className="mt-14 grid gap-px overflow-hidden rounded-[1.75rem] border border-pn-line bg-pn-line md:grid-cols-3">
          {m.principles.map((principle, i) => (
            <li key={principle.title} className="pn-reveal bg-pn-raised p-6 sm:p-8">
              <span className="font-serif text-sm font-semibold text-pn-gold">0{i + 1}</span>
              <h3 className="mt-3 font-serif text-xl font-semibold text-pn-ink">{principle.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-pn-ink-soft">{principle.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
};

export default Mission;
