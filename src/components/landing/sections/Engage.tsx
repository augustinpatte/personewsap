import { BookOpen, GitCompare, Lightbulb, MessageCircleQuestion, SquareCheck, Users } from "lucide-react";
import { useLandingCopy } from "@/landing/useLandingCopy";
import { cn } from "@/lib/utils";
import { Container, DemoTag, SectionHeading } from "../Section";

const STEP_ICONS = [BookOpen, MessageCircleQuestion, SquareCheck, GitCompare, Lightbulb];

// The real scoring scale: part of the point, by the quality of the reasoning.
const TIER_SHARES = [1, 0.6, 0.3, 0];

// Example leaderboard. The names are placeholders and say so on the page.
const BOARD = [
  { name: "Léa", score: 7.2 },
  { name: null, score: 6.6 },
  { name: "Hugo", score: 5.9 },
  { name: "Inès", score: 4.3 },
];

const Engage = () => {
  const { copy, lang } = useLandingCopy();
  const e = copy.engage;
  const format = (value: number) => value.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { minimumFractionDigits: 1 });
  const max = Math.max(...BOARD.map((row) => row.score));

  return (
    <section aria-labelledby="engage-title" className="bg-pn-night py-20 text-pn-night-ink sm:py-28">
      <Container>
        <SectionHeading id="engage-title" eyebrow={e.eyebrow} title={e.title} lede={e.lede} tone="light" />

        <ol className="pn-reveal mt-12 grid grid-cols-1 gap-3 sm:grid-cols-5 sm:gap-0">
          {e.steps.map((step, i) => {
            const Icon = STEP_ICONS[i];
            return (
              <li key={step.title} className="relative flex gap-4 sm:flex-col sm:gap-0 sm:pr-4">
                <div className="flex items-center sm:w-full">
                  <span className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-pn-night-line bg-pn-night-raised text-pn-night-teal">
                    <Icon className="h-5 w-5" strokeWidth={1.8} />
                  </span>
                  {i < e.steps.length - 1 ? (
                    <span aria-hidden="true" className="ml-3 hidden h-px flex-1 bg-pn-night-line sm:block" />
                  ) : null}
                </div>
                <div className="sm:mt-4">
                  <h3 className="font-serif text-lg font-semibold">{step.title}</h3>
                  <p className="mt-1 text-[14px] leading-relaxed text-pn-night-soft">{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-14 grid gap-5 lg:grid-cols-2 lg:gap-6">
          <article className="pn-reveal rounded-[1.75rem] border border-pn-night-line bg-pn-night-raised p-6 sm:p-8">
            <h3 className="font-serif text-2xl font-semibold">{e.scoring.title}</h3>
            <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-pn-night-soft">{e.scoring.body}</p>
            <ul className="mt-7 space-y-4">
              {e.scoring.tiers.map((tier, i) => (
                <li key={tier.name} className="grid grid-cols-[3.25rem_1fr] items-start gap-4">
                  <span className="font-serif text-[1.7rem] font-semibold leading-none tabular-nums">{tier.value}</span>
                  <div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[14px] font-semibold">{tier.name}</span>
                    </div>
                    <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-pn-night-line">
                      <div
                        className="h-full rounded-full bg-pn-night-teal"
                        style={{ width: `${TIER_SHARES[i] * 100}%` }}
                      />
                    </div>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-pn-night-soft">{tier.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </article>

          <article className="pn-reveal flex flex-col rounded-[1.75rem] border border-pn-night-line bg-pn-night-raised p-6 sm:p-8">
            <p className="inline-flex w-fit items-center gap-2 rounded-full border border-pn-night-gold/40 px-3 py-1 text-[12px] font-semibold text-pn-night-gold">
              <Users className="h-3.5 w-3.5" strokeWidth={2} />
              {e.teams.tag}
            </p>
            <h3 className="mt-4 font-serif text-2xl font-semibold">{e.teams.title}</h3>
            <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-pn-night-soft">{e.teams.body}</p>

            <div className="mt-7 rounded-2xl border border-pn-night-line bg-pn-night p-5">
              <p className="pn-eyebrow text-pn-night-soft">{e.teams.boardTitle}</p>
              <ol className="mt-4 space-y-3">
                {BOARD.map((row, i) => {
                  const you = row.name === null;
                  return (
                    <li key={row.name ?? "you"} className="grid grid-cols-[1.25rem_5.5rem_1fr_2.5rem] items-center gap-3 text-[14px]">
                      <span className="tabular-nums text-pn-night-soft">{i + 1}</span>
                      <span className={cn("truncate font-semibold", you && "text-pn-night-teal")}>
                        {you ? e.teams.you : row.name}
                      </span>
                      <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-pn-night-line">
                        <span
                          className={cn("block h-full rounded-full", you ? "bg-pn-night-teal" : "bg-pn-night-soft/60")}
                          style={{ width: `${(row.score / max) * 100}%` }}
                        />
                      </span>
                      <span className="text-right font-semibold tabular-nums">{format(row.score)}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="mt-4">
              <DemoTag tone="light">{e.teams.caption}</DemoTag>
            </div>
          </article>
        </div>
      </Container>
    </section>
  );
};

export default Engage;
