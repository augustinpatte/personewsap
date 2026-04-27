import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppScreen, AppText, Card, EmptyState, PrimaryButton, ProgressPill, SecondaryButton, SectionHeader } from "../../components";
import { TOPICS } from "../../constants/product";
import { tokens } from "../../design/tokens";
import type { DataFallbackReason, DataFetchSource } from "../../lib/dataState";
import { getAuthSession, type NormalizedSupabaseError } from "../../lib/supabase";
import { flattenDailyDropItems, getMockSourcesForItem, mockTodayDailyDropsByLanguage } from "../../mocks";
import type {
  BusinessStory,
  ContentLanguage,
  DailyDropContentItem,
  KeyConcept,
  MiniCaseChallenge,
  NewsletterArticle,
  TodayDailyDrop
} from "./contentTypes";
import { fetchTodayDrop } from "./dailyDropData";

const moduleOrder = ["newsletter", "business_story", "mini_case", "concept"] as const;
type ModuleId = (typeof moduleOrder)[number];
type TodayFallbackReason = DataFallbackReason | "missing_auth_session";

type TodayLoadState = {
  drop: TodayDailyDrop;
  error: NormalizedSupabaseError | null;
  fallbackReason: TodayFallbackReason | null;
  source: DataFetchSource;
  status: "loading" | "ready";
};

const activeLanguage: ContentLanguage = "en";

const topicLabels = TOPICS.reduce(
  (labels, topic) => ({
    ...labels,
    [topic.id]: topic.label
  }),
  {} as Record<(typeof TOPICS)[number]["id"], string>
);

export function TodayDailyDropScreen() {
  const fallbackDrop = mockTodayDailyDropsByLanguage[activeLanguage];
  const [loadState, setLoadState] = useState<TodayLoadState>({
    drop: fallbackDrop,
    error: null,
    fallbackReason: null,
    source: "mock",
    status: "loading"
  });
  const [completedModules, setCompletedModules] = useState<Set<ModuleId>>(new Set());
  const [showSampleAnswer, setShowSampleAnswer] = useState(false);

  const drop = loadState.drop;
  const completedCount = completedModules.size;
  const progress = completedCount / moduleOrder.length;
  const isComplete = completedCount === moduleOrder.length;
  const formattedDate = useMemo(() => formatDropDate(drop.drop_date), [drop.drop_date]);
  const allItems = useMemo(() => flattenDailyDropItems(drop), [drop]);

  useEffect(() => {
    let isMounted = true;

    async function loadTodayDrop() {
      setLoadState((currentState) => ({ ...currentState, status: "loading" }));

      const sessionResult = await getAuthSession();
      const userId = sessionResult.data?.user.id;

      if (!userId) {
        if (isMounted) {
          setLoadState({
            drop: fallbackDrop,
            error: sessionResult.error,
            fallbackReason: "missing_auth_session",
            source: "mock",
            status: "ready"
          });
        }

        return;
      }

      const result = await fetchTodayDrop(userId, getLocalDropDate(new Date()));

      if (isMounted) {
        setLoadState({
          drop: result.data,
          error: result.error,
          fallbackReason: result.fallbackReason,
          source: result.source,
          status: "ready"
        });
      }
    }

    void loadTodayDrop();

    return () => {
      isMounted = false;
    };
  }, [fallbackDrop]);

  function markComplete(moduleId: ModuleId) {
    setCompletedModules((currentModules) => new Set(currentModules).add(moduleId));
  }

  function resetDrop() {
    setCompletedModules(new Set());
    setShowSampleAnswer(false);
  }

  return (
    <AppScreen
      contentStyle={styles.screenContent}
      scrollViewProps={{
        accessibilityLabel: "Today daily drop"
      }}
    >
      <AppScreen.Header style={styles.header}>
        <View style={styles.headerTopline}>
          <AppText variant="eyebrow">Today</AppText>
          <View style={styles.headerMeta}>
            <ProgressPill
              label={loadState.source === "supabase" ? "Live daily drop" : "Mock preview"}
              tone={loadState.source === "supabase" ? "success" : "neutral"}
            />
            <AppText color="muted" variant="caption">
              {formattedDate}
            </AppText>
          </View>
        </View>
        <View style={styles.headerCopy}>
          <AppText variant="title">Your 5-minute daily drop</AppText>
          <AppText variant="body">
            One focused briefing: news signal, one business lesson, one practical challenge,
            one concept worth keeping.
          </AppText>
        </View>
        <Card padding="md" style={styles.progressCard} tone={isComplete ? "accent" : "default"}>
          <View style={styles.progressTopline}>
            <ProgressPill
              label={`${completedCount}/${moduleOrder.length} modules`}
              tone={isComplete ? "success" : "accent"}
              value={progress}
            />
            <AppText color="muted" variant="caption">
              {drop.estimated_read_minutes} min session
            </AppText>
          </View>
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <AppText color={isComplete ? "accentInk" : "muted"} variant="caption">
            {isComplete
              ? "Daily drop complete. Come back tomorrow for the next one."
              : "Finish the four modules. No feed, no backlog pressure."}
          </AppText>
        </Card>
        <TodayDataStateBanner loadState={loadState} />
      </AppScreen.Header>

      <AppScreen.Body style={styles.body}>
        <NewsletterSection
          articles={drop.items.newsletter}
          completed={completedModules.has("newsletter")}
          onComplete={() => markComplete("newsletter")}
        />
        <BusinessStorySection
          story={drop.items.business_story}
          completed={completedModules.has("business_story")}
          onComplete={() => markComplete("business_story")}
        />
        <MiniCaseSection
          challenge={drop.items.mini_case}
          completed={completedModules.has("mini_case")}
          showSampleAnswer={showSampleAnswer}
          onComplete={() => markComplete("mini_case")}
          onToggleSampleAnswer={() => setShowSampleAnswer((isVisible) => !isVisible)}
        />
        <ConceptSection
          concept={drop.items.concept}
          completed={completedModules.has("concept")}
          onComplete={() => markComplete("concept")}
        />
        <CompletionState
          allItems={allItems}
          isComplete={isComplete}
          onReset={resetDrop}
        />
      </AppScreen.Body>
    </AppScreen>
  );
}

