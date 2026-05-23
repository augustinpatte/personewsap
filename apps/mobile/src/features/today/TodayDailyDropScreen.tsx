import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import {
  AppScreen,
  AppText,
  Card,
  DataModeBanner,
  EmptyState,
  PrimaryButton,
  ProgressPill,
  SecondaryButton,
  SectionHeader
} from "../../components";
import { TOPICS, type TopicId } from "../../constants/product";
import { tokens } from "../../design/tokens";
import { useAuth } from "../auth";
import type { DataFallbackReason, DataFetchSource } from "../../lib/dataState";
import { trackAnalyticsEvent } from "../../lib/analytics";
import { localized } from "../../lib/i18n";
import { getAuthSession, type NormalizedSupabaseError } from "../../lib/supabase";
import { getUserFacingError } from "../../lib/userFacingErrors";
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

export function TodayDailyDropScreen() {
  const { profileLanguage } = useAuth();
  const activeLanguage = profileLanguage ?? "en";
  const copy = getTodayCopy(activeLanguage);
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
  const [openedItemIds, setOpenedItemIds] = useState<Set<string>>(new Set());
  const [pendingInteractionIds, setPendingInteractionIds] = useState<Set<string>>(new Set());
  const [showSampleAnswer, setShowSampleAnswer] = useState(false);

  const drop = loadState.drop;
  const formattedDate = useMemo(
    () => formatDropDate(drop.drop_date, activeLanguage),
    [activeLanguage, drop.drop_date]
  );
  const allItems = useMemo(() => flattenDailyDropItems(drop), [drop]);
  const totalItemCount = allItems.length;
  const isEmptyDrop = totalItemCount === 0;
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

  const loadTodayDrop = useCallback(
    async (isActive: () => boolean = () => true) => {
      setLoadState((currentState) => ({ ...currentState, status: "loading" }));
      setInteractionError(null);
      setInteractionMessage(null);

      const sessionResult = await getAuthSession();
      const userId = sessionResult.data?.user.id;

      if (!userId) {
        if (isActive()) {
          setLoadState({
            drop: fallbackDrop,
            error: sessionResult.error,
            fallbackReason: "missing_auth_session",
            source: "mock",
            status: "ready"
          });
          setInteractionState(createEmptyContentInteractionSnapshot());
        }

        return;
      }

      const result = await fetchTodayDrop(userId, getLocalDropDate(new Date()), {
        language: activeLanguage
      });

      if (isActive()) {
        setLoadState({
          drop: result.data,
          error: result.error,
          fallbackReason: result.fallbackReason,
          source: result.source,
          status: "ready"
        });
        trackAnalyticsEvent("daily_drop_loaded", getDropAnalyticsProperties(result.data));

        if (result.fallbackReason === "no_supabase_data") {
          trackAnalyticsEvent("daily_drop_empty", getDropAnalyticsProperties(result.data));
        }
      }

      if (result.source === "supabase" || result.source === "cache") {
        const interactionResult = await readContentInteractionSnapshot(
          flattenDailyDropItems(result.data).map((item) => item.id)
        );

        if (!isActive()) {
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
    },
    [activeLanguage, fallbackDrop]
  );

  useEffect(() => {
    let isMounted = true;

    void loadTodayDrop(() => isMounted);

    return () => {
      isMounted = false;
    };
  }, [loadTodayDrop]);

  useEffect(() => {
    if (loadState.status === "ready" && loadState.error) {
      trackAnalyticsEvent("error_viewed", getDropAnalyticsProperties(drop));
    }
  }, [drop, loadState.error, loadState.status]);

  useEffect(() => {
    if (interactionError) {
      trackAnalyticsEvent("error_viewed", getDropAnalyticsProperties(drop));
    }
  }, [drop, interactionError]);

  async function handleInteraction(action: InteractionAction) {
    const pendingId = getPendingInteractionId(action);
    const item = allItems.find((candidate) => candidate.id === action.contentItemId);

    trackContentItemOpened(item);
    setPendingInteractionIds((currentIds) => new Set(currentIds).add(pendingId));
    setInteractionError(null);
    setInteractionMessage(null);

    if (loadState.source === "mock") {
      applyLocalInteraction(action);
      trackContentInteractionEvent(action, item);
      setInteractionMessage(copy.previewActionMarked);
      setPendingInteractionIds((currentIds) => removeSetValue(currentIds, pendingId));
      return;
    }

    const result = await writeContentInteraction(action);

    setPendingInteractionIds((currentIds) => removeSetValue(currentIds, pendingId));

    if (!result.ok) {
      applyLocalInteraction(action);
      trackContentInteractionEvent(action, item);
      setInteractionError(result.error);
      setInteractionMessage(copy.localSaveOnly);
      return;
    }

    applyLocalInteraction(action);
    trackContentInteractionEvent(action, item);
    setInteractionMessage(copy.savedToAccount);
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
    setOpenedItemIds(new Set());
    setShowSampleAnswer(false);
  }

  function trackContentItemOpened(item: DailyDropContentItem | undefined) {
    if (!item || openedItemIds.has(item.id)) {
      return;
    }

    setOpenedItemIds((currentIds) => new Set(currentIds).add(item.id));
    trackAnalyticsEvent("content_item_opened", getItemAnalyticsProperties(item, drop));
  }

  function trackContentInteractionEvent(
    action: InteractionAction,
    item: DailyDropContentItem | undefined
  ) {
    if (!item) {
      return;
    }

    if (action.interactionType === "complete") {
      trackAnalyticsEvent("content_item_completed", getItemAnalyticsProperties(item, drop));
      return;
    }

    if (action.interactionType === "save") {
      trackAnalyticsEvent("content_item_saved", getItemAnalyticsProperties(item, drop));
    }
  }

  return (
    <AppScreen
      contentStyle={styles.screenContent}
      scrollViewProps={{
        accessibilityLabel: copy.accessibilityLabel
      }}
    >
      <AppScreen.Header style={styles.header}>
        <View style={styles.headerTopline}>
          <AppText variant="eyebrow">{copy.eyebrow}</AppText>
          <View style={styles.headerMeta}>
            <ProgressPill
              label={getDataModeLabel(loadState.source, activeLanguage)}
              tone={getDataModeTone(loadState.source)}
            />
            <AppText color="muted" variant="caption">
              {formattedDate}
            </AppText>
          </View>
        </View>
        <View style={styles.headerCopy}>
          <AppText variant="title">{copy.title}</AppText>
          <AppText variant="body">
            {copy.description}
          </AppText>
        </View>
        <Card padding="md" style={styles.progressCard} tone={isComplete ? "accent" : "default"}>
          <View style={styles.progressTopline}>
            <ProgressPill
              label={copy.itemProgress(completedItemCount, totalItemCount)}
              tone={isComplete ? "success" : "accent"}
              value={progress}
            />
            <AppText color="muted" variant="caption">
              {copy.minuteSession(drop.estimated_read_minutes)}
            </AppText>
          </View>
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <AppText color={isComplete ? "accentInk" : "muted"} variant="caption">
            {isComplete
              ? copy.completeMessage
              : copy.incompleteMessage}
          </AppText>
        </Card>
        <TodayDataStateBanner
          language={activeLanguage}
          loadState={loadState}
          onRetry={() => {
            void loadTodayDrop();
          }}
        />
        <DailyRitualCard language={activeLanguage} />
        <DropSlotOverview
          completedModules={completedModules}
          drop={drop}
          language={activeLanguage}
          source={loadState.source}
        />
      </AppScreen.Header>

      <AppScreen.Body style={styles.body}>
        <InteractionStatus
          error={interactionError}
          language={drop.language}
          message={interactionMessage}
        />
        {isEmptyDrop ? (
          <EmptyState
            actionLabel={copy.checkAgain}
            description={copy.emptyDropDescription}
            eyebrow={copy.emptyDropEyebrow}
            onActionPress={() => {
              void loadTodayDrop();
            }}
            title={copy.emptyDropTitle}
          />
        ) : (
          <>
            {drop.items.newsletter.length > 0 ? (
              <NewsletterSection
                articles={drop.items.newsletter}
                completed={completedModules.has("newsletter")}
                interactionState={interactionState}
                language={activeLanguage}
                onComplete={() => completeModule(drop.items.newsletter)}
                onInteraction={handleInteraction}
                pendingInteractionIds={pendingInteractionIds}
              />
            ) : null}
            {drop.items.business_story ? (
              <BusinessStorySection
                story={drop.items.business_story}
                completed={completedModules.has("business_story")}
                interactionState={interactionState}
                language={activeLanguage}
                onComplete={() => {
                  if (drop.items.business_story) {
                    void completeModule([drop.items.business_story]);
                  }
                }}
                onInteraction={handleInteraction}
                pendingInteractionIds={pendingInteractionIds}
              />
            ) : null}
            {drop.items.mini_case ? (
              <MiniCaseSection
                challenge={drop.items.mini_case}
                completed={completedModules.has("mini_case")}
                interactionState={interactionState}
                language={activeLanguage}
                showSampleAnswer={showSampleAnswer}
                onComplete={() => {
                  if (drop.items.mini_case) {
                    void completeModule([drop.items.mini_case]);
                  }
                }}
                onInteraction={handleInteraction}
                onToggleSampleAnswer={() => setShowSampleAnswer((isVisible) => !isVisible)}
                pendingInteractionIds={pendingInteractionIds}
              />
            ) : null}
            {drop.items.concept ? (
              <ConceptSection
                concept={drop.items.concept}
                completed={completedModules.has("concept")}
                interactionState={interactionState}
                language={activeLanguage}
                onComplete={() => {
                  if (drop.items.concept) {
                    void completeModule([drop.items.concept]);
                  }
                }}
                onInteraction={handleInteraction}
                pendingInteractionIds={pendingInteractionIds}
              />
            ) : null}
            <CompletionState
              allItems={allItems}
              isComplete={isComplete}
              language={activeLanguage}
              onReset={resetDrop}
            />
          </>
        )}
      </AppScreen.Body>
    </AppScreen>
  );
}

function TodayDataStateBanner({
  language,
  loadState,
  onRetry
}: {
  language: ContentLanguage;
  loadState: TodayLoadState;
  onRetry: () => void;
}) {
  const copy = getTodayCopy(language);

  if (loadState.status === "loading") {
    return (
      <DataModeBanner
        description={copy.loadingDropDescription}
        mode="checking"
        statusLabel={copy.checkingStatus}
        title={copy.loadingDropTitle}
      />
    );
  }

  if (loadState.source === "supabase") {
    return (
      <DataModeBanner
        description={copy.liveDropDescription}
        detail={formatShortDate(loadState.drop.drop_date, language)}
        mode="live"
        statusLabel={copy.readyStatus}
        title={copy.liveDropTitle}
      />
    );
  }

  if (loadState.source === "cache") {
    return (
      <DataModeBanner
        actionLabel={copy.retryLiveData}
        description={copy.cachedDropDescription}
        detail={formatShortDate(loadState.drop.drop_date, language)}
        mode="cache"
        onActionPress={onRetry}
        statusLabel={copy.savedCopyStatus}
        title={copy.cachedDropTitle}
      />
    );
  }

  if (loadState.fallbackReason === "network_unavailable") {
    const userFacingError = getUserFacingError(loadState.error, language, "today");

    return (
      <DataModeBanner
        actionLabel={copy.retryLiveData}
        description={`${userFacingError.message} ${copy.previewFallback}`}
        mode="preview"
        onActionPress={onRetry}
        statusLabel={copy.sampleStatus}
        title={userFacingError.title}
      />
    );
  }

  if (loadState.fallbackReason === "supabase_error") {
    const userFacingError = getUserFacingError(loadState.error, language, "today");

    return (
      <DataModeBanner
        actionLabel={copy.retryLiveData}
        description={`${userFacingError.message} ${copy.previewFallback}`}
        mode="preview"
        onActionPress={onRetry}
        statusLabel={copy.sampleStatus}
        title={userFacingError.title}
      />
    );
  }

  if (loadState.fallbackReason === "missing_supabase_config") {
    const userFacingError = getUserFacingError(loadState.error, language, "today");

    return (
      <DataModeBanner
        actionLabel={copy.retryLiveData}
        description={`${userFacingError.message} ${copy.previewFallback}`}
        mode="preview"
        onActionPress={onRetry}
        statusLabel={copy.sampleStatus}
        title={userFacingError.title}
      />
    );
  }

  if (loadState.fallbackReason === "no_supabase_data") {
    return (
      <DataModeBanner
        actionLabel={copy.checkAgain}
        description={copy.noLiveDropDescription}
        detail={copy.languageName}
        mode="preview"
        onActionPress={onRetry}
        statusLabel={copy.sampleStatus}
        title={copy.noLiveDropTitle}
      />
    );
  }

  if (loadState.fallbackReason === "missing_auth_session") {
    return (
      <DataModeBanner
        actionLabel={copy.retrySessionCheck}
        description={copy.noSessionDescription}
        mode="preview"
        onActionPress={onRetry}
        statusLabel={copy.sampleStatus}
        title={copy.noSessionTitle}
      />
    );
  }

  return null;
}

function DailyRitualCard({ language }: { language: ContentLanguage }) {
  const copy = getTodayCopy(language);

  return (
    <Card padding="md" style={styles.ritualCard}>
      <AppText variant="bodyStrong">{copy.ritualTitle}</AppText>
      <View style={styles.ritualSteps}>
        {copy.ritualSteps.map((step, index) => (
          <RitualStep key={step} number={`${index + 1}`} text={step} />
        ))}
      </View>
    </Card>
  );
}

function RitualStep({ number, text }: { number: string; text: string }) {
  return (
    <View style={styles.ritualStep}>
      <View style={styles.ritualStepNumber}>
        <AppText color="accentInk" variant="caption">
          {number}
        </AppText>
      </View>
      <AppText style={styles.ritualStepText} variant="caption">
        {text}
      </AppText>
    </View>
  );
}

function InteractionStatus({
  error,
  language,
  message
}: {
  error: NormalizedSupabaseError | null;
  language: ContentLanguage;
  message: string | null;
}) {
  if (error) {
    const userFacingError = getUserFacingError(error, language, "today");

    return (
      <Card padding="md" style={styles.interactionError}>
        <AppText color="danger" variant="label">
          {userFacingError.title}
        </AppText>
        <AppText color="muted" variant="caption">
          {userFacingError.message}
        </AppText>
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
  language,
  source
}: {
  completedModules: Set<ModuleId>;
  drop: TodayDailyDrop;
  language: ContentLanguage;
  source: DataFetchSource;
}) {
  const copy = getTodayCopy(language);

  return (
    <Card padding="md" style={styles.slotOverview}>
      <View style={styles.slotOverviewHeader}>
        <AppText variant="bodyStrong">{copy.slotOverviewTitle}</AppText>
        <ProgressPill
          label={getContentModeLabel(source, language)}
          tone={getDataModeTone(source)}
        />
      </View>
      {moduleOrder.filter((moduleId) => getModuleItemCount(drop, moduleId) > 0).map((moduleId) => (
        <SlotOverviewRow
          completed={completedModules.has(moduleId)}
          count={getModuleItemCount(drop, moduleId)}
          key={moduleId}
          language={language}
          moduleId={moduleId}
        />
      ))}
    </Card>
  );
}

function SlotOverviewRow({
  completed,
  count,
  language,
  moduleId
}: {
  completed: boolean;
  count: number;
  language: ContentLanguage;
  moduleId: ModuleId;
}) {
  const copy = getTodayCopy(language);

  return (
    <View style={styles.slotOverviewRow}>
      <View style={styles.slotOverviewCopy}>
        <AppText variant="label">{copy.modules[moduleId].label}</AppText>
        <AppText color="muted" variant="caption">
          {copy.modules[moduleId].description}
        </AppText>
      </View>
      <View style={styles.slotOverviewMeta}>
        <AppText color="muted" variant="caption">
          {copy.itemCount(count)}
        </AppText>
        <ProgressPill
          label={completed ? copy.done : copy.ready}
          tone={completed ? "success" : "neutral"}
        />
      </View>
    </View>
  );
}

type SectionCompleteButtonProps = {
  completed: boolean;
  language: ContentLanguage;
  label: string;
  onComplete: () => void;
};

function SectionCompleteButton({ completed, language, label, onComplete }: SectionCompleteButtonProps) {
  const copy = getTodayCopy(language);

  if (completed) {
    return <ProgressPill label={copy.completed} tone="success" value={1} />;
  }

  return <SecondaryButton label={label} onPress={onComplete} style={styles.sectionButton} />;
}

function NewsletterSection({
  articles,
  completed,
  interactionState,
  language,
  onComplete,
  onInteraction,
  pendingInteractionIds
}: {
  articles: NewsletterArticle[];
  completed: boolean;
  interactionState: InteractionState;
  language: ContentLanguage;
  onComplete: () => void;
  onInteraction: (action: InteractionAction) => Promise<void>;
  pendingInteractionIds: Set<string>;
}) {
  const copy = getTodayCopy(language);

  return (
    <View style={styles.section}>
      <SectionHeader
        description={copy.newsletterDescription}
        eyebrow={copy.modules.newsletter.label}
        title={copy.newsletterTitle}
      />
      {articles.length > 0 ? (
        <>
          <View style={styles.topicGrid}>
            {articles.map((article) => (
              <View key={article.id} style={styles.topicCard}>
                <AppText color="accentInk" variant="label">
                  {getNewsletterTopicLabel(article.topic, language)}
                </AppText>
                <AppText color="muted" variant="caption">
                  {copy.sourceCount(getSourceCount(article))}
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
                language={language}
                onInteraction={onInteraction}
                pendingInteractionIds={pendingInteractionIds}
              />
            ))}
          </View>
          <SectionCompleteButton completed={completed} language={language} label={copy.markNewsletterRead} onComplete={onComplete} />
        </>
      ) : (
        <EmptyState
          description={copy.newsletterEmptyDescription}
          eyebrow={copy.modules.newsletter.label}
          title={copy.newsletterEmptyTitle}
        />
      )}
    </View>
  );
}

function NewsletterArticlePreview({
  article,
  interactionState,
  language,
  onInteraction,
  pendingInteractionIds
}: {
  article: NewsletterArticle;
  interactionState: InteractionState;
  language: ContentLanguage;
  onInteraction: (action: InteractionAction) => Promise<void>;
  pendingInteractionIds: Set<string>;
}) {
  const copy = getTodayCopy(language);

  return (
    <Card padding="md" style={styles.articleCard}>
      <View style={styles.cardHeaderRow}>
        <AppText color="accent" variant="caption">
          {getNewsletterTopicLabel(article.topic, language)}
        </AppText>
      </View>
      <AppText variant="bodyStrong">{article.title}</AppText>
      <ContentMetaRow item={article} language={language} topicLabel={getNewsletterTopicLabel(article.topic, language)} />
      <AppText variant="body">{article.summary}</AppText>
      <View style={styles.callout}>
        <AppText color="accentInk" variant="caption">
          {copy.whyItMatters}
        </AppText>
        <AppText variant="body">{article.why_it_matters}</AppText>
      </View>
      <SourceLine item={article} language={language} />
      <ContentInteractionControls
        item={article}
        interactionState={interactionState}
        language={language}
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
  language,
  onComplete,
  onInteraction,
  pendingInteractionIds
}: {
  story: BusinessStory;
  completed: boolean;
  interactionState: InteractionState;
  language: ContentLanguage;
  onComplete: () => void;
  onInteraction: (action: InteractionAction) => Promise<void>;
  pendingInteractionIds: Set<string>;
}) {
  const copy = getTodayCopy(language);

  return (
    <View style={styles.section}>
      <SectionHeader
        description={copy.businessStoryDescription}
        eyebrow={copy.modules.business_story.label}
        title={story.title}
      />
      <Card padding="lg">
        <View style={styles.cardHeaderRow}>
          <AppText color="accent" variant="caption">
            {story.company_or_market}
          </AppText>
          <AppText color="muted" variant="caption">
            {formatShortDate(story.story_date, language)}
          </AppText>
        </View>
        <AppText variant="bodyStrong">{story.title}</AppText>
        <ContentMetaRow item={story} language={language} topicLabel={story.company_or_market} />
        <StoryBeat label={copy.storySetup} text={story.setup} />
        <StoryBeat label={copy.storyTension} text={story.tension} />
        <StoryBeat label={copy.storyDecision} text={story.decision} />
        <StoryBeat label={copy.storyOutcome} text={story.outcome} />
        <View style={styles.lessonBox}>
          <AppText color="accentInk" variant="label">
            {copy.lesson}
          </AppText>
          <AppText variant="bodyStrong">{story.lesson}</AppText>
        </View>
        <SourceLine item={story} language={language} />
        <ContentInteractionControls
          item={story}
          interactionState={interactionState}
          language={language}
          onInteraction={onInteraction}
          pendingInteractionIds={pendingInteractionIds}
        />
      </Card>
      <SectionCompleteButton completed={completed} language={language} label={copy.markStoryComplete} onComplete={onComplete} />
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
  language,
  showSampleAnswer,
  onComplete,
  onInteraction,
  onToggleSampleAnswer,
  pendingInteractionIds
}: {
  challenge: MiniCaseChallenge;
  completed: boolean;
  interactionState: InteractionState;
  language: ContentLanguage;
  showSampleAnswer: boolean;
  onComplete: () => void;
  onInteraction: (action: InteractionAction) => Promise<void>;
  onToggleSampleAnswer: () => void;
  pendingInteractionIds: Set<string>;
}) {
  const copy = getTodayCopy(language);

  return (
    <View style={styles.section}>
      <SectionHeader
        description={copy.miniCaseDescription}
        eyebrow={copy.modules.mini_case.label}
        title={challenge.title}
      />
      <Card padding="lg" tone="muted">
        <View style={styles.cardHeaderRow}>
          <ProgressPill label={challenge.difficulty} tone="warning" />
          <AppText color="muted" variant="caption">
            {getMiniCaseTopicLabel(challenge.topic, language)}
          </AppText>
        </View>
        <AppText variant="bodyStrong">{challenge.title}</AppText>
        <ContentMetaRow item={challenge} language={language} topicLabel={getMiniCaseTopicLabel(challenge.topic, language)} />
        <AppText variant="body">{challenge.context}</AppText>
        <View style={styles.challengeBox}>
          <AppText color="accentInk" variant="label">
            {copy.challenge}
          </AppText>
          <AppText variant="bodyStrong">{challenge.challenge}</AppText>
          <AppText variant="body">{challenge.question}</AppText>
        </View>
        <View style={styles.bulletGroup}>
          <AppText color="muted" variant="caption">
            {copy.constraints}
          </AppText>
          {challenge.constraints.map((constraint) => (
            <BulletText key={constraint}>{constraint}</BulletText>
          ))}
        </View>
        {showSampleAnswer ? (
          <View style={styles.sampleAnswer}>
            <AppText color="accentInk" variant="label">
              {copy.sampleAnswer}
            </AppText>
            <AppText variant="body">{challenge.sample_answer}</AppText>
          </View>
        ) : null}
        <ContentInteractionControls
          item={challenge}
          interactionState={interactionState}
          language={language}
          onInteraction={onInteraction}
          pendingInteractionIds={pendingInteractionIds}
        />
        <SourceLine item={challenge} language={language} />
        <View style={styles.buttonRow}>
          <SecondaryButton
            label={showSampleAnswer ? copy.hideSample : copy.showSample}
            onPress={onToggleSampleAnswer}
            style={styles.flexButton}
          />
          <PrimaryButton
            disabled={completed}
            label={completed ? copy.completed : copy.markDone}
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
  language,
  onComplete,
  onInteraction,
  pendingInteractionIds
}: {
  concept: KeyConcept;
  completed: boolean;
  interactionState: InteractionState;
  language: ContentLanguage;
  onComplete: () => void;
  onInteraction: (action: InteractionAction) => Promise<void>;
  pendingInteractionIds: Set<string>;
}) {
  const copy = getTodayCopy(language);

  return (
    <View style={styles.section}>
      <SectionHeader
        description={copy.conceptDescription}
        eyebrow={copy.modules.concept.label}
        title={concept.title}
      />
      <Card padding="lg">
        <AppText variant="bodyStrong">{concept.title}</AppText>
        <ContentMetaRow item={concept} language={language} topicLabel={getConceptTopicLabel(concept, language)} />
        <View style={styles.definitionBlock}>
          <AppText color="accentInk" variant="label">
            {copy.definition}
          </AppText>
          <AppText variant="bodyStrong">{concept.definition}</AppText>
        </View>
        <View style={styles.conceptGrid}>
          <ConceptNote label={copy.plainLanguage} text={concept.plain_english} />
          <ConceptNote label={copy.example} text={concept.example} />
          <ConceptNote label={copy.useItLikeThis} text={concept.how_to_use_it} />
          <ConceptNote label={copy.commonMistake} text={concept.common_mistake} />
        </View>
        <SourceLine item={concept} language={language} />
        <ContentInteractionControls
          item={concept}
          interactionState={interactionState}
          language={language}
          onInteraction={onInteraction}
          pendingInteractionIds={pendingInteractionIds}
        />
      </Card>
      <SectionCompleteButton completed={completed} language={language} label={copy.saveConceptForToday} onComplete={onComplete} />
    </View>
  );
}

function ContentMetaRow({
  item,
  language,
  topicLabel
}: {
  item: DailyDropContentItem;
  language: ContentLanguage;
  topicLabel: string;
}) {
  const copy = getTodayCopy(language);
  const sourceCount = getSourceCount(item);

  return (
    <View style={styles.contentMetaRow}>
      <ProgressPill label={topicLabel} tone="accent" />
      <ProgressPill label={copy.minuteCount(estimateItemReadMinutes(item))} tone="neutral" />
      <ProgressPill
        label={copy.sourceCount(sourceCount)}
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
  language,
  onInteraction,
  pendingInteractionIds
}: {
  item: DailyDropContentItem;
  interactionState: InteractionState;
  language: ContentLanguage;
  onInteraction: (action: InteractionAction) => Promise<void>;
  pendingInteractionIds: Set<string>;
}) {
  const copy = getTodayCopy(language);
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
          {isCompleted ? <ProgressPill label={copy.completed} tone="success" value={1} /> : null}
          {isSaved ? <ProgressPill label={copy.saved} tone="accent" /> : null}
          {activeRating ? (
            <ProgressPill label={copy.rated(formatRatingLabel(activeRating, language))} tone="neutral" />
          ) : null}
        </View>
      ) : null}
      <View style={styles.interactionButtonRow}>
        <SecondaryButton
          disabled={isCompleted || completionPending}
          label={isCompleted ? copy.completed : completionPending ? copy.completing : copy.complete}
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
          label={isSaved ? copy.saved : savePending ? copy.saving : copy.save}
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
        <View style={styles.feedbackHeader}>
          <AppText variant="label">{copy.reflection}</AppText>
          <AppText color="muted" variant="caption">
            {copy.reflectionQuestion}
          </AppText>
        </View>
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
                  {formatRatingLabel(rating, language)}
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
  language,
  onReset
}: {
  allItems: DailyDropContentItem[];
  isComplete: boolean;
  language: ContentLanguage;
  onReset: () => void;
}) {
  const copy = getTodayCopy(language);

  return (
    <Card padding="lg" style={styles.completionCard} tone={isComplete ? "accent" : "muted"}>
      <ProgressPill
        label={isComplete ? copy.dropComplete : copy.todayDropOnly}
        tone={isComplete ? "success" : "neutral"}
        value={isComplete ? 1 : undefined}
      />
      <AppText variant="subtitle">
        {isComplete ? copy.finishedBriefing : copy.fullDropToday}
      </AppText>
      <AppText color={isComplete ? "accentInk" : "muted"} variant="body">
        {isComplete
          ? copy.libraryLater
          : copy.availableItems(allItems.length)}
      </AppText>
      {isComplete ? (
        <Pressable accessibilityRole="button" onPress={onReset} style={styles.resetLink}>
          <AppText color="accentInk" variant="label">
            {copy.resetTodayProgress}
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

function SourceLine({ item, language }: { item: DailyDropContentItem; language: ContentLanguage }) {
  const copy = getTodayCopy(language);
  const sources = getDisplaySources(item);
  const fallbackLabel = getSourceFallbackLabel(item, language);

  return (
    <View style={styles.sourceLine}>
      <View style={styles.sourceHeader}>
        <AppText color="muted" variant="caption">
          {copy.sources}
        </AppText>
        <ProgressPill label={copy.linkedSources(getSourceCount(item))} tone="neutral" />
      </View>
      {sources.length > 0 ? (
        <View style={styles.sourceList}>
          {sources.slice(0, 3).map((source) => (
            <View key={source.id} style={styles.sourceItem}>
              <AppText variant="label">{source.publisher}</AppText>
              <AppText color="muted" style={styles.sourceCopy} variant="caption">
                {source.title}
              </AppText>
              <AppText color="muted" variant="caption">
                {formatSourceDate(source.published_at ?? source.retrieved_at, language)} · {getUrlHost(source.url, language)}
              </AppText>
            </View>
          ))}
        </View>
      ) : (
        <AppText color="muted" style={styles.sourceCopy} variant="caption">
          {fallbackLabel}
        </AppText>
      )}
    </View>
  );
}

function getModuleItemCount(drop: TodayDailyDrop, moduleId: ModuleId) {
  return getModuleItems(drop, moduleId).length;
}

function getDataModeLabel(source: DataFetchSource, language: ContentLanguage) {
  const copy = getTodayCopy(language);

  if (source === "supabase") {
    return copy.liveDropTitle;
  }

  if (source === "cache") {
    return copy.cachedLiveDropLabel;
  }

  return copy.previewMode;
}

function getContentModeLabel(source: DataFetchSource, language: ContentLanguage) {
  const copy = getTodayCopy(language);

  if (source === "supabase") {
    return copy.liveContent;
  }

  if (source === "cache") {
    return copy.cachedContent;
  }

  return copy.previewContent;
}

function getDataModeTone(source: DataFetchSource): "success" | "warning" | "neutral" {
  if (source === "supabase") {
    return "success";
  }

  if (source === "cache") {
    return "warning";
  }

  return "neutral";
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

  const item = drop.items[moduleId];

  return item ? [item] : [];
}

function getSourceCount(item: DailyDropContentItem) {
  return Math.max(item.sources?.length ?? 0, item.source_ids.length, getMockSourcesForItem(item).length);
}

function getDisplaySources(item: DailyDropContentItem) {
  if (item.sources && item.sources.length > 0) {
    return item.sources;
  }

  const mockSources = getMockSourcesForItem(item);

  if (mockSources.length > 0) {
    return mockSources;
  }

  return [];
}

function getSourceFallbackLabel(item: DailyDropContentItem, language: ContentLanguage) {
  const copy = getTodayCopy(language);

  if (item.source_ids.length > 0) {
    return copy.sourceLinksAttached(item.source_ids.length);
  }

  return copy.sourceMetadataPending;
}

function getDropAnalyticsProperties(drop: TodayDailyDrop) {
  return {
    drop_date: drop.drop_date,
    language: drop.language
  };
}

function getItemAnalyticsProperties(item: DailyDropContentItem, drop: TodayDailyDrop) {
  return {
    content_type: item.content_type,
    drop_date: drop.drop_date,
    item_id: item.id,
    language: item.language,
    topic: getItemTopic(item)
  };
}

function getItemTopic(item: DailyDropContentItem): TopicId | undefined {
  if ("topic" in item) {
    return item.topic;
  }

  if ("category" in item && item.category !== "career") {
    return item.category;
  }

  return undefined;
}

function getConceptTopicLabel(concept: KeyConcept, language: ContentLanguage) {
  const copy = getTodayCopy(language);

  return concept.category === "career" ? copy.careerTopic : getMiniCaseTopicLabel(concept.category, language);
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

function formatRatingLabel(rating: ContentRating, language: ContentLanguage) {
  const copy = getTodayCopy(language);

  if (rating === "good") {
    return copy.ratingUseful;
  }

  if (rating === "average") {
    return copy.ratingOkay;
  }

  return copy.ratingNotUseful;
}

function formatDropDate(date: string, language: ContentLanguage) {
  return new Intl.DateTimeFormat(language, {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatShortDate(date: string, language: ContentLanguage) {
  return new Intl.DateTimeFormat(language, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatSourceDate(date: string | null, language: ContentLanguage) {
  if (!date) {
    return getTodayCopy(language).datePending;
  }

  return formatShortDate(date.slice(0, 10), language);
}

function getUrlHost(value: string, language: ContentLanguage) {
  try {
    return new URL(value).host.replace(/^www\./, "");
  } catch {
    return getTodayCopy(language).sourceLink;
  }
}

function getLocalDropDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getNewsletterTopicLabel(topic: TopicId, language: ContentLanguage) {
  return getTodayCopy(language).newsletterTopics[topic];
}

function getMiniCaseTopicLabel(topic: TopicId, language: ContentLanguage) {
  return getTodayCopy(language).miniCaseTopics[topic];
}

function getTodayCopy(language: ContentLanguage) {
  return localized(
    {
      en: {
        availableItems: (count: number) =>
          `${count} items are available in this session. No endless queue, no next-feed pull.`,
        accessibilityLabel: "Today daily drop",
        businessStoryDescription:
          "One concrete mechanism from business, pricing, or strategy.",
        cachedContent: "Cached content",
        cachedDropDescription:
          "The latest live check is unavailable, so the app is showing the last daily drop kept in memory.",
        cachedDropTitle: "Cached daily drop",
        cachedLiveDropLabel: "Cached live drop",
        careerTopic: "Career",
        challenge: "Challenge",
        checkAgain: "Check again",
        checkingStatus: "Checking",
        commonMistake: "Common mistake",
        complete: "Complete",
        completeMessage: "Daily drop complete. Come back tomorrow for the next one.",
        completed: "Completed",
        completing: "Completing",
        conceptDescription:
          "One reusable idea for class, interviews, or serious conversations.",
        constraints: "Constraints",
        datePending: "Date pending",
        definition: "Definition",
        description:
          "Read the signal, understand the mechanism, solve the mini-case, keep the concept. Then stop. This is your daily learning ritual, not a feed.",
        done: "Done",
        dropComplete: "Drop complete",
        emptyDropDescription:
          "No readable modules are attached to this drop yet. Try again after the daily content refresh, or continue with the sample if shown above.",
        emptyDropEyebrow: "Empty drop",
        emptyDropTitle: "Today's content is not ready",
        example: "Example",
        eyebrow: "Today",
        finishedBriefing: "You finished today's briefing.",
        fullDropToday: "That is the full drop for today.",
        hideSample: "Hide sample",
        incompleteMessage: "Finish the four modules. No feed, no backlog pressure.",
        itemCount: (count: number) => `${count} item${count === 1 ? "" : "s"}`,
        itemProgress: (completed: number, total: number) => `${completed}/${total} items`,
        languageName: "English",
        lesson: "Lesson",
        libraryLater:
          "The Library can hold past work later. Today stays focused: four modules, then stop.",
        linkedSources: (count: number) => `${count} linked`,
        liveContent: "Account content",
        liveDropDescription:
          "This is the assigned daily drop for this account. Saves, completions, and ratings are stored.",
        liveDropTitle: "Today's assigned drop",
        loadingDropDescription:
          "Looking for today's assigned drop. Existing content stays visible while the app checks your account.",
        loadingDropTitle: "Loading today's drop",
        localSaveOnly:
          "Saved on this device for this session. Account sync did not complete.",
        markDone: "Mark done",
        markNewsletterRead: "Mark newsletter read",
        markStoryComplete: "Mark story complete",
        miniCaseDescription:
          "A short decision exercise. Think before checking the sample answer.",
        minuteCount: (count: number) => `${count} min`,
        minuteSession: (count: number) => `${count} min session`,
        modules: {
          newsletter: {
            label: "Newsletter",
            description: "Sourced news signal"
          },
          business_story: {
            label: "Business story",
            description: "Business mechanism"
          },
          mini_case: {
            label: "Mini-case",
            description: "Decision exercise"
          },
          concept: {
            label: "Concept",
            description: "Reusable idea"
          }
        },
        newsletterDescription:
          "A short, sourced scan of the topics selected for today's drop.",
        newsletterEmptyDescription:
          "This daily drop has no newsletter items. The other modules are still available.",
        newsletterEmptyTitle: "Newsletter slot is empty",
        newsletterTitle: "Signals worth knowing",
        noLiveDropDescription:
          "No English daily drop is assigned to this account for today. Sample content is shown below.",
        noLiveDropTitle: "No assigned daily drop yet",
        noSessionDescription:
          "Sign in to load your assigned daily drop. Sample content is shown below.",
        noSessionTitle: "No active session",
        plainLanguage: "Plain English",
        previewActionMarked: "Sample action marked for this session.",
        previewContent: "Sample content",
        previewFallback: "The app is showing sample content for now.",
        previewMode: "Sample mode",
        ratingNotUseful: "Not useful",
        ratingOkay: "Okay",
        ratingUseful: "Useful",
        rated: (rating: string) => `Rated ${rating}`,
        ready: "Ready",
        readyStatus: "Ready",
        reflection: "Reflection",
        reflectionQuestion: "Was this worth your five minutes?",
        resetTodayProgress: "Reset today's progress",
        retryLiveData: "Try again",
        retrySessionCheck: "Retry session check",
        ritualSteps: [
          "Read the newsletter signals.",
          "Finish the business story and mini-case.",
          "Save one idea you want to reuse.",
          "Mark each item complete when it lands."
        ],
        ritualTitle: "What to do now",
        sampleAnswer: "Sample answer",
        sampleStatus: "Sample",
        save: "Save",
        saveConceptForToday: "Save concept for today",
        saved: "Saved",
        savedCopyStatus: "Saved copy",
        savedToAccount: "Saved to your account.",
        saving: "Saving",
        showSample: "Show sample",
        slotOverviewTitle: "Four-slot daily drop",
        sourceCount: (count: number) => `${count} source${count === 1 ? "" : "s"}`,
        sourceLink: "source link",
        sourceLinksAttached: (count: number) =>
          `${count} source link${count === 1 ? "" : "s"} attached. Full source metadata is still loading.`,
        sourceMetadataPending: "Source metadata pending.",
        sources: "Sources",
        storyDecision: "Decision",
        storyOutcome: "Outcome",
        storySetup: "Setup",
        storyTension: "Tension",
        title: "Five minutes. Four sharp moves.",
        todayDropOnly: "Today's drop only",
        newsletterTopics: {
          business: "Stock Market",
          finance: "Finance & Economy",
          tech_ai: "Artificial Intelligence",
          law: "International",
          medicine: "Pharma",
          engineering: "Automotive",
          sport_business: "Sport",
          culture_media: "Culture"
        },
        miniCaseTopics: {
          business: "Stock Market",
          finance: "Finance / Economy",
          tech_ai: "Artificial Intelligence",
          law: "Law / Compliance",
          medicine: "Health / Pharma",
          engineering: "Engineering / Operations",
          sport_business: "Stock Market",
          culture_media: "Artificial Intelligence"
        },
        useItLikeThis: "Use it like this",
        whyItMatters: "Why it matters"
      },
      fr: {
        availableItems: (count: number) =>
          `${count} élément${count > 1 ? "s" : ""} disponible${count > 1 ? "s" : ""} dans cette session. Pas de file infinie, pas de flux à poursuivre.`,
        accessibilityLabel: "Mise à jour du jour",
        businessStoryDescription:
          "Un mécanisme concret de business, de prix ou de stratégie.",
        cachedContent: "Contenu en cache",
        cachedDropDescription:
          "La dernière vérification en direct est indisponible, donc l'app affiche la dernière mise à jour gardée en mémoire.",
        cachedDropTitle: "Mise à jour en cache",
        cachedLiveDropLabel: "Mise à jour en cache",
        careerTopic: "Carrière",
        challenge: "Défi",
        checkAgain: "Vérifier à nouveau",
        checkingStatus: "Vérification",
        commonMistake: "Erreur fréquente",
        complete: "Terminer",
        completeMessage: "Mise à jour terminée. Reviens demain pour la suivante.",
        completed: "Terminé",
        completing: "Finalisation",
        conceptDescription:
          "Une idée réutilisable en cours, en entretien ou dans une discussion sérieuse.",
        constraints: "Contraintes",
        datePending: "Date en attente",
        definition: "Définition",
        description:
          "Lis le signal, comprends le mécanisme, résous le mini-cas, garde le concept. Puis stop. C'est ton rituel d'apprentissage quotidien, pas un fil.",
        done: "Fait",
        dropComplete: "Mise à jour terminée",
        emptyDropDescription:
          "Aucun module lisible n'est attaché à cette mise à jour. Réessaie après l'actualisation du contenu quotidien, ou continue avec l'exemple s'il s'affiche au-dessus.",
        emptyDropEyebrow: "Mise à jour vide",
        emptyDropTitle: "Le contenu du jour n'est pas prêt",
        example: "Exemple",
        eyebrow: "Aujourd'hui",
        finishedBriefing: "Tu as terminé le briefing du jour.",
        fullDropToday: "C'est toute la mise à jour d'aujourd'hui.",
        hideSample: "Masquer l'exemple",
        incompleteMessage: "Termine les quatre modules. Pas de fil, pas de retard accumulé.",
        itemCount: (count: number) => `${count} élément${count > 1 ? "s" : ""}`,
        itemProgress: (completed: number, total: number) => `${completed}/${total} éléments`,
        languageName: "Français",
        lesson: "Leçon",
        libraryLater:
          "La Bibliothèque peut garder le travail passé. Aujourd'hui reste concentré : quatre modules, puis stop.",
        linkedSources: (count: number) => `${count} source${count > 1 ? "s" : ""} liée${count > 1 ? "s" : ""}`,
        liveContent: "Contenu du compte",
        liveDropDescription:
          "Voici la mise à jour quotidienne assignée à ce compte. Sauvegardes, complétions et avis sont enregistrés.",
        liveDropTitle: "Mise à jour assignée",
        loadingDropDescription:
          "Recherche de la mise à jour assignée aujourd'hui. Le contenu existant reste visible pendant la vérification du compte.",
        loadingDropTitle: "Chargement du jour",
        localSaveOnly:
          "Enregistré sur cet appareil pour cette session. La synchronisation du compte n'a pas abouti.",
        markDone: "Marquer comme fait",
        markNewsletterRead: "Marquer la newsletter comme lue",
        markStoryComplete: "Marquer l'histoire comme terminée",
        miniCaseDescription:
          "Un court exercice de décision. Réfléchis avant de regarder l'exemple de réponse.",
        minuteCount: (count: number) => `${count} min`,
        minuteSession: (count: number) => `${count} min de session`,
        modules: {
          newsletter: {
            label: "Newsletter",
            description: "Signal d'actualité sourcé"
          },
          business_story: {
            label: "Histoire business",
            description: "Mécanisme business"
          },
          mini_case: {
            label: "Mini-cas",
            description: "Exercice de décision"
          },
          concept: {
            label: "Concept",
            description: "Idée réutilisable"
          }
        },
        newsletterDescription:
          "Un scan court et sourcé des sujets sélectionnés pour la mise à jour du jour.",
        newsletterEmptyDescription:
          "Cette mise à jour n'a pas d'articles newsletter. Les autres modules restent disponibles.",
        newsletterEmptyTitle: "L'emplacement newsletter est vide",
        newsletterTitle: "Signaux à connaître",
        noLiveDropDescription:
          "Aucune mise à jour quotidienne en français n'est assignée à ce compte aujourd'hui. Un contenu d'exemple s'affiche ci-dessous.",
        noLiveDropTitle: "Aucune mise à jour assignée",
        noSessionDescription:
          "Connecte-toi pour charger ta mise à jour assignée. Un contenu d'exemple s'affiche ci-dessous.",
        noSessionTitle: "Aucune session active",
        plainLanguage: "En clair",
        previewActionMarked: "Action d'exemple marquée pour cette session.",
        previewContent: "Contenu d'exemple",
        previewFallback: "L'app affiche un contenu d'exemple pour le moment.",
        previewMode: "Mode exemple",
        ratingNotUseful: "Peu utile",
        ratingOkay: "Correct",
        ratingUseful: "Utile",
        rated: (rating: string) => `Noté ${rating}`,
        ready: "Prêt",
        readyStatus: "Prêt",
        reflection: "Retour",
        reflectionQuestion: "Est-ce que cela valait tes cinq minutes ?",
        resetTodayProgress: "Réinitialiser la progression du jour",
        retryLiveData: "Réessayer",
        retrySessionCheck: "Revérifier la session",
        ritualSteps: [
          "Lis les signaux newsletter.",
          "Termine l'histoire business et le mini-cas.",
          "Sauvegarde une idée que tu veux réutiliser.",
          "Marque chaque élément comme terminé quand il est acquis."
        ],
        ritualTitle: "Que faire maintenant",
        sampleAnswer: "Exemple de réponse",
        sampleStatus: "Exemple",
        save: "Sauvegarder",
        saveConceptForToday: "Sauvegarder le concept du jour",
        saved: "Sauvegardé",
        savedCopyStatus: "Copie disponible",
        savedToAccount: "Enregistré sur ton compte.",
        saving: "Sauvegarde",
        showSample: "Voir l'exemple",
        slotOverviewTitle: "Mise à jour en quatre modules",
        sourceCount: (count: number) => `${count} source${count > 1 ? "s" : ""}`,
        sourceLink: "lien source",
        sourceLinksAttached: (count: number) =>
          `${count} lien${count > 1 ? "s" : ""} source attaché${count > 1 ? "s" : ""}. Les métadonnées complètes se chargent encore.`,
        sourceMetadataPending: "Métadonnées source en attente.",
        sources: "Sources",
        storyDecision: "Décision",
        storyOutcome: "Résultat",
        storySetup: "Contexte",
        storyTension: "Tension",
        title: "Cinq minutes. Quatre gestes utiles.",
        todayDropOnly: "Seulement la mise à jour du jour",
        newsletterTopics: {
          business: "Marché actions",
          finance: "Finance & économie",
          tech_ai: "Intelligence artificielle",
          law: "International",
          medicine: "Pharma",
          engineering: "Automobile",
          sport_business: "Sport",
          culture_media: "Culture"
        },
        miniCaseTopics: {
          business: "Marché actions",
          finance: "Finance / Économie",
          tech_ai: "Intelligence artificielle",
          law: "Droit / Conformité",
          medicine: "Santé / Pharma",
          engineering: "Ingénierie / Opérations",
          sport_business: "Marché actions",
          culture_media: "Intelligence artificielle"
        },
        useItLikeThis: "À utiliser comme ça",
        whyItMatters: "Pourquoi c'est important"
      }
    },
    language
  );
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
  ritualCard: {
    gap: tokens.space.md
  },
  ritualSteps: {
    gap: tokens.space.sm
  },
  ritualStep: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: tokens.space.sm
  },
  ritualStepNumber: {
    alignItems: "center",
    backgroundColor: tokens.color.accentSoft,
    borderRadius: tokens.radius.pill,
    height: 24,
    justifyContent: "center",
    width: 24
  },
  ritualStepText: {
    flex: 1
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
    gap: tokens.space.sm,
    paddingTop: tokens.space.md
  },
  sourceHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.sm,
    justifyContent: "space-between"
  },
  sourceList: {
    gap: tokens.space.sm
  },
  sourceItem: {
    backgroundColor: tokens.color.backgroundRaised,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    gap: tokens.space.xs,
    padding: tokens.space.md
  },
  sourceCopy: {
    flexShrink: 1
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
    minHeight: 44,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm
  },
  feedbackGroup: {
    gap: tokens.space.sm
  },
  feedbackHeader: {
    gap: tokens.space.xs
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
    minHeight: 44,
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
    justifyContent: "center",
    minHeight: 44,
    paddingVertical: tokens.space.xs
  }
});
