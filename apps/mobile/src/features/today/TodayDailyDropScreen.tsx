import { useRouter, type Href } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { AppScreen, AppText, Card, EmptyState } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { localized } from "../../lib/i18n";
import {
  estimateReadMinutes,
  formatDropDate,
  getConceptCategoryLabel,
  getDifficultyLabel,
  getTopicLabel
} from "./contentCopy";
import { useDailyDrop } from "./DailyDropContext";
import type {
  BusinessStory,
  ContentLanguage,
  KeyConcept,
  MiniCaseChallenge,
  NewsletterArticle
} from "./contentTypes";

type ReaderKind = "newsletter" | "story" | "mini-case";

// The generated expo-router types lag behind newly added route files, so we
// build the reader href once and keep navigation typed at the call sites.
function readerHref(kind: ReaderKind, id: string): Href {
  return { pathname: `/(reader)/${kind}/[id]`, params: { id } } as unknown as Href;
}

export function TodayDailyDropScreen() {
  const router = useRouter();
  const {
    language,
    drop,
    progress,
    isEmptyDrop,
    isComplete,
    isItemComplete,
    isModuleComplete,
    markItemsComplete,
    reload
  } = useDailyDrop();
  const styles = useThemedStyles(createStyles);
  const copy = getTodayCopy(language);

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
        <AppText variant="eyebrow">{formatDropDate(drop.drop_date, language)}</AppText>
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
          onActionPress={reload}
          title={copy.emptyTitle}
        />
      ) : (
        <>
          {newsletter.length > 0 ? (
            <NewsletterLead
              articles={newsletter}
              isItemComplete={isItemComplete}
              language={language}
              onOpen={(id) => router.push(readerHref("newsletter", id))}
            />
          ) : null}

          {story ? (
            <BusinessStoryFeature
              completed={isModuleComplete([story])}
              language={language}
              onOpen={() => router.push(readerHref("story", story.id))}
              story={story}
            />
          ) : null}

          {miniCase ? (
            <MiniCaseInvitation
              challenge={miniCase}
              completed={isModuleComplete([miniCase])}
              language={language}
              onOpen={() => router.push(readerHref("mini-case", miniCase.id))}
            />
          ) : null}

          {concept ? (
            <ConceptNote
              completed={isModuleComplete([concept])}
              concept={concept}
              language={language}
              onKeep={() => {
                void markItemsComplete([concept]);
              }}
            />
          ) : null}

          {isComplete ? <CompletionNote language={language} /> : null}
        </>
      )}
    </AppScreen>
  );
}

