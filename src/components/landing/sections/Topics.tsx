import { useState } from "react";
import { Check } from "lucide-react";
import { TOPIC_IDS, type TopicId } from "@/landing/copy";
import { TOPIC_ICONS } from "@/landing/topicIcons";
import { useLandingCopy } from "@/landing/useLandingCopy";
import { cn } from "@/lib/utils";
import { Container, DemoTag, SectionHeading } from "../Section";
import { AppEyebrow } from "../mockups/fragments";

/**
 * A working miniature of onboarding: toggle topics, and the edition preview
 * beside it follows. Nothing is stored — it only shows what personal means.
 */
const Topics = () => {
  const { copy } = useLandingCopy();
  const t = copy.topics;
  const [selected, setSelected] = useState<TopicId[]>(["business", "finance", "tech_ai"]);

  const toggle = (id: TopicId) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : TOPIC_IDS.filter((value) => value === id || current.includes(value))
    );

  return (
    <section id="topics" aria-labelledby="topics-title" className="scroll-mt-20 py-20 sm:py-28">
      <Container>
        <SectionHeading id="topics-title" eyebrow={t.eyebrow} title={t.title} lede={t.lede} />

        <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-10">
          <div>
            <p id="topic-picker-label" className="sr-only">
              {t.pickerLabel}
            </p>
            <ul aria-labelledby="topic-picker-label" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {TOPIC_IDS.map((id) => {
                const Icon = TOPIC_ICONS[id];
                const active = selected.includes(id);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggle(id)}
                      className={cn(
                        "pn-focus group relative flex h-full w-full flex-col items-start rounded-2xl border p-4 text-left transition-[background-color,border-color,box-shadow] duration-200",
                        active
                          ? "border-pn-teal bg-pn-teal-soft shadow-[inset_0_0_0_1px_#0F5B5F]"
                          : "border-pn-line bg-pn-surface hover:border-pn-line-strong hover:bg-pn-raised"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-xl",
                          active ? "bg-pn-teal text-white" : "bg-pn-sunk text-pn-ink-soft"
                        )}
                      >
                        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                      </span>
                      <span className="mt-4 font-serif text-[1.08rem] font-semibold leading-tight text-pn-ink">{t.list[id].name}</span>
                      <span className="mt-1 text-[12.5px] leading-snug text-pn-muted">{t.list[id].scope}</span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                          active ? "border-pn-teal bg-pn-teal text-white" : "border-pn-line-strong bg-pn-surface text-transparent"
                        )}
                      >
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-[13px] font-medium text-pn-muted" aria-live="polite">
              {t.selected(selected.length)}
            </p>
          </div>

          {/* The preview, styled as an app screen. */}
          <div className="rounded-[1.75rem] border border-pn-line bg-pn-paper p-3 shadow-pn-card sm:p-4">
            <div className="rounded-[1.35rem] border border-pn-line bg-pn-raised p-5 text-[15px]">
              <div className="flex items-center justify-between gap-3">
                <p className="font-serif text-xl font-semibold text-pn-ink">{t.previewTitle}</p>
                <span className="rounded-full bg-pn-teal-soft px-2.5 py-1 text-[12px] font-semibold text-pn-teal-ink">
                  {selected.length}
                </span>
              </div>
              <ul className="mt-4 space-y-2.5" aria-live="polite">
                {selected.length === 0 ? (
                  <li className="rounded-2xl border border-dashed border-pn-line-strong p-5 text-center text-[14px] text-pn-muted">
                    {t.previewEmpty}
                  </li>
                ) : (
                  selected.map((id) => (
                    <li
                      key={id}
                      className="rounded-2xl border border-pn-line bg-pn-surface p-4 motion-safe:animate-fade-in"
                    >
                      <AppEyebrow className="text-[11px]">{t.list[id].name}</AppEyebrow>
                      <p className="mt-1.5 font-serif text-[1.02rem] font-semibold leading-snug text-pn-ink">
                        {t.list[id].headline}
                      </p>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div className="px-2 pb-1 pt-3">
              <DemoTag>{t.previewHint}</DemoTag>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default Topics;
