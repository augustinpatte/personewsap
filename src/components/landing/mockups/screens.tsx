import { useLandingCopy } from "@/landing/useLandingCopy";
import type { TopicId } from "@/landing/copy";
import { AppTabBar, StatusBar } from "./PhoneFrame";
import { AppEyebrow, EditionProgress, MiniCase, NewsCard, StoryTeaser, TopicChip } from "./fragments";

/** The Newsletter tab on an edition day: header, progress, topics, cards. */
export const EditionScreen = ({ topics = ["finance", "business", "tech_ai"] }: { topics?: TopicId[] }) => {
  const { copy } = useLandingCopy();
  return (
    <>
      <StatusBar />
      <div className="px-[1.1em] pt-[1.3em]">
        <AppEyebrow>{copy.app.editionEyebrow}</AppEyebrow>
        <div className="mt-[0.25em] flex items-end justify-between gap-[0.5em]">
          <p className="font-serif text-[1.75em] font-semibold leading-[1.1] tracking-[-0.015em] text-pn-ink">
            {copy.app.editionTitle}
          </p>
          <p className="pb-[0.3em] text-[0.62em] font-semibold text-pn-muted">
            {copy.app.progress} · {copy.app.minutes(5)}
          </p>
        </div>
        <div className="mt-[0.6em]">
          <EditionProgress done={2} />
        </div>
        <div className="mt-[0.8em] flex flex-wrap gap-[0.35em]">
          {topics.map((id) => (
            <TopicChip key={id} id={id} />
          ))}
        </div>
        <div className="mt-[0.8em] space-y-[0.55em]">
          <NewsCard id={topics[0]} minutes={3} done />
          <StoryTeaser />
          <NewsCard id={topics[2] ?? topics[0]} minutes={2} />
        </div>
      </div>
      <AppTabBar active="newsletter" />
    </>
  );
};

export const CaseScreen = () => (
  <>
    <StatusBar />
    <div className="px-[1.1em] pt-[1.3em]">
      <MiniCase />
    </div>
    <AppTabBar active="cases" />
  </>
);
