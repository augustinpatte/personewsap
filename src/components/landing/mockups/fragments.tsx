import { Check, Timer } from "lucide-react";
import type { TopicId } from "@/landing/copy";
import { TOPIC_ICONS } from "@/landing/topicIcons";
import { useLandingCopy } from "@/landing/useLandingCopy";
import { cn } from "@/lib/utils";

/*
 * Pieces of the PersoNewsAP app, drawn with the app's own tokens: paper
 * surfaces, ink, a teal accent, serif headlines, small-caps eyebrows. Sizes are
 * in `em` so each fragment scales with the frame that holds it.
 */

export const AppEyebrow = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <p className={cn("text-[0.6em] font-semibold uppercase tracking-[0.16em] text-pn-teal", className)}>{children}</p>
);

export const TopicChip = ({ id, active = true }: { id: TopicId; active?: boolean }) => {
  const { copy } = useLandingCopy();
  const Icon = TOPIC_ICONS[id];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[0.35em] whitespace-nowrap rounded-full border px-[0.65em] py-[0.3em] text-[0.66em] font-semibold",
        active ? "border-pn-teal/30 bg-pn-teal-soft text-pn-teal-ink" : "border-pn-line bg-pn-surface text-pn-muted"
      )}
    >
      <Icon className="h-[1.1em] w-[1.1em]" strokeWidth={2} />
      {copy.topics.list[id].name}
    </span>
  );
};

/** The segmented edition progress: four parts, `done` filled. */
export const EditionProgress = ({ done, total = 4 }: { done: number; total?: number }) => (
  <div className="flex gap-[0.25em]">
    {Array.from({ length: total }, (_, i) => (
      <span key={i} className={cn("h-[0.28em] flex-1 rounded-full", i < done ? "bg-pn-teal" : "bg-pn-line")} />
    ))}
  </div>
);

export const NewsCard = ({ id, minutes, done = false }: { id: TopicId; minutes: number; done?: boolean }) => {
  const { copy } = useLandingCopy();
  const topic = copy.topics.list[id];
  return (
    <div className="rounded-[1.1em] border border-pn-line bg-pn-surface p-[0.95em] shadow-[0_1px_0_rgba(28,26,22,0.03)]">
      <div className="flex items-center justify-between">
        <AppEyebrow>
          {topic.name} · {copy.app.minutes(minutes)}
        </AppEyebrow>
        {done ? (
          <span className="flex h-[1.15em] w-[1.15em] items-center justify-center rounded-full bg-pn-teal text-white">
            <Check className="h-[0.75em] w-[0.75em]" strokeWidth={3} />
          </span>
        ) : null}
      </div>
      <p className="mt-[0.45em] font-serif text-[1.02em] font-semibold leading-[1.22] text-pn-ink">{topic.headline}</p>
      <p className="mt-[0.55em] border-l-2 border-pn-gold/60 pl-[0.6em] text-[0.7em] leading-[1.45] text-pn-ink-soft">
        <span className="font-semibold text-pn-ink">{copy.app.whyLabel}. </span>
        {topic.why}
      </p>
    </div>
  );
};

export const StoryTeaser = () => {
  const { copy } = useLandingCopy();
  return (
    <div className="rounded-[1.1em] bg-pn-teal-deep p-[0.95em] text-pn-night-ink">
      <p className="text-[0.6em] font-semibold uppercase tracking-[0.16em] text-[#9FD6D0]">
        {copy.app.storyEyebrow} · {copy.app.minutes(4)}
      </p>
      <p className="mt-[0.45em] font-serif text-[1.02em] font-semibold leading-[1.22]">{copy.story.title}</p>
    </div>
  );
};

