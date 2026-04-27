import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppScreen, AppText, Card, EmptyState, PrimaryButton, ProgressPill, SecondaryButton, SectionHeader } from "../../components";
import { TOPICS } from "../../constants/product";
import { tokens } from "../../design/tokens";
import type { DataFallbackReason, DataFetchSource } from "../../lib/dataState";
import { getAuthSession, type NormalizedSupabaseError } from "../../lib/supabase";
import { flattenDailyDropItems, getMockSourcesForItem, mockTodayDailyDropsByLanguage } from "../../mocks";
import type { ContentRating, InteractionType } from "../../types/domain";
import type {
  BusinessStory,
  ContentLanguage,
  DailyDropContentItem,
  KeyConcept,
  MiniCaseChallenge,
  NewsletterArticle,
  TodayDailyDrop
} from "./contentTypes";
import {
  createEmptyContentInteractionSnapshot,
  readContentInteractionSnapshot,
  writeContentInteraction,
  type ContentInteractionSnapshot
} from "./contentInteractions";
import { fetchTodayDrop } from "./dailyDropData";

const moduleOrder = ["newsletter", "business_story", "mini_case", "concept"] as const;
type ModuleId = (typeof moduleOrder)[number];
type TodayFallbackReason = DataFallbackReason;

type TodayLoadState = {
  drop: TodayDailyDrop;
  error: NormalizedSupabaseError | null;
  fallbackReason: TodayFallbackReason | null;
  source: DataFetchSource;
  status: "loading" | "ready";
};

type InteractionState = ContentInteractionSnapshot;

type InteractionAction = {
  contentItemId: string;
  interactionType: InteractionType;
  rating?: ContentRating;
  message?: string;
};

const activeLanguage: ContentLanguage = "en";

const topicLabels = TOPICS.reduce(
  (labels, topic) => ({
    ...labels,
    [topic.id]: topic.label
  }),
  {} as Record<(typeof TOPICS)[number]["id"], string>
);

const moduleLabels: Record<ModuleId, string> = {
  newsletter: "Newsletter",
  business_story: "Business story",
  mini_case: "Mini-case",
  concept: "Concept"
};

const moduleDescriptions: Record<ModuleId, string> = {
  newsletter: "Sourced news signal",
  business_story: "Business mechanism",
  mini_case: "Decision exercise",
  concept: "Reusable idea"
};