function TodayDataStateBanner({ loadState }: { loadState: TodayLoadState }) {
  if (loadState.status === "loading") {
    return (
      <Card padding="md" tone="muted">
        <ProgressPill label="Loading daily drop" tone="neutral" />
        <AppText color="muted" variant="caption">
          Checking Supabase for today's published drop.
        </AppText>
      </Card>
    );
  }

  if (loadState.source === "supabase") {
    return (
      <Card padding="md" tone="accent">
        <ProgressPill label="Live daily drop" tone="success" value={1} />
        <AppText color="accentInk" variant="caption">
          Loaded the assigned Supabase daily_drop for {formatShortDate(loadState.drop.drop_date)}.
        </AppText>
      </Card>
    );
  }

  if (loadState.fallbackReason === "supabase_error") {
    return (
      <EmptyState
        description={loadState.error?.message ?? "Supabase is unavailable, so the app is showing the mock daily drop."}
        eyebrow="Mock preview"
        title="Could not load live content"
      />
    );
  }

  if (loadState.fallbackReason === "no_supabase_data") {
    return (
      <EmptyState
        description="No published Supabase drop exists for today yet, so the app is showing the built-in mock drop."
        eyebrow="Mock preview"
        title="No live drop yet"
      />
    );
  }

  if (loadState.fallbackReason === "missing_auth_session") {
    return (
      <EmptyState
        description="Sign in to load a personalized Supabase drop. The mock drop keeps the app usable for now."
        eyebrow="Mock preview"
        title="No active session"
      />
    );
  }

  return null;
}

type SectionCompleteButtonProps = {
  completed: boolean;
  label: string;
  onComplete: () => void;
};

function SectionCompleteButton({ completed, label, onComplete }: SectionCompleteButtonProps) {
  if (completed) {
    return <ProgressPill label="Completed" tone="success" value={1} />;
  }

  return <SecondaryButton label={label} onPress={onComplete} style={styles.sectionButton} />;
}