function EditionProgress({ value }: { value: number }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.round(value * 100)}%` }]} />
    </View>
  );
}

function Kicker({ label, meta }: { label: string; meta?: string }) {
  const styles = useThemedStyles(createStyles);

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

function ModuleFooter({
  completed,
  completedLabel,
  openLabel
}: {
  completed: boolean;
  completedLabel: string;
  openLabel: string;
}) {
  const styles = useThemedStyles(createStyles);

  if (completed) {
    return (
      <View style={styles.statusRow}>
        <View style={styles.statusDot} />
        <AppText color="accentInk" variant="label">
          {completedLabel}
        </AppText>
      </View>
    );
  }

  return (
    <View style={styles.statusRow}>
      <AppText color="accentInk" variant="label">
        {openLabel}
      </AppText>
      <AppText color="accentInk" style={styles.arrow} variant="label">
        →
      </AppText>
    </View>
  );
}

function NewsletterLead({
  articles,
  isItemComplete,
  language,
  onOpen
}: {
  articles: NewsletterArticle[];
  isItemComplete: (id: string) => boolean;
  language: ContentLanguage;
  onOpen: (id: string) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getTodayCopy(language);
  const [lead, ...rest] = articles;

  return (
    <View style={styles.lead}>
      <Pressable
        accessibilityRole="button"
        onPress={() => onOpen(lead.id)}
        style={({ pressed }) => [styles.leadMain, pressed ? styles.pressed : null]}
      >
        <Kicker label={copy.laUne} meta={copy.minuteCount(estimateReadMinutes(lead))} />
        <AppText color="muted" variant="caption">
          {getTopicLabel(lead.topic, language)}
        </AppText>
        <AppText style={styles.leadHeadline} variant="display">
          {lead.title}
        </AppText>
        <AppText variant="lede">{lead.summary}</AppText>
        <ModuleFooter
          completed={isItemComplete(lead.id)}
          completedLabel={copy.read}
          openLabel={copy.readLead}
        />
      </Pressable>

      {rest.length > 0 ? (
        <View style={styles.alsoBlock}>
          <AppText color="muted" variant="eyebrow">
            {copy.alsoInBrief}
          </AppText>
          {rest.map((article) => (
            <Pressable
              accessibilityRole="button"
              key={article.id}
              onPress={() => onOpen(article.id)}
              style={({ pressed }) => [styles.alsoItem, pressed ? styles.pressed : null]}
            >
              <AppText color="muted" variant="caption">
                {getTopicLabel(article.topic, language)}
              </AppText>
              <AppText variant="subtitle">{article.title}</AppText>
              {isItemComplete(article.id) ? (
                <View style={styles.statusRow}>
                  <View style={styles.statusDot} />
                  <AppText color="accentInk" variant="caption">
                    {copy.read}
                  </AppText>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function BusinessStoryFeature({
  completed,
  language,
  onOpen,
  story
}: {
  completed: boolean;
  language: ContentLanguage;
  onOpen: () => void;
  story: BusinessStory;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getTodayCopy(language);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      <Card padding="lg" style={styles.storyCard}>
        <View style={styles.storyHeader}>
          <Monogram label={story.company_or_market} />
          <View style={styles.storyHeaderCopy}>
            <AppText variant="eyebrow">{copy.storyKicker}</AppText>
            <AppText color="muted" variant="caption">
              {`${story.company_or_market} · ${copy.minuteCount(estimateReadMinutes(story))}`}
            </AppText>
          </View>
        </View>

        <AppText variant="title">{story.title}</AppText>
        <AppText color="inkSoft" variant="read">
          {story.setup}
        </AppText>

        <ModuleFooter
          completed={completed}
          completedLabel={copy.read}
          openLabel={copy.readStory}
        />
      </Card>
    </Pressable>
  );
}

function MiniCaseInvitation({
  challenge,
  completed,
  language,
  onOpen
}: {
  challenge: MiniCaseChallenge;
  completed: boolean;
  language: ContentLanguage;
  onOpen: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getTodayCopy(language);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      <Card padding="lg" style={styles.caseCard} tone="accent">
        <Kicker
          label={copy.caseKicker}
          meta={`${getTopicLabel(challenge.topic, language)} · ${getDifficultyLabel(
            challenge.difficulty,
            language
          )}`}
        />
        <AppText variant="title">{challenge.title}</AppText>

        <View style={styles.casePrompt}>
          <AppText color="muted" variant="eyebrow">
            {copy.caseDecision}
          </AppText>
          <AppText variant="lede">{challenge.question}</AppText>
        </View>

        <ModuleFooter
          completed={completed}
          completedLabel={copy.solved}
          openLabel={copy.decide}
        />
      </Card>
    </Pressable>
  );
}

function ConceptNote({
  completed,
  concept,
  language,
  onKeep
}: {
  completed: boolean;
  concept: KeyConcept;
  language: ContentLanguage;
  onKeep: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getTodayCopy(language);

  return (
    <Card padding="md" style={styles.conceptCard} tone="muted">
      <Kicker label={copy.conceptKicker} meta={getConceptCategoryLabel(concept, language)} />
      <AppText variant="subtitle">{concept.title}</AppText>
      <AppText color="inkSoft" variant="read">
        {concept.plain_english}
      </AppText>
      {completed ? (
        <View style={styles.statusRow}>
          <View style={styles.statusDot} />
          <AppText color="accentInk" variant="label">
            {copy.kept}
          </AppText>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={onKeep}
          style={({ pressed }) => [styles.textAction, pressed ? styles.pressed : null]}
        >
          <AppText color="accentInk" variant="label">
            {copy.keepConcept}
          </AppText>
        </Pressable>
      )}
    </Card>
  );
}

function CompletionNote({ language }: { language: ContentLanguage }) {
  const styles = useThemedStyles(createStyles);
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
  const styles = useThemedStyles(createStyles);
  const initial = label.trim().charAt(0).toUpperCase() || "•";

  return (
    <View style={styles.monogram}>
      <AppText color="accentInk" variant="subtitle">
        {initial}
      </AppText>
    </View>
  );
}

function getTodayCopy(language: ContentLanguage) {
  return localized(
    {
      en: {
        accessibilityLabel: "Today's brief",
        mastheadTitle: "Today's brief",
        mastheadStandfirst: (minutes: number) => `Your morning edition · ${minutes} min`,
        laUne: "Lead",
        alsoInBrief: "Also in the brief",
        storyKicker: "Business story",
        caseKicker: "Mini case",
        caseDecision: "Your call",
        conceptKicker: "Concept to keep",
        readLead: "Read the lead",
        readStory: "Read the story",
        decide: "Make the call",
        keepConcept: "Keep this concept",
        read: "Read",
        solved: "Solved",
        kept: "Kept",
        minuteCount: (count: number) => `${count} min`,
        completionTitle: "Brief complete",
        completionBody: "You finished today's edition. See you tomorrow.",
        emptyTitle: "Today's brief will be available soon.",
        emptyBody: "Check back in a moment — the new edition is on its way.",
        retry: "Refresh"
      },
      fr: {
        accessibilityLabel: "Le brief du jour",
        mastheadTitle: "Le brief du jour",
        mastheadStandfirst: (minutes: number) => `Votre édition du matin · ${minutes} min`,
        laUne: "La une",
        alsoInBrief: "Aussi dans le brief",
        storyKicker: "Business story",
        caseKicker: "Mini cas",
        caseDecision: "À vous de décider",
        conceptKicker: "Concept à garder",
        readLead: "Lire la une",
        readStory: "Lire l'histoire",
        decide: "Décider",
        keepConcept: "Garder ce concept",
        read: "Lu",
        solved: "Résolu",
        kept: "Gardé",
        minuteCount: (count: number) => `${count} min`,
        completionTitle: "Brief terminé",
        completionBody: "Vous avez terminé l'édition du jour. À demain.",
        emptyTitle: "Le brief du jour arrive bientôt.",
        emptyBody: "Revenez dans un instant — la nouvelle édition est en chemin.",
        retry: "Actualiser"
      }
    },
    language
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    screenContent: {
      gap: tokens.space.xl,
      paddingBottom: tokens.space.xxl
    },
    masthead: {
      gap: tokens.space.sm
    },
    progressTrack: {
      backgroundColor: c.surfaceMuted,
      borderRadius: tokens.radius.pill,
      height: 3,
      marginTop: tokens.space.sm,
      overflow: "hidden"
    },
    progressFill: {
      backgroundColor: c.accent,
      borderRadius: tokens.radius.pill,
      height: "100%"
    },
    kicker: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.sm,
      justifyContent: "space-between"
    },
    pressed: {
      opacity: 0.7
    },
    lead: {
      borderTopColor: c.borderStrong,
      borderTopWidth: 1,
      gap: tokens.space.lg,
      paddingTop: tokens.space.lg
    },
    leadMain: {
      gap: tokens.space.sm
    },
    leadHeadline: {
      marginTop: tokens.space.xs
    },
    alsoBlock: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: tokens.space.lg,
      paddingTop: tokens.space.lg
    },
    alsoItem: {
      gap: tokens.space.xs
    },
    storyCard: {
      gap: tokens.space.md
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
      borderColor: c.borderStrong,
      borderRadius: tokens.radius.pill,
      borderWidth: 1,
      height: 44,
      justifyContent: "center",
      width: 44
    },
    caseCard: {
      gap: tokens.space.md
    },
    casePrompt: {
      gap: tokens.space.xs
    },
    conceptCard: {
      gap: tokens.space.sm
    },
    completion: {
      alignItems: "center",
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: tokens.space.xs,
      paddingTop: tokens.space.xl
    },
    statusRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.sm,
      marginTop: tokens.space.sm,
      minHeight: 32
    },
    statusDot: {
      backgroundColor: c.accent,
      borderRadius: tokens.radius.pill,
      height: 8,
      width: 8
    },
    arrow: {
      marginLeft: -tokens.space.xs
    },
    textAction: {
      alignSelf: "flex-start",
      justifyContent: "center",
      minHeight: 44,
      paddingVertical: tokens.space.xs
    }
  });
