import type { TopicId } from "@/landing/copy";
import { TOPIC_ICONS } from "@/landing/topicIcons";
import { useLandingCopy } from "@/landing/useLandingCopy";
import { cn } from "@/lib/utils";
import { Container, DemoTag, SectionHeading } from "../Section";

type Reader = { key: "readerA" | "readerB"; mix: { id: TopicId; articles: number }[] };

// Articles per topic is a real setting (1 to 3). These two mixes are examples,
// kept clear of the Topics preview default (business, finance, tech) just
// above, so the section shows new headlines rather than the same three again.
const READERS: Reader[] = [
  {
    key: "readerA",
    mix: [
      { id: "sport_business", articles: 3 },
      { id: "engineering", articles: 2 },
      { id: "tech_ai", articles: 1 },
    ],
  },
  {
    key: "readerB",
    mix: [
      { id: "medicine", articles: 2 },
      { id: "law", articles: 2 },
      { id: "culture_media", articles: 1 },
    ],
  },
];

const ReaderCard = ({ reader }: { reader: Reader }) => {
  const { copy } = useLandingCopy();
  const p = copy.personalization;

  return (
    <article className="pn-reveal flex flex-col rounded-[1.75rem] border border-pn-line bg-pn-surface p-6 shadow-pn-card sm:p-7">
      <header className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-pn-ink font-serif text-lg font-semibold text-pn-paper"
        >
          {p[reader.key].slice(-1)}
        </span>
        <div>
          <h3 className="font-serif text-xl font-semibold text-pn-ink">{p[reader.key]}</h3>
          <p className="text-[13px] text-pn-muted">
            {p.topicsLabel} {reader.mix.map((item) => copy.topics.list[item.id].name).join(" · ")}
          </p>
        </div>
      </header>

      {/* Edition mix: one bar, one hue, segments sized by article count, labelled directly. */}
      <div className="mt-6">
        <p className="pn-eyebrow text-pn-muted">{p.compositionLabel}</p>
        <ul className="mt-3 flex gap-1">
          {reader.mix.map((item, i) => {
            // The last segment is the narrowest: its label stays on one line,
            // aligned to the bar's end, instead of breaking word by word.
            const last = i === reader.mix.length - 1;
            return (
              <li key={item.id} style={{ flexGrow: item.articles, flexBasis: 0 }} className="min-w-0">
                <span aria-hidden="true" className="block h-2.5 rounded-full bg-pn-teal" />
                <span className={cn("mt-2.5 flex flex-col", last ? "items-end text-right" : "pr-1")}>
                  <span
                    className={cn("text-[12.5px] font-semibold leading-tight text-pn-ink", last && "whitespace-nowrap")}
                  >
                    {copy.topics.list[item.id].name}
                  </span>
                  <span className="whitespace-nowrap text-[12px] text-pn-muted">{p.articles(item.articles)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-6 border-t border-pn-line pt-5">
        <p className="pn-eyebrow text-pn-muted">{p.feedLabel}</p>
        <ul className="mt-3 space-y-3">
          {reader.mix.map((item) => {
            const Icon = TOPIC_ICONS[item.id];
            return (
              <li key={item.id} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pn-teal-soft text-pn-teal">
                  <Icon className="h-4 w-4" strokeWidth={1.9} />
                </span>
                <span>
                  <span className="pn-eyebrow block text-[10.5px] text-pn-teal">{copy.topics.list[item.id].name}</span>
                  <span className="mt-0.5 block font-serif text-[1.02rem] font-semibold leading-snug text-pn-ink">
                    {copy.topics.list[item.id].headline}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </article>
  );
};

const Personalization = () => {
  const { copy } = useLandingCopy();
  const p = copy.personalization;

  return (
    <section aria-labelledby="personal-title" className="bg-pn-sunk/60 py-20 sm:py-28">
      <Container>
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <SectionHeading id="personal-title" eyebrow={p.eyebrow} title={p.title} lede={p.lede} />
          <DemoTag>{p.note}</DemoTag>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:gap-6">
          {READERS.map((reader) => (
            <ReaderCard key={reader.key} reader={reader} />
          ))}
        </div>
      </Container>
    </section>
  );
};

export default Personalization;