function NewsletterSection({
  articles,
  completed,
  onComplete
}: {
  articles: NewsletterArticle[];
  completed: boolean;
  onComplete: () => void;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader
        description="A short, sourced scan of the topics selected for today's drop."
        eyebrow="Newsletter"
        title="Signals worth knowing"
      />
      <View style={styles.topicGrid}>
        {articles.map((article) => (
          <View key={article.id} style={styles.topicCard}>
            <AppText color="accentInk" variant="label">
              {topicLabels[article.topic]}
            </AppText>
            <AppText color="muted" variant="caption">
              {getSourceCount(article)} sources
            </AppText>
          </View>
        ))}
      </View>
      <View style={styles.articleList}>
        {articles.map((article) => (
          <NewsletterArticlePreview article={article} key={article.id} />
        ))}
      </View>
      <SectionCompleteButton completed={completed} label="Mark newsletter read" onComplete={onComplete} />
    </View>
  );
}

function NewsletterArticlePreview({ article }: { article: NewsletterArticle }) {
  const sources = getDisplaySourceLabels(article);

  return (
    <Card padding="md" style={styles.articleCard}>
      <View style={styles.cardHeaderRow}>
        <AppText color="accent" variant="caption">
          {topicLabels[article.topic]}
        </AppText>
        <AppText color="muted" variant="caption">
          v{article.version}
        </AppText>
      </View>
      <AppText variant="bodyStrong">{article.title}</AppText>
      <AppText variant="body">{article.summary}</AppText>
      <View style={styles.callout}>
        <AppText color="accentInk" variant="caption">
          Why it matters
        </AppText>
        <AppText variant="body">{article.why_it_matters}</AppText>
      </View>
      <SourceLine item={article} sources={sources} />
    </Card>
  );
}

function BusinessStorySection({
  story,
  completed,
  onComplete
}: {
  story: BusinessStory;
  completed: boolean;
  onComplete: () => void;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader
        description="One concrete mechanism from business, pricing, or strategy."
        eyebrow="Business story"
        title={story.title}
      />
      <Card padding="lg">
        <View style={styles.cardHeaderRow}>
          <AppText color="accent" variant="caption">
            {story.company_or_market}
          </AppText>
          <AppText color="muted" variant="caption">
            {formatShortDate(story.story_date)}
          </AppText>
        </View>
        <StoryBeat label="Setup" text={story.setup} />
        <StoryBeat label="Tension" text={story.tension} />
        <StoryBeat label="Decision" text={story.decision} />
        <StoryBeat label="Outcome" text={story.outcome} />
        <View style={styles.lessonBox}>
          <AppText color="accentInk" variant="label">
            Lesson
          </AppText>
          <AppText variant="bodyStrong">{story.lesson}</AppText>
        </View>
        <SourceLine item={story} sources={getDisplaySourceLabels(story)} />
      </Card>
      <SectionCompleteButton completed={completed} label="Mark story complete" onComplete={onComplete} />
    </View>
  );
}

function StoryBeat({ label, text }: { label: string; text: string }) {
  return (
    <View style={styles.storyBeat}>
      <View style={styles.storyDot} />
      <View style={styles.storyCopy}>
        <AppText color="muted" variant="caption">
          {label}
        </AppText>
        <AppText variant="body">{text}</AppText>
      </View>
    </View>
  );
}

