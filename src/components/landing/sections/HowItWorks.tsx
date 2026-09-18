import { Check } from "lucide-react";
import { useLandingCopy } from "@/landing/useLandingCopy";
import { cn } from "@/lib/utils";
import { Container, DemoTag, SectionHeading } from "../Section";

/**
 * The edition ring: four equal parts (not timed slices — the parts differ in
 * length and the page does not pretend to know by how much), two done.
 * One hue: done parts in teal, the rest as track.
 */
const EditionRing = ({ label, center, caption }: { label: string; center: string; caption: string }) => {
  const size = 260;
  const r = 104;
  const stroke = 16;
  const c = 2 * Math.PI * r;
  const gap = 10; // px of arc between parts
  const part = c / 4;
  const done = 2;

  return (
    <figure className="relative mx-auto w-full max-w-[17rem]">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="h-auto w-full">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {Array.from({ length: 4 }, (_, i) => (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={i < done ? "#0F5B5F" : "#E6E0D3"}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${part - gap - stroke} ${c}`}
              strokeDashoffset={-(i * part + gap / 2 + stroke / 2)}
            />
          ))}
        </g>
        {Array.from({ length: 4 }, (_, i) => {
          const angle = ((i + 0.5) / 4) * 2 * Math.PI - Math.PI / 2;
          const x = size / 2 + r * Math.cos(angle);
          const y = size / 2 + r * Math.sin(angle);
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={14} fill={i < done ? "#0F5B5F" : "#FBF8F1"} stroke={i < done ? "#FBF8F1" : "#D2CABA"} strokeWidth={2} />
              <text
                x={x}
                y={y + 4.5}
                textAnchor="middle"
                fontSize="13"
                fontWeight="700"
                fill={i < done ? "#FFFFFF" : "#4A463D"}
                fontFamily="Inter, system-ui, sans-serif"
              >
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-serif text-[2.6rem] font-semibold leading-none tracking-[-0.02em] text-pn-ink">{center}</span>
        <span className="mt-2 text-[13px] font-medium text-pn-muted">{caption}</span>
      </figcaption>
    </figure>
  );
};

type DayState = "read" | "today" | "edition" | "digest" | "rest";
// Monday, Wednesday, Friday editions and a Sunday digest — the real cadence.
const WEEK: DayState[] = ["read", "rest", "today", "rest", "edition", "rest", "digest"];

const DayMark = ({ state, small = false }: { state: DayState; small?: boolean }) => {
  const box = small ? "h-5 w-5" : "h-9 w-9";
  switch (state) {
    case "read":
      return (
        <span className={`flex ${box} items-center justify-center rounded-full bg-pn-teal text-white`}>
          <Check className={small ? "h-3 w-3" : "h-4 w-4"} strokeWidth={3} />
        </span>
      );
    case "today":
      return (
        <span className={`flex ${box} items-center justify-center rounded-full border-2 border-pn-teal`}>
          <span className={cn("rounded-full bg-pn-teal/70", small ? "h-2 w-2" : "h-3.5 w-3.5")} />
        </span>
      );
    case "edition":
      return <span className={`block ${box} rounded-full border-2 border-pn-line-strong bg-pn-surface`} />;
    case "digest":
      return (
        <span className={`flex ${box} items-center justify-center rounded-full border-2 border-pn-gold bg-pn-gold-soft`}>
          <span className={cn("rotate-45 bg-pn-gold", small ? "h-1.5 w-1.5" : "h-2.5 w-2.5")} />
        </span>
      );
    default:
      return (
        <span className={`flex ${box} items-center justify-center`}>
          <span className={cn("h-0.5 rounded-full bg-pn-line-strong", small ? "w-2.5" : "w-3")} />
        </span>
      );
  }
};

const HowItWorks = () => {
  const { copy } = useLandingCopy();
  const h = copy.howItWorks;
  const stateLabel: Record<DayState, string> = {
    read: h.read,
    today: h.today,
    edition: h.edition,
    digest: h.digest,
    rest: h.rest,
  };

  return (
    <section
      id="how-it-works"
      aria-labelledby="how-title"
      className="scroll-mt-20 border-y border-pn-line bg-pn-raised py-20 sm:py-28"
    >
      <Container>
        <SectionHeading id="how-title" eyebrow={h.eyebrow} title={h.titleLead} titleTail={h.titleTail} lede={h.lede} />

        <div className="mt-14 grid items-center gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div className="pn-reveal">
            <EditionRing label={h.ringLabel} center={h.ringCenter} caption={h.ringCaption} />
          </div>
          {/* A ruled list, not cards: the formats were already shown as cards just above. */}
          <ol className="pn-reveal divide-y divide-pn-line border-y border-pn-line">
            {h.parts.map((part, i) => (
              <li key={part.title} className="flex items-start gap-4 py-5">
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold",
                    i < 2 ? "bg-pn-teal text-white" : "border border-pn-line-strong text-pn-ink-soft"
                  )}
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-serif text-lg font-semibold text-pn-ink">{part.title}</h3>
                  <p className="mt-0.5 text-[14.5px] leading-relaxed text-pn-ink-soft">{part.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="pn-reveal mt-16 rounded-[1.75rem] border border-pn-line bg-pn-surface p-6 sm:p-8">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <h3 className="font-serif text-2xl font-semibold text-pn-ink">{h.weekTitle}</h3>
              <p className="mt-1 max-w-xl text-[15px] leading-relaxed text-pn-ink-soft">{h.weekLede}</p>
            </div>
            <DemoTag>{h.weekNote}</DemoTag>
          </div>

          <ol className="mt-7 grid grid-cols-7 gap-1 sm:gap-3">
            {WEEK.map((state, i) => (
              <li
                key={h.days[i]}
                className={cn(
                  "flex flex-col items-center gap-2.5 rounded-2xl py-3",
                  state === "today" && "bg-pn-teal-soft"
                )}
              >
                <span
                  className={cn(
                    "text-[11px] font-semibold uppercase tracking-[0.1em] sm:text-[12px]",
                    state === "rest" ? "text-pn-muted" : "text-pn-ink"
                  )}
                >
                  {h.days[i]}
                </span>
                <DayMark state={state} />
                <span className="sr-only">{stateLabel[state]}</span>
              </li>
            ))}
          </ol>

          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-3 border-t border-pn-line pt-5 text-[13px] text-pn-ink-soft">
            {(["read", "today", "edition", "digest", "rest"] as DayState[]).map((state) => (
              <li key={state} className="flex items-center gap-2">
                <span aria-hidden="true" className="flex">
                  <DayMark state={state} small />
                </span>
                <span>{stateLabel[state]}</span>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
};

export default HowItWorks;