export function TodayDailyDropScreen() {
  const fallbackDrop = mockTodayDailyDropsByLanguage[activeLanguage];
  const [loadState, setLoadState] = useState<TodayLoadState>({
    drop: fallbackDrop,
    error: null,
    fallbackReason: null,
    source: "mock",
    status: "loading"
  });
  const [interactionState, setInteractionState] = useState<InteractionState>(
    createEmptyContentInteractionSnapshot
  );
  const [interactionError, setInteractionError] = useState<NormalizedSupabaseError | null>(null);
  const [interactionMessage, setInteractionMessage] = useState<string | null>(null);
  const [pendingInteractionIds, setPendingInteractionIds] = useState<Set<string>>(new Set());
  const [showSampleAnswer, setShowSampleAnswer] = useState(false);

  const drop = loadState.drop;
  const formattedDate = useMemo(() => formatDropDate(drop.drop_date), [drop.drop_date]);
  const allItems = useMemo(() => flattenDailyDropItems(drop), [drop]);
  const totalItemCount = allItems.length;
  const completedItemCount = useMemo(
    () =>
      allItems.filter((item) => interactionState.completedItemIds.has(item.id)).length,
    [allItems, interactionState.completedItemIds]
  );
  const completedModules = useMemo(
    () => getCompletedModules(drop, interactionState.completedItemIds),
    [drop, interactionState.completedItemIds]
  );
  const progress = totalItemCount > 0 ? completedItemCount / totalItemCount : 0;
  const isComplete = totalItemCount > 0 && completedItemCount === totalItemCount;

  useEffect(() => {
    let isMounted = true;

    async function loadTodayDrop() {
      setLoadState((currentState) => ({ ...currentState, status: "loading" }));
      setInteractionState(createEmptyContentInteractionSnapshot());
      setInteractionError(null);
      setInteractionMessage(null);

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

      if (result.source === "supabase") {
        const interactionResult = await readContentInteractionSnapshot(
          flattenDailyDropItems(result.data).map((item) => item.id)
        );

        if (!isMounted) {
          return;
        }

        if (interactionResult.ok) {
          setInteractionState(interactionResult.snapshot);
        } else {
          setInteractionError(interactionResult.error);
        }
      } else {
        setInteractionState(createEmptyContentInteractionSnapshot());
      }
    }

    void loadTodayDrop();

    return () => {
      isMounted = false;
    };
  }, [fallbackDrop]);

  async function handleInteraction(action: InteractionAction) {
    const pendingId = getPendingInteractionId(action);
    setPendingInteractionIds((currentIds) => new Set(currentIds).add(pendingId));
    setInteractionError(null);
    setInteractionMessage(null);

    if (loadState.source === "mock") {
      applyLocalInteraction(action);
      setInteractionMessage("Mock preview action saved locally.");
      setPendingInteractionIds((currentIds) => removeSetValue(currentIds, pendingId));
      return;
    }

    const result = await writeContentInteraction(action);

    setPendingInteractionIds((currentIds) => removeSetValue(currentIds, pendingId));

    if (!result.ok) {
      setInteractionError(result.error);
      return;
    }

    applyLocalInteraction(action);
    setInteractionMessage("Saved to your account.");
  }

  async function completeModule(items: DailyDropContentItem[]) {
    for (const item of items) {
      if (interactionState.completedItemIds.has(item.id)) {
        continue;
      }

      await handleInteraction({
        contentItemId: item.id,
        interactionType: "complete"
      });
    }
  }

  function applyLocalInteraction(action: InteractionAction) {
    setInteractionState((currentState) => {
      if (action.interactionType === "complete") {
        return {
          ...currentState,
          completedItemIds: new Set(currentState.completedItemIds).add(action.contentItemId)
        };
      }

      if (action.interactionType === "save") {
        return {
          ...currentState,
          savedItemIds: new Set(currentState.savedItemIds).add(action.contentItemId)
        };
      }

      if (action.interactionType === "feedback" && action.rating) {
        return {
          ...currentState,
          ratingsByItemId: {
            ...currentState.ratingsByItemId,
            [action.contentItemId]: action.rating
          }
        };
      }

      return currentState;
    });
  }

  function resetDrop() {
    setInteractionState(createEmptyContentInteractionSnapshot());
    setInteractionError(null);
    setInteractionMessage(null);
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
              label={loadState.source === "supabase" ? "LIVE" : "MOCK"}
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
              label={`${completedItemCount}/${totalItemCount} items`}
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
        <DropSlotOverview
          completedModules={completedModules}
          drop={drop}
          source={loadState.source}
        />
      </AppScreen.Header>

      <AppScreen.Body style={styles.body}>
        <InteractionStatus error={interactionError} message={interactionMessage} />
        <NewsletterSection
          articles={drop.items.newsletter}
          completed={completedModules.has("newsletter")}
          interactionState={interactionState}
          onComplete={() => completeModule(drop.items.newsletter)}
          onInteraction={handleInteraction}
          pendingInteractionIds={pendingInteractionIds}
        />
        <BusinessStorySection
          story={drop.items.business_story}
          completed={completedModules.has("business_story")}
          interactionState={interactionState}
          onComplete={() => completeModule([drop.items.business_story])}
          onInteraction={handleInteraction}
          pendingInteractionIds={pendingInteractionIds}
        />
        <MiniCaseSection
          challenge={drop.items.mini_case}
          completed={completedModules.has("mini_case")}
          interactionState={interactionState}
          showSampleAnswer={showSampleAnswer}
          onComplete={() => completeModule([drop.items.mini_case])}
          onInteraction={handleInteraction}
          onToggleSampleAnswer={() => setShowSampleAnswer((isVisible) => !isVisible)}
          pendingInteractionIds={pendingInteractionIds}
        />
        <ConceptSection
          concept={drop.items.concept}
          completed={completedModules.has("concept")}
          interactionState={interactionState}
          onComplete={() => completeModule([drop.items.concept])}
          onInteraction={handleInteraction}
          pendingInteractionIds={pendingInteractionIds}
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
      <Card padding="md" style={styles.stateCardLive} tone="accent">
        <View style={styles.stateHeader}>
          <ProgressPill label="LIVE FROM SUPABASE" tone="success" value={1} />
          <AppText color="accentInk" variant="caption">
            {formatShortDate(loadState.drop.drop_date)}
          </AppText>
        </View>
        <AppText color="accentInk" variant="bodyStrong">
          Showing the assigned daily drop for this user.
        </AppText>
        <AppText color="accentInk" variant="caption">
          Source: daily_drops + daily_drop_items + published content_items.
        </AppText>
      </Card>
    );
  }

  if (loadState.fallbackReason === "supabase_error") {
    return (
      <EmptyState
        description={`${loadState.error?.message ?? "Supabase is unavailable."} The app is still usable and is showing the built-in mock drop.`}
        eyebrow="MOCK FALLBACK"
        title="Supabase error while loading Today"
      />
    );
  }

  if (loadState.fallbackReason === "missing_supabase_config") {
    return (
      <EmptyState
        description={`${loadState.error?.message ?? "Supabase is not configured."} Add the Expo public Supabase env vars to load live assigned drops. The mock drop is shown for testing.`}
        eyebrow="MOCK FALLBACK"
        title="Live Today data is not configured"
      />
    );
  }

  if (loadState.fallbackReason === "no_supabase_data") {
    return (
      <EmptyState
        description="No published daily_drops row is assigned to this user for today. The mock drop is shown so the experience stays usable."
        eyebrow="MOCK FALLBACK"
        title="No assigned live drop today"
      />
    );
  }

  if (loadState.fallbackReason === "missing_auth_session") {
    return (
      <EmptyState
        description="Sign in to load a personalized Supabase drop. The mock drop keeps the app usable for now."
        eyebrow="MOCK FALLBACK"
        title="No active session"
      />
    );
  }

  return null;
}