function MiniCaseSection({
  challenge,
  completed,
  showSampleAnswer,
  onComplete,
  onToggleSampleAnswer
}: {
  challenge: MiniCaseChallenge;
  completed: boolean;
  showSampleAnswer: boolean;
  onComplete: () => void;
  onToggleSampleAnswer: () => void;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader
        description="A short decision exercise. Think before checking the sample answer."
        eyebrow="Mini-case"
        title={challenge.title}
      />
      <Card padding="lg" tone="muted">
        <View style={styles.cardHeaderRow}>
          <ProgressPill label={challenge.difficulty} tone="warning" />
          <AppText color="muted" variant="caption">
            {topicLabels[challenge.topic]}
          </AppText>
        </View>
        <AppText variant="body">{challenge.context}</AppText>
        <View style={styles.challengeBox}>
          <AppText color="accentInk" variant="label">
            Challenge
          </AppText>
          <AppText variant="bodyStrong">{challenge.challenge}</AppText>
          <AppText variant="body">{challenge.question}</AppText>
        </View>
        <View style={styles.bulletGroup}>
          <AppText color="muted" variant="caption">
            Constraints
          </AppText>
          {challenge.constraints.map((constraint) => (
            <BulletText key={constraint}>{constraint}</BulletText>
          ))}
        </View>
        {showSampleAnswer ? (
          <View style={styles.sampleAnswer}>
            <AppText color="accentInk" variant="label">
              Sample answer
            </AppText>
            <AppText variant="body">{challenge.sample_answer}</AppText>
          </View>
        ) : null}
        <View style={styles.buttonRow}>
          <SecondaryButton
            label={showSampleAnswer ? "Hide sample" : "Show sample"}
            onPress={onToggleSampleAnswer}
            style={styles.flexButton}
          />
          <PrimaryButton
            disabled={completed}
            label={completed ? "Completed" : "Mark done"}
            onPress={onComplete}
            style={styles.flexButton}
          />
        </View>
      </Card>
    </View>
  );
}

function ConceptSection({
  concept,
  completed,
  onComplete
}: {
  concept: KeyConcept;
  completed: boolean;
  onComplete: () => void;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader
        description="One reusable idea for class, interviews, or serious conversations."
        eyebrow="Key concept"
        title={concept.title}
      />
      <Card padding="lg">
        <View style={styles.definitionBlock}>
          <AppText color="accentInk" variant="label">
            Definition
          </AppText>
          <AppText variant="bodyStrong">{concept.definition}</AppText>
        </View>
        <View style={styles.conceptGrid}>
          <ConceptNote label="Plain English" text={concept.plain_english} />
          <ConceptNote label="Example" text={concept.example} />
          <ConceptNote label="Use it like this" text={concept.how_to_use_it} />
          <ConceptNote label="Common mistake" text={concept.common_mistake} />
        </View>
        <SourceLine item={concept} sources={getDisplaySourceLabels(concept)} />
      </Card>
      <SectionCompleteButton completed={completed} label="Save concept for today" onComplete={onComplete} />
    </View>
  );
}

function ConceptNote({ label, text }: { label: string; text: string }) {
  return (
    <View style={styles.conceptNote}>
      <AppText color="muted" variant="caption">
        {label}
      </AppText>
      <AppText variant="body">{text}</AppText>
    </View>
  );
}

function CompletionState({
  allItems,
  isComplete,
  onReset
}: {
  allItems: DailyDropContentItem[];
  isComplete: boolean;
  onReset: () => void;
}) {
  return (
    <Card padding="lg" style={styles.completionCard} tone={isComplete ? "accent" : "muted"}>
      <ProgressPill
        label={isComplete ? "Drop complete" : "Today's drop only"}
        tone={isComplete ? "success" : "neutral"}
        value={isComplete ? 1 : undefined}
      />
      <AppText variant="subtitle">
        {isComplete ? "You finished today's briefing." : "That is the full drop for today."}
      </AppText>
      <AppText color={isComplete ? "accentInk" : "muted"} variant="body">
        {isComplete
          ? "The Library can hold past work later. Today stays focused: four modules, then stop."
          : `${allItems.length} items are available in this session. No endless queue, no next-feed pull.`}
      </AppText>
      {isComplete ? (
        <Pressable accessibilityRole="button" onPress={onReset} style={styles.resetLink}>
          <AppText color="accentInk" variant="label">
            Reset demo progress
          </AppText>
        </Pressable>
      ) : null}
    </Card>
  );
}

function BulletText({ children }: { children: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bullet} />
      <AppText style={styles.bulletCopy} variant="body">
        {children}
      </AppText>
    </View>
  );
}

function SourceLine({ item, sources }: { item: { version: number }; sources: string[] }) {
  return (
    <View style={styles.sourceLine}>
      <AppText color="muted" variant="caption">
        Sources: {sources.join(", ")}
      </AppText>
      <AppText color="muted" variant="caption">
        v{item.version}
      </AppText>
    </View>
  );
}