/** A Business Story open in the reader: chapter rail, drop-cap body, lesson. */
export const StoryReader = () => {
  const { copy } = useLandingCopy();
  const { story } = copy;
  return (
    <div>
      <AppEyebrow>
        {copy.app.storyEyebrow} · {story.company}
      </AppEyebrow>
      <p className="mt-[0.4em] font-serif text-[1.35em] font-semibold leading-[1.15] tracking-[-0.01em] text-pn-ink">
        {story.title}
      </p>
      <ol className="mt-[0.9em] grid grid-cols-5 gap-[0.3em]">
        {story.chapters.map((chapter, i) => (
          <li key={chapter} className="min-w-0">
            <span
              className={cn(
                "block h-[0.25em] rounded-full",
                i < story.activeChapter ? "bg-pn-teal" : i === story.activeChapter ? "bg-pn-gold" : "bg-pn-line"
              )}
            />
            <span
              className={cn(
                "mt-[0.4em] block truncate text-[0.55em] font-semibold",
                i === story.activeChapter ? "text-pn-ink" : "text-pn-muted"
              )}
            >
              {chapter}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-[0.9em] font-serif text-[0.86em] leading-[1.6] text-pn-ink-soft">
        <span className="float-left mr-[0.12em] mt-[0.08em] font-serif text-[3.1em] font-semibold leading-[0.8] text-pn-teal">
          {story.body.charAt(0)}
        </span>
        {story.body.slice(1)}
      </p>
      <div className="clear-left mt-[0.9em] rounded-[0.9em] bg-pn-gold-soft p-[0.85em]">
        <p className="text-[0.58em] font-semibold uppercase tracking-[0.16em] text-pn-gold">{story.lessonLabel}</p>
        <p className="mt-[0.3em] font-serif text-[0.9em] italic leading-[1.4] text-pn-ink">{story.lesson}</p>
      </div>
    </div>
  );
};

const OptionRow = ({
  label,
  text,
  state,
  verdict,
}: {
  label: string;
  text: string;
  state: "idle" | "chosen" | "muted";
  verdict?: string;
}) => (
  <div
    className={cn(
      "flex items-start gap-[0.6em] rounded-[0.9em] border p-[0.65em]",
      state === "chosen" ? "border-pn-teal bg-pn-teal-soft" : "border-pn-line bg-pn-surface",
      state === "muted" && "opacity-60"
    )}
  >
    <span
      className={cn(
        "flex h-[1.5em] w-[1.5em] shrink-0 items-center justify-center rounded-full text-[0.68em] font-bold",
        state === "chosen" ? "bg-pn-teal text-white" : "border border-pn-line-strong text-pn-muted"
      )}
    >
      {state === "chosen" ? <Check className="h-[1em] w-[1em]" strokeWidth={3} /> : label}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-[0.74em] font-medium leading-[1.35] text-pn-ink">{text}</span>
      {verdict ? (
        <span className="mt-[0.3em] block text-[0.6em] font-semibold uppercase tracking-[0.12em] text-pn-teal">
          {verdict}
        </span>
      ) : null}
    </span>
  </div>
);

export const MiniCase = ({ showContext = true }: { showContext?: boolean }) => {
  const { copy } = useLandingCopy();
  const { miniCase } = copy;
  return (
    <div>
      <AppEyebrow>{copy.app.caseEyebrow}</AppEyebrow>
      <p className="mt-[0.4em] font-serif text-[1.3em] font-semibold leading-[1.15] tracking-[-0.01em] text-pn-ink">
        {miniCase.title}
      </p>
      {showContext ? (
        <p className="mt-[0.6em] text-[0.76em] leading-[1.5] text-pn-ink-soft">{miniCase.context}</p>
      ) : null}
      <p className="mt-[0.75em] text-[0.8em] font-semibold text-pn-ink">{miniCase.prompt}</p>
      <div className="mt-[0.55em] space-y-[0.4em]">
        {miniCase.options.map((option, i) => (
          <OptionRow
            key={option.label}
            label={option.label}
            text={option.text}
            state={i === miniCase.chosen ? "chosen" : "idle"}
            verdict={i === miniCase.chosen ? `${miniCase.verdict} · ${copy.app.points("1")}` : undefined}
          />
        ))}
      </div>
      <p className="mt-[0.6em] rounded-[0.9em] bg-pn-surface p-[0.75em] text-[0.7em] leading-[1.5] text-pn-ink-soft ring-1 ring-pn-line">
        {miniCase.feedback}
      </p>
    </div>
  );
};

/** A scored question: the 20-second timer, three answers, the verdict. */
export const Question = () => {
  const { copy } = useLandingCopy();
  const { question } = copy;
  return (
    <div>
      <div className="flex items-center justify-between">
        <AppEyebrow>{copy.app.questionEyebrow(2, 3)}</AppEyebrow>
        <span className="inline-flex items-center gap-[0.3em] rounded-full bg-pn-sunk px-[0.6em] py-[0.25em] text-[0.62em] font-semibold text-pn-ink">
          <Timer className="h-[1.1em] w-[1.1em]" strokeWidth={2.2} />
          {copy.app.seconds(12)}
        </span>
      </div>
      <div className="mt-[0.5em] h-[0.25em] overflow-hidden rounded-full bg-pn-line">
        <div className="h-full w-[60%] rounded-full bg-pn-gold" />
      </div>
      <p className="mt-[0.8em] font-serif text-[1.08em] font-semibold leading-[1.25] text-pn-ink">{question.prompt}</p>
      <div className="mt-[0.7em] space-y-[0.4em]">
        {question.options.map((option, i) => (
          <OptionRow
            key={option.label}
            label={option.label}
            text={option.text}
            state={i === question.chosen ? "chosen" : "muted"}
            verdict={i === question.chosen ? `${question.verdict} · ${copy.app.points("1")}` : undefined}
          />
        ))}
      </div>
      <p className="mt-[0.6em] text-[0.7em] leading-[1.5] text-pn-ink-soft">{question.explanation}</p>
    </div>
  );
};