function InteractionStatus({
  error,
  message
}: {
  error: NormalizedSupabaseError | null;
  message: string | null;
}) {
  if (error) {
    return (
      <Card padding="md" style={styles.interactionError}>
        <AppText color="danger" variant="label">
          Could not save interaction
        </AppText>
        <AppText color="muted" variant="caption">
          {error.message}
        </AppText>
        {error.hint ? (
          <AppText color="muted" variant="caption">
            {error.hint}
          </AppText>
        ) : null}
      </Card>
    );
  }

  if (message) {
    return (
      <Card padding="md" style={styles.interactionMessage}>
        <AppText color="success" variant="caption">
          {message}
        </AppText>
      </Card>
    );
  }

  return null;
}

function DropSlotOverview({
  completedModules,
  drop,
  source
}: {
  completedModules: Set<ModuleId>;
  drop: TodayDailyDrop;
  source: DataFetchSource;
}) {
  return (
    <Card padding="md" style={styles.slotOverview}>
      <View style={styles.slotOverviewHeader}>
        <AppText variant="bodyStrong">Four-slot daily drop</AppText>
        <ProgressPill
          label={source === "supabase" ? "Live content" : "Mock content"}
          tone={source === "supabase" ? "success" : "neutral"}
        />
      </View>
      {moduleOrder.map((moduleId) => (
        <SlotOverviewRow
          completed={completedModules.has(moduleId)}
          count={getModuleItemCount(drop, moduleId)}
          key={moduleId}
          moduleId={moduleId}
        />
      ))}
    </Card>
  );
}

