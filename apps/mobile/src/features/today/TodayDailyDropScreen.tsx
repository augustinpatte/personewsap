import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppScreen, AppText, Card, EmptyState, PrimaryButton } from "../../components";
import type { TopicId } from "../../constants/product";
import { tokens } from "../../design/tokens";
import { useAuth } from "../auth";
import type { DataFallbackReason, DataFetchSource } from "../../lib/dataState";
import { trackAnalyticsEvent } from "../../lib/analytics";
import { localized } from "../../lib/i18n";
import { getAuthSession, type NormalizedSupabaseError } from "../../lib/supabase";
import { flattenDailyDropItems, mockTodayDailyDropsByLanguage } from "../../mocks";
import type { ContentDifficulty } from "./contentTypes";
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

type TodayLoadState = {
  drop: TodayDailyDrop;
  error: NormalizedSupabaseError | null;
  fallbackReason: DataFallbackReason | null;
  source: DataFetchSource;
  status: "loading" | "ready";
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
  const [interactionState, setInteractionState] = useState<ContentInteractionSnapshot>(
    createEmptyContentInteractionSnapshot
  );
  const [openedItemIds, setOpenedItemIds] = useState<Set<string>>(new Set());
  const [pendingModules, setPendingModules] = useState<Set<string>>(new Set());
  const [revealedResolution, setRevealedResolution] = useState(false);

  const drop = loadState.drop;
  const formattedDate = useMemo(
    () => formatDropDate(drop.drop_date, activeLanguage),
    [activeLanguage, drop.drop_date]
  );
  const allItems = useMemo(() => flattenDailyDropItems(drop), [drop]);
  const totalItemCount = allItems.length;
  const isEmptyDrop = totalItemCount === 0;
  const completedItemCount = useMemo(
    () => allItems.filter((item) => interactionState.completedItemIds.has(item.id)).length,
    [allItems, interactionState.completedItemIds]
  );
  const progress = totalItemCount > 0 ? completedItemCount / totalItemCount : 0;
  const isComplete = totalItemCount > 0 && completedItemCount === totalItemCount;

  const loadTodayDrop = useCallback(
    async (isActive: () => boolean = () => true) => {
      setLoadState((currentState) => ({ ...currentState, status: "loading" }));

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

  const markItemComplete = useCallback(
    async (item: DailyDropContentItem) => {
      if (!openedItemIds.has(item.id)) {
        setOpenedItemIds((current) => new Set(current).add(item.id));
        trackAnalyticsEvent("content_item_opened", getItemAnalyticsProperties(item, drop));
      }

      setInteractionState((current) => ({
        ...current,
        completedItemIds: new Set(current.completedItemIds).add(item.id)
      }));
      trackAnalyticsEvent("content_item_completed", getItemAnalyticsProperties(item, drop));

      if (loadState.source === "supabase" || loadState.source === "cache") {
        await writeContentInteraction({ contentItemId: item.id, interactionType: "complete" });
      }
    },
    [drop, loadState.source, openedItemIds]
  );

  const completeModule = useCallback(
    async (moduleId: string, items: DailyDropContentItem[]) => {
      setPendingModules((current) => new Set(current).add(moduleId));

      for (const item of items) {
        if (!interactionState.completedItemIds.has(item.id)) {
          await markItemComplete(item);
        }
      }

      setPendingModules((current) => {
        const next = new Set(current);
        next.delete(moduleId);
        return next;
      });
    },
    [interactionState.completedItemIds, markItemComplete]
  );

  function isModuleComplete(items: DailyDropContentItem[]) {
    return items.length > 0 && items.every((item) => interactionState.completedItemIds.has(item.id));
  }

  const newsletter = drop.items.newsletter;
  const story = drop.items.business_story;
  const miniCase = drop.items.mini_case;
  const concept = drop.items.concept;

  return (
    <AppScreen
      contentStyle={styles.screenContent}
      scrollViewProps={{ accessibilityLabel: copy.accessibilityLabel }}
    >
      <View style={styles.masthead}>
        <AppText variant="eyebrow">{formattedDate}</AppText>
        <AppText variant="title">{copy.mastheadTitle}</AppText>
        <AppText color="muted" variant="caption">
          {copy.mastheadStandfirst(drop.estimated_read_minutes)}
        </AppText>
        {!isEmptyDrop ? <EditionProgress value={progress} /> : null}
      </View>

      {isEmptyDrop ? (
        <EmptyState
          actionLabel={copy.retry}
          description={copy.emptyBody}
          onActionPress={() => {
            void loadTodayDrop();
          }}
          title={copy.emptyTitle}
        />
      ) : (
        <>
          {newsletter.length > 0 ? (
            <NewsletterLead
              articles={newsletter}
              completed={isModuleComplete(newsletter)}
              language={activeLanguage}
              onMarkRead={() => completeModule("newsletter", newsletter)}
              pending={pendingModules.has("newsletter")}
            />
          ) : null}

          {story ? (
            <BusinessStoryFeature
              completed={isModuleComplete([story])}
              language={activeLanguage}
              onMarkRead={() => completeModule("business_story", [story])}
              pending={pendingModules.has("business_story")}
              story={story}
            />
          ) : null}

          {miniCase ? (
            <MiniCaseInvitation
              challenge={miniCase}
              language={activeLanguage}
              onReveal={() => {
                setRevealedResolution(true);
                void completeModule("mini_case", [miniCase]);
              }}
              pending={pendingModules.has("mini_case")}
              revealed={revealedResolution}
            />
          ) : null}

          {concept ? (
            <ConceptNote
              completed={isModuleComplete([concept])}
              concept={concept}
              language={activeLanguage}
              onKeep={() => completeModule("concept", [concept])}
              pending={pendingModules.has("concept")}
            />
          ) : null}

          {isComplete ? <CompletionNote language={activeLanguage} /> : null}
        </>
      )}
    </AppScreen>
  );
}

function EditionProgress({ value }: { value: number }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.round(value * 100)}%` }]} />
    </View>
  );
}

function Kicker({ label, meta }: { label: string; meta?: string }) {
  return (
    <View style={styles.kicker}>
      <AppText variant="eyebrow">{label}</AppText>
      {meta ? (
        <AppText color="muted" variant="eyebrow">
          {meta}
        </AppText>
      ) : null}
    </View>
  );
}

function ModuleAction({
  completed,
  completedLabel,
  label,
  onPress,
  pending
}: {
  completed: boolean;
  completedLabel: string;
  label: string;
  onPress: () => void;
  pending: boolean;
}) {
  if (completed) {
    return (
      <View style={styles.doneRow}>
        <View style={styles.doneMark} />
        <AppText color="accentInk" variant="label">
          {completedLabel}
        </AppText>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      disabled={pending}
      onPress={onPress}
      style={({ pressed }) => [styles.textAction, pressed && !pending ? styles.textActionPressed : null]}
    >
      <AppText color="accentInk" variant="label">
        {label}
      </AppText>
    </Pressable>
  );
}

function NewsletterLead({
  articles,
  completed,
  language,
  onMarkRead,
  pending
}: {
  articles: NewsletterArticle[];
  completed: boolean;
  language: ContentLanguage;
  onMarkRead: () => void;
  pending: boolean;
}) {
  const copy = getTodayCopy(language);
  const [lead, ...rest] = articles;

  return (
    <View style={styles.lead}>
      <Kicker label={copy.laUne} meta={copy.minuteCount(estimateItemReadMinutes(lead))} />
      <AppText color="muted" variant="caption">
        {getNewsletterTopicLabel(lead.topic, language)}
      </AppText>
      <AppText style={styles.leadHeadline} variant="display">
        {lead.title}
      </AppText>
      <AppText variant="lede">{lead.summary}</AppText>

      <View style={styles.coda}>
        <AppText color="muted" variant="eyebrow">
          {copy.whatChanges}
        </AppText>
        <AppText variant="read">{lead.why_it_matters}</AppText>
      </View>

      {rest.length > 0 ? (
        <View style={styles.alsoBlock}>
          <AppText color="muted" variant="eyebrow">
            {copy.alsoInBrief}
          </AppText>
          {rest.map((article) => (
            <View key={article.id} style={styles.alsoItem}>
              <AppText color="muted" variant="caption">
                {getNewsletterTopicLabel(article.topic, language)}
              </AppText>
              <AppText variant="subtitle">{article.title}</AppText>
            </View>
          ))}
        </View>
      ) : null}

      <ModuleAction
        completed={completed}
        completedLabel={copy.read}
        label={copy.markRead}
        onPress={onMarkRead}
        pending={pending}
      />
    </View>
  );
}

function BusinessStoryFeature({
  completed,
  language,
  onMarkRead,
  pending,
  story
}: {
  completed: boolean;
  language: ContentLanguage;
  onMarkRead: () => void;
  pending: boolean;
  story: BusinessStory;
}) {
  const copy = getTodayCopy(language);
  const beats = [story.setup, story.tension, story.decision, story.outcome].filter(Boolean);

  return (
    <Card padding="lg" style={styles.storyCard}>
      <View style={styles.storyHeader}>
        <Monogram label={story.company_or_market} />
        <View style={styles.storyHeaderCopy}>
          <AppText variant="eyebrow">{copy.storyKicker}</AppText>
          <AppText color="muted" variant="caption">
            {story.company_or_market}
          </AppText>
        </View>
      </View>

      <AppText variant="title">{story.title}</AppText>

      <View style={styles.storyBody}>
        {beats.map((beat, index) => (
          <AppText key={index} variant="read">
            {beat}
          </AppText>
        ))}
      </View>

      <View style={styles.lesson}>
        <AppText color="muted" variant="eyebrow">
          {copy.lesson}
        </AppText>
        <AppText variant="quote">{story.lesson}</AppText>
      </View>

      <ModuleAction
        completed={completed}
        completedLabel={copy.read}
        label={copy.markRead}
        onPress={onMarkRead}
        pending={pending}
      />
    </Card>
  );
}

function MiniCaseInvitation({
  challenge,
  language,
  onReveal,
  pending,
  revealed
}: {
  challenge: MiniCaseChallenge;
  language: ContentLanguage;
  onReveal: () => void;
  pending: boolean;
  revealed: boolean;
}) {
  const copy = getTodayCopy(language);

  return (
    <Card padding="lg" style={styles.caseCard} tone="accent">
      <Kicker
        label={copy.caseKicker}
        meta={`${getMiniCaseTopicLabel(challenge.topic, language)} · ${getDifficultyLabel(
          challenge.difficulty,
          language
        )}`}
      />
      <AppText variant="title">{challenge.title}</AppText>
      <AppText variant="read">{challenge.context}</AppText>

      <View style={styles.casePrompt}>
        <AppText color="muted" variant="eyebrow">
          {copy.caseDecision}
        </AppText>
        <AppText variant="lede">{challenge.question}</AppText>
      </View>

      {revealed ? (
        <View style={styles.resolution}>
          <AppText color="muted" variant="eyebrow">
            {copy.resolution}
          </AppText>
          <AppText variant="read">{challenge.sample_answer}</AppText>
        </View>
      ) : null}

      {revealed ? (
        <View style={styles.doneRow}>
          <View style={styles.doneMark} />
          <AppText color="accentInk" variant="label">
            {copy.seen}
          </AppText>
        </View>
      ) : (
        <PrimaryButton disabled={pending} label={copy.seeResolution} onPress={onReveal} />
      )}
    </Card>
  );
}

function ConceptNote({
  completed,
  concept,
  language,
  onKeep,
  pending
}: {
  completed: boolean;
  concept: KeyConcept;
  language: ContentLanguage;
  onKeep: () => void;
  pending: boolean;
}) {
  const copy = getTodayCopy(language);

  return (
    <Card padding="md" style={styles.conceptCard} tone="muted">
      <Kicker label={copy.conceptKicker} meta={getConceptTopicLabel(concept, language)} />
      <AppText variant="subtitle">{concept.title}</AppText>
      <AppText variant="read">{concept.definition}</AppText>
      <View style={styles.conceptPlain}>
        <AppText color="muted" variant="eyebrow">
          {copy.inPlainWords}
        </AppText>
        <AppText color="inkSoft" variant="read">
          {concept.plain_english}
        </AppText>
      </View>
      <ModuleAction
        completed={completed}
        completedLabel={copy.kept}
        label={copy.keepConcept}
        onPress={onKeep}
        pending={pending}
      />
    </Card>
  );
}

function CompletionNote({ language }: { language: ContentLanguage }) {
  const copy = getTodayCopy(language);

  return (
    <View style={styles.completion}>
      <AppText align="center" variant="subtitle">
        {copy.completionTitle}
      </AppText>
      <AppText align="center" color="muted" variant="read">
        {copy.completionBody}
      </AppText>
    </View>
  );
}

function Monogram({ label }: { label: string }) {
  const initial = label.trim().charAt(0).toUpperCase() || "•";

  return (
    <View style={styles.monogram}>
      <AppText style={styles.monogramText} variant="subtitle">
        {initial}
      </AppText>
    </View>
  );
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
    return [item.title, item.setup, item.tension, item.decision, item.outcome, item.lesson].join(" ");
  }

  if (item.content_type === "mini_case") {
    return [item.title, item.context, item.challenge, item.question, item.sample_answer].join(" ");
  }

  return [item.title, item.definition, item.plain_english, item.example, item.how_to_use_it].join(" ");
}

function getDropAnalyticsProperties(drop: TodayDailyDrop) {
  return { drop_date: drop.drop_date, language: drop.language };
}

function getItemAnalyticsProperties(item: DailyDropContentItem, drop: TodayDailyDrop) {
  return {
    content_type: item.content_type,
    drop_date: drop.drop_date,
    item_id: item.id,
    language: item.language
  };
}

function formatDropDate(date: string, language: ContentLanguage) {
  return new Intl.DateTimeFormat(language, {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date(`${date}T12:00:00Z`));
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

function getConceptTopicLabel(concept: KeyConcept, language: ContentLanguage) {
  const copy = getTodayCopy(language);

  return concept.category === "career"
    ? copy.careerTopic
    : getMiniCaseTopicLabel(concept.category, language);
}

function getDifficultyLabel(difficulty: ContentDifficulty, language: ContentLanguage) {
  return getTodayCopy(language).difficulty[difficulty];
}

function getTodayCopy(language: ContentLanguage) {
  return localized(
    {
      en: {
        accessibilityLabel: "Today's brief",
        mastheadTitle: "Today's brief",
        mastheadStandfirst: (minutes: number) => `Your morning edition · ${minutes} min`,
        laUne: "Lead",
        whatChanges: "What it changes",
        alsoInBrief: "Also in the brief",
        storyKicker: "The story",
        lesson: "The lesson",
        caseKicker: "The case",
        caseDecision: "Your call",
        seeResolution: "See the resolution",
        resolution: "The resolution",
        conceptKicker: "The concept",
        inPlainWords: "In plain words",
        careerTopic: "Career",
        markRead: "Mark as read",
        read: "Read",
        keepConcept: "Keep this concept",
        kept: "Kept",
        seen: "Seen",
        minuteCount: (count: number) => `${count} min`,
        completionTitle: "Brief complete",
        completionBody: "You finished today's edition. See you tomorrow.",
        emptyTitle: "Today's brief will be available soon.",
        emptyBody: "Check back in a moment — the new edition is on its way.",
        retry: "Refresh",
        difficulty: {
          intro: "Accessible",
          intermediate: "Intermediate",
          advanced: "Advanced"
        } as Record<ContentDifficulty, string>,
        newsletterTopics: {
          business: "Stock Market",
          finance: "Finance & Economy",
          tech_ai: "Artificial Intelligence",
          law: "International",
          medicine: "Pharma",
          engineering: "Automotive",
          sport_business: "Sport",
          culture_media: "Culture"
        } as Record<TopicId, string>,
        miniCaseTopics: {
          business: "Stock Market",
          finance: "Finance / Economy",
          tech_ai: "Artificial Intelligence",
          law: "Law / Compliance",
          medicine: "Health / Pharma",
          engineering: "Engineering / Operations",
          sport_business: "Stock Market",
          culture_media: "Artificial Intelligence"
        } as Record<TopicId, string>
      },
      fr: {
        accessibilityLabel: "Le brief du jour",
        mastheadTitle: "Le brief du jour",
        mastheadStandfirst: (minutes: number) => `Votre édition du matin · ${minutes} min`,
        laUne: "La une",
        whatChanges: "Ce que ça change",
        alsoInBrief: "Aussi dans le brief",
        storyKicker: "L'histoire",
        lesson: "La leçon",
        caseKicker: "Le cas",
        caseDecision: "À vous de décider",
        seeResolution: "Voir la résolution",
        resolution: "La résolution",
        conceptKicker: "Le concept",
        inPlainWords: "En clair",
        careerTopic: "Carrière",
        markRead: "Marquer comme lu",
        read: "Lu",
        keepConcept: "Garder ce concept",
        kept: "Gardé",
        seen: "Vu",
        minuteCount: (count: number) => `${count} min`,
        completionTitle: "Brief terminé",
        completionBody: "Vous avez terminé l'édition du jour. À demain.",
        emptyTitle: "Le brief du jour arrive bientôt.",
        emptyBody: "Revenez dans un instant — la nouvelle édition est en chemin.",
        retry: "Actualiser",
        difficulty: {
          intro: "Accessible",
          intermediate: "Intermédiaire",
          advanced: "Avancé"
        } as Record<ContentDifficulty, string>,
        newsletterTopics: {
          business: "Marché actions",
          finance: "Finance & économie",
          tech_ai: "Intelligence artificielle",
          law: "International",
          medicine: "Pharma",
          engineering: "Automobile",
          sport_business: "Sport",
          culture_media: "Culture"
        } as Record<TopicId, string>,
        miniCaseTopics: {
          business: "Marché actions",
          finance: "Finance / Économie",
          tech_ai: "Intelligence artificielle",
          law: "Droit / Conformité",
          medicine: "Santé / Pharma",
          engineering: "Ingénierie / Opérations",
          sport_business: "Marché actions",
          culture_media: "Intelligence artificielle"
        } as Record<TopicId, string>
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
  masthead: {
    gap: tokens.space.sm
  },
  progressTrack: {
    backgroundColor: tokens.color.surfaceMuted,
    borderRadius: tokens.radius.pill,
    height: 3,
    marginTop: tokens.space.sm,
    overflow: "hidden"
  },
  progressFill: {
    backgroundColor: tokens.color.accent,
    borderRadius: tokens.radius.pill,
    height: "100%"
  },
  kicker: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.sm,
    justifyContent: "space-between"
  },
  lead: {
    borderTopColor: tokens.color.borderStrong,
    borderTopWidth: 1,
    gap: tokens.space.sm,
    paddingTop: tokens.space.lg
  },
  leadHeadline: {
    marginTop: tokens.space.xs
  },
  coda: {
    borderLeftColor: tokens.color.accent,
    borderLeftWidth: 2,
    gap: tokens.space.xs,
    marginTop: tokens.space.sm,
    paddingLeft: tokens.space.md
  },
  alsoBlock: {
    borderTopColor: tokens.color.border,
    borderTopWidth: 1,
    gap: tokens.space.md,
    marginTop: tokens.space.sm,
    paddingTop: tokens.space.lg
  },
  alsoItem: {
    gap: tokens.space.xs
  },
  storyCard: {
    gap: tokens.space.lg
  },
  storyHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.md
  },
  storyHeaderCopy: {
    flex: 1,
    gap: tokens.space.xs
  },
  monogram: {
    alignItems: "center",
    borderColor: tokens.color.borderStrong,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  monogramText: {
    color: tokens.color.accentInk
  },
  storyBody: {
    gap: tokens.space.md
  },
  lesson: {
    borderTopColor: tokens.color.border,
    borderTopWidth: 1,
    gap: tokens.space.xs,
    paddingTop: tokens.space.lg
  },
  caseCard: {
    gap: tokens.space.md
  },
  casePrompt: {
    gap: tokens.space.xs
  },
  resolution: {
    backgroundColor: tokens.color.backgroundRaised,
    borderRadius: tokens.radius.md,
    gap: tokens.space.xs,
    padding: tokens.space.md
  },
  conceptCard: {
    gap: tokens.space.sm
  },
  conceptPlain: {
    gap: tokens.space.xs
  },
  completion: {
    alignItems: "center",
    borderTopColor: tokens.color.border,
    borderTopWidth: 1,
    gap: tokens.space.xs,
    paddingTop: tokens.space.xl
  },
  doneRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.sm,
    minHeight: 44
  },
  doneMark: {
    backgroundColor: tokens.color.accent,
    borderRadius: tokens.radius.pill,
    height: 8,
    width: 8
  },
  textAction: {
    alignSelf: "flex-start",
    justifyContent: "center",
    minHeight: 44,
    paddingVertical: tokens.space.xs
  },
  textActionPressed: {
    opacity: 0.6
  }
});