function getSourceCount(item: DailyDropContentItem) {
  return Math.max(item.source_ids.length, getMockSourcesForItem(item).length);
}

function getDisplaySourceLabels(item: DailyDropContentItem) {
  const mockSources = getMockSourcesForItem(item);

  if (mockSources.length > 0) {
    return mockSources.map((source) => source.publisher);
  }

  if (item.source_ids.length > 0) {
    return [`${item.source_ids.length} linked source${item.source_ids.length === 1 ? "" : "s"}`];
  }

  return ["Source metadata pending"];
}

function formatDropDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${date}T12:00:00Z`));
}

function getLocalDropDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

const styles = StyleSheet.create({
  screenContent: {
    gap: tokens.space.xl,
    paddingBottom: tokens.space.xxl
  },
  header: {
    gap: tokens.space.lg
  },
  headerTopline: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  },
  headerMeta: {
    alignItems: "flex-end",
    gap: tokens.space.xs
  },
  headerCopy: {
    gap: tokens.space.sm
  },
  progressCard: {
    gap: tokens.space.md
  },
  progressTopline: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  },
  progressBarTrack: {
    backgroundColor: tokens.color.surfaceMuted,
    borderRadius: tokens.radius.pill,
    height: 8,
    overflow: "hidden"
  },
  progressBarFill: {
    backgroundColor: tokens.color.accent,
    borderRadius: tokens.radius.pill,
    height: "100%"
  },
  body: {
    gap: tokens.space.xl
  },
  section: {
    gap: tokens.space.md
  },
  sectionButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    paddingHorizontal: tokens.space.md
  },
  topicGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.sm
  },
  topicCard: {
    backgroundColor: tokens.color.accentSoft,
    borderColor: tokens.color.accentSoft,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    gap: tokens.space.xs,
    minWidth: 132,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm
  },
  articleList: {
    gap: tokens.space.md
  },
  articleCard: {
    gap: tokens.space.md
  },
  cardHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  },
  callout: {
    backgroundColor: tokens.color.backgroundRaised,
    borderLeftColor: tokens.color.gold,
    borderLeftWidth: 3,
    gap: tokens.space.xs,
    padding: tokens.space.md
  },
  sourceLine: {
    borderTopColor: tokens.color.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between",
    paddingTop: tokens.space.md
  },
  storyBeat: {
    flexDirection: "row",
    gap: tokens.space.md
  },
  storyDot: {
    backgroundColor: tokens.color.accent,
    borderRadius: tokens.radius.pill,
    height: 8,
    marginTop: 7,
    width: 8
  },
  storyCopy: {
    flex: 1,
    gap: tokens.space.xs
  },
  lessonBox: {
    backgroundColor: tokens.color.goldSoft,
    borderRadius: tokens.radius.md,
    gap: tokens.space.xs,
    padding: tokens.space.md
  },
  challengeBox: {
    backgroundColor: tokens.color.surface,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    gap: tokens.space.sm,
    padding: tokens.space.md
  },
  bulletGroup: {
    gap: tokens.space.sm
  },
  bulletRow: {
    flexDirection: "row",
    gap: tokens.space.sm
  },
  bullet: {
    backgroundColor: tokens.color.accent,
    borderRadius: tokens.radius.pill,
    height: 5,
    marginTop: 9,
    width: 5
  },
  bulletCopy: {
    flex: 1
  },
  sampleAnswer: {
    backgroundColor: tokens.color.successSoft,
    borderRadius: tokens.radius.md,
    gap: tokens.space.sm,
    padding: tokens.space.md
  },
  buttonRow: {
    flexDirection: "row",
    gap: tokens.space.sm
  },
  flexButton: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: tokens.space.md
  },
  definitionBlock: {
    gap: tokens.space.sm
  },
  conceptGrid: {
    gap: tokens.space.md
  },
  conceptNote: {
    borderTopColor: tokens.color.border,
    borderTopWidth: 1,
    gap: tokens.space.xs,
    paddingTop: tokens.space.md
  },
  completionCard: {
    gap: tokens.space.md
  },
  resetLink: {
    alignSelf: "flex-start",
    paddingVertical: tokens.space.xs
  }
});