function SlotOverviewRow({
  completed,
  count,
  moduleId
}: {
  completed: boolean;
  count: number;
  moduleId: ModuleId;
}) {
  return (
    <View style={styles.slotOverviewRow}>
      <View style={styles.slotOverviewCopy}>
        <AppText variant="label">{moduleLabels[moduleId]}</AppText>
        <AppText color="muted" variant="caption">
          {moduleDescriptions[moduleId]}
        </AppText>
      </View>
      <View style={styles.slotOverviewMeta}>
        <AppText color="muted" variant="caption">
          {count} item{count === 1 ? "" : "s"}
        </AppText>
        <ProgressPill
          label={completed ? "Done" : "Ready"}
          tone={completed ? "success" : "neutral"}
        />
      </View>
    </View>
  );
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
  interactionState,
  onComplete,
  onInteraction,
  pendingInteractionIds
}: {
  articles: NewsletterArticle[];
  completed: boolean;
  interactionState: InteractionState;
  onComplete: () => void;
  onInteraction: (action: InteractionAction) => Promise<void>;
  pendingInteractionIds: Set<string>;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader
        description="A short, sourced scan of the topics selected for today's drop."
        eyebrow="Newsletter"
        title="Signals worth knowing"
      />
      {articles.length > 0 ? (
        <>
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
              <NewsletterArticlePreview
                article={article}
                interactionState={interactionState}
                key={article.id}
                onInteraction={onInteraction}
                pendingInteractionIds={pendingInteractionIds}
              />
            ))}
          </View>
          <SectionCompleteButton completed={completed} label="Mark newsletter read" onComplete={onComplete} />
        </>
      ) : (
        <EmptyState
          description="This assigned drop has no linked newsletter_article items. The other daily modules are still available."
          eyebrow="Newsletter"
          title="Newsletter slot is empty"
        />
      )}
    </View>
  );
}

function NewsletterArticlePreview({
  article,
  interactionState,
  onInteraction,
  pendingInteractionIds
}: {
  article: NewsletterArticle;
  interactionState: InteractionState;
  onInteraction: (action: InteractionAction) => Promise<void>;
  pendingInteractionIds: Set<string>;
}) {
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
      <ContentMetaRow item={article} topicLabel={topicLabels[article.topic]} />
      <AppText variant="body">{article.summary}</AppText>
      <View style={styles.callout}>
        <AppText color="accentInk" variant="caption">
          Why it matters
        </AppText>
        <AppText variant="body">{article.why_it_matters}</AppText>
      </View>
      <SourceLine item={article} sources={sources} />
      <ContentInteractionControls
        item={article}
        interactionState={interactionState}
        onInteraction={onInteraction}
        pendingInteractionIds={pendingInteractionIds}
      />
    </Card>
  );
}

function BusinessStorySection({
  story,
  completed,
  interactionState,
  onComplete,
  onInteraction,
  pendingInteractionIds
}: {
  story: BusinessStory;
  completed: boolean;
  interactionState: InteractionState;
  onComplete: () => void;
  onInteraction: (action: InteractionAction) => Promise<void>;
  pendingInteractionIds: Set<string>;
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
        <AppText variant="bodyStrong">{story.title}</AppText>
        <ContentMetaRow item={story} topicLabel={story.company_or_market} />
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
        <ContentInteractionControls
          item={story}
          interactionState={interactionState}
          onInteraction={onInteraction}
          pendingInteractionIds={pendingInteractionIds}
        />
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
  interactionState,
  showSampleAnswer,
  onComplete,
  onInteraction,
  onToggleSampleAnswer,
  pendingInteractionIds
}: {
  challenge: MiniCaseChallenge;
  completed: boolean;
  interactionState: InteractionState;
  showSampleAnswer: boolean;
  onComplete: () => void;
  onInteraction: (action: InteractionAction) => Promise<void>;
  onToggleSampleAnswer: () => void;
  pendingInteractionIds: Set<string>;
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
        <AppText variant="bodyStrong">{challenge.title}</AppText>
        <ContentMetaRow item={challenge} topicLabel={topicLabels[challenge.topic]} />
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
        <ContentInteractionControls
          item={challenge}
          interactionState={interactionState}
          onInteraction={onInteraction}
          pendingInteractionIds={pendingInteractionIds}
        />
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
  interactionState,
  onComplete,
  onInteraction,
  pendingInteractionIds
}: {
  concept: KeyConcept;
  completed: boolean;
  interactionState: InteractionState;
  onComplete: () => void;
  onInteraction: (action: InteractionAction) => Promise<void>;
  pendingInteractionIds: Set<string>;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader
        description="One reusable idea for class, interviews, or serious conversations."
        eyebrow="Key concept"
        title={concept.title}
      />
      <Card padding="lg">
        <AppText variant="bodyStrong">{concept.title}</AppText>
        <ContentMetaRow item={concept} topicLabel={getConceptTopicLabel(concept)} />
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
        <ContentInteractionControls
          item={concept}
          interactionState={interactionState}
          onInteraction={onInteraction}
          pendingInteractionIds={pendingInteractionIds}
        />
      </Card>
      <SectionCompleteButton completed={completed} label="Save concept for today" onComplete={onComplete} />
    </View>
  );
}

function ContentMetaRow({
  item,
  topicLabel
}: {
  item: DailyDropContentItem;
  topicLabel: string;
}) {
  return (
    <View style={styles.contentMetaRow}>
      <ProgressPill label={topicLabel} tone="accent" />
      <ProgressPill label={`${estimateItemReadMinutes(item)} min`} tone="neutral" />
      <ProgressPill
        label={`${getSourceCount(item)} source${getSourceCount(item) === 1 ? "" : "s"}`}
        tone="neutral"
      />
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

function ContentInteractionControls({
  item,
  interactionState,
  onInteraction,
  pendingInteractionIds
}: {
  item: DailyDropContentItem;
  interactionState: InteractionState;
  onInteraction: (action: InteractionAction) => Promise<void>;
  pendingInteractionIds: Set<string>;
}) {
  const isCompleted = interactionState.completedItemIds.has(item.id);
  const isSaved = interactionState.savedItemIds.has(item.id);
  const activeRating = interactionState.ratingsByItemId[item.id];
  const completionPending = pendingInteractionIds.has(
    getPendingInteractionId({
      contentItemId: item.id,
      interactionType: "complete"
    })
  );
  const savePending = pendingInteractionIds.has(
    getPendingInteractionId({
      contentItemId: item.id,
      interactionType: "save"
    })
  );

  return (
    <View style={styles.interactionControls}>
      {isCompleted || isSaved || activeRating ? (
        <View style={styles.interactionStateRow}>
          {isCompleted ? <ProgressPill label="Completed" tone="success" value={1} /> : null}
          {isSaved ? <ProgressPill label="Saved" tone="accent" /> : null}
          {activeRating ? (
            <ProgressPill label={`Rated ${formatRatingLabel(activeRating)}`} tone="neutral" />
          ) : null}
        </View>
      ) : null}
      <View style={styles.interactionButtonRow}>
        <SecondaryButton
          disabled={isCompleted || completionPending}
          label={isCompleted ? "Completed" : completionPending ? "Completing" : "Complete"}
          onPress={() =>
            onInteraction({
              contentItemId: item.id,
              interactionType: "complete"
            })
          }
          style={styles.interactionButton}
        />
        <SecondaryButton
          disabled={isSaved || savePending}
          label={isSaved ? "Saved" : savePending ? "Saving" : "Save"}
          onPress={() =>
            onInteraction({
              contentItemId: item.id,
              interactionType: "save"
            })
          }
          style={styles.interactionButton}
        />
      </View>
      <View style={styles.feedbackGroup}>
        <AppText color="muted" variant="caption">
          Rate this
        </AppText>
        <View style={styles.feedbackButtons}>
          {(["good", "average", "bad"] as const).map((rating) => {
            const active = activeRating === rating;
            const pending = pendingInteractionIds.has(
              getPendingInteractionId({
                contentItemId: item.id,
                interactionType: "feedback",
                rating
              })
            );

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active, busy: pending }}
                disabled={pending}
                key={rating}
                onPress={() =>
                  onInteraction({
                    contentItemId: item.id,
                    interactionType: "feedback",
                    rating
                  })
                }
                style={({ pressed }) => [
                  styles.feedbackButton,
                  active ? styles.feedbackButtonActive : null,
                  pressed && !pending ? styles.feedbackButtonPressed : null
                ]}
              >
                <AppText color={active ? "accentInk" : "inkSoft"} variant="caption">
                  {formatRatingLabel(rating)}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>
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

function getModuleItemCount(drop: TodayDailyDrop, moduleId: ModuleId) {
  return getModuleItems(drop, moduleId).length;
}

function getCompletedModules(
  drop: TodayDailyDrop,
  completedItemIds: Set<string>
): Set<ModuleId> {
  return new Set(
    moduleOrder.filter((moduleId) => {
      const moduleItems = getModuleItems(drop, moduleId);

      return (
        moduleItems.length > 0 &&
        moduleItems.every((item) => completedItemIds.has(item.id))
      );
    })
  );
}

function getModuleItems(
  drop: TodayDailyDrop,
  moduleId: ModuleId
): DailyDropContentItem[] {
  if (moduleId === "newsletter") {
    return drop.items.newsletter;
  }

  return [drop.items[moduleId]];
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

function getConceptTopicLabel(concept: KeyConcept) {
  return concept.category === "career" ? "Career" : topicLabels[concept.category];
}

function estimateItemReadMinutes(item: DailyDropContentItem) {
  const words = getReadableText(item).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

function getReadableText(item: DailyDropContentItem) {
  if (item.content_type === "newsletter_article") {
    return [item.title, item.summary, item.body_md, item.why_it_matters].join(" ");
  }

  if (item.content_type === "business_story") {
    return [
      item.title,
      item.setup,
      item.tension,
      item.decision,
      item.outcome,
      item.lesson
    ].join(" ");
  }

  if (item.content_type === "mini_case") {
    return [
      item.title,
      item.context,
      item.challenge,
      item.question,
      item.constraints.join(" "),
      item.sample_answer
    ].join(" ");
  }

  return [
    item.title,
    item.definition,
    item.plain_english,
    item.example,
    item.why_it_matters,
    item.how_to_use_it,
    item.common_mistake
  ].join(" ");
}

function getPendingInteractionId({
  contentItemId,
  interactionType,
  rating
}: InteractionAction) {
  return `${contentItemId}:${interactionType}:${rating ?? "none"}`;
}

function removeSetValue<T>(set: Set<T>, value: T) {
  const nextSet = new Set(set);
  nextSet.delete(value);
  return nextSet;
}

function formatRatingLabel(rating: ContentRating) {
  if (rating === "good") {
    return "Good";
  }

  if (rating === "average") {
    return "Average";
  }

  return "Bad";
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
  stateCardLive: {
    gap: tokens.space.sm
  },
  stateHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  },
  slotOverview: {
    gap: tokens.space.md
  },
  slotOverviewHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  },
  slotOverviewRow: {
    alignItems: "center",
    borderTopColor: tokens.color.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between",
    paddingTop: tokens.space.md
  },
  slotOverviewCopy: {
    flex: 1,
    gap: tokens.space.xs
  },
  slotOverviewMeta: {
    alignItems: "flex-end",
    gap: tokens.space.xs
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
  interactionError: {
    backgroundColor: tokens.color.dangerSoft,
    borderColor: tokens.color.danger
  },
  interactionMessage: {
    backgroundColor: tokens.color.successSoft,
    borderColor: tokens.color.success
  },
  section: {
    borderTopColor: tokens.color.border,
    borderTopWidth: 1,
    gap: tokens.space.md,
    paddingTop: tokens.space.xl
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
  contentMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.sm
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
  interactionControls: {
    borderTopColor: tokens.color.border,
    borderTopWidth: 1,
    gap: tokens.space.md,
    paddingTop: tokens.space.md
  },
  interactionStateRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.sm
  },
  interactionButtonRow: {
    flexDirection: "row",
    gap: tokens.space.sm
  },
  interactionButton: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm
  },
  feedbackGroup: {
    gap: tokens.space.sm
  },
  feedbackButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.sm
  },
  feedbackButton: {
    backgroundColor: tokens.color.surface,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    minHeight: 34,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm
  },
  feedbackButtonActive: {
    backgroundColor: tokens.color.accentSoft,
    borderColor: tokens.color.accent
  },
  feedbackButtonPressed: {
    backgroundColor: tokens.color.surfaceMuted
  },
  completionCard: {
    gap: tokens.space.md
  },
  resetLink: {
    alignSelf: "flex-start",
    paddingVertical: tokens.space.xs
  }
});
