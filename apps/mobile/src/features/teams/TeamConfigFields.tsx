import { StyleSheet, View } from "react-native";

import { AppText, PressableSurface } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import type { ContentLanguage } from "../today/contentTypes";
import {
  ARTICLE_COUNT_CHOICES,
  MINI_CASE_TOPIC_CHOICES,
  NEWSLETTER_TOPIC_CHOICES,
  miniCaseTopicLabel,
  newsletterTopicLabel,
  setNewsletterArticleCount,
  toggleMiniCaseTopic,
  toggleNewsletterTopic,
  type TeamConfigDraft
} from "./teamConfigOptions";
import { getTeamsCopy } from "./teamsCopy";

/**
 * The topic pickers, shared by Create and by Manage.
 *
 * One component so a Team is configured the same way on the day it is founded
 * and a month later — the alternative is two lists that agree until one of them
 * is edited.
 *
 * THE ARTICLE COUNT IS 1 OR 2 AND THE CONTROL ONLY OFFERS TWO VALUES. Not a
 * stepper that could reach 3 and be refused by a CHECK constraint after the
 * fact: an edition publishes at most two articles per topic, so three is not a
 * number this screen can express.
 */
export function TeamConfigFields({
  draft,
  language,
  onChange
}: {
  draft: TeamConfigDraft;
  language: ContentLanguage;
  onChange: (next: TeamConfigDraft) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getTeamsCopy(language);

  return (
    <View style={styles.root}>
      <View style={styles.section}>
        <AppText color="muted" variant="eyebrow">
          {copy.newsletterTopics}
        </AppText>
        <AppText color="mutedSoft" variant="caption">
          {copy.newsletterTopicsHelp}
        </AppText>

        <View style={styles.list}>
          {NEWSLETTER_TOPIC_CHOICES.map((choice) => {
            const selected = choice.topicId in draft.newsletter;
            const count = draft.newsletter[choice.topicId] ?? 1;
            const label = newsletterTopicLabel(choice.topicId, language);

            return (
              <View key={choice.topicId} style={styles.topicBlock}>
                <PressableSurface
                  accessibilityLabel={label}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onChange(toggleNewsletterTopic(draft, choice.topicId))}
                  variant="row"
                >
                  <View style={styles.topicRow}>
                    <AppText
                      color={selected ? "ink" : "muted"}
                      style={styles.topicLabel}
                      variant={selected ? "bodyStrong" : "body"}
                    >
                      {label}
                    </AppText>
                    <AppText color={selected ? "accentInk" : "mutedSoft"} variant="caption">
                      {selected ? copy.articlesCount(count) : copy.noTopicsChosen}
                    </AppText>
                  </View>
                </PressableSurface>

                {selected ? (
                  <View style={styles.counts}>
                    {ARTICLE_COUNT_CHOICES.map((value) => (
                      <CountChip
                        active={count === value}
                        key={value}
                        label={copy.articlesCount(value)}
                        onPress={() =>
                          onChange(setNewsletterArticleCount(draft, choice.topicId, value))
                        }
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <AppText color="muted" variant="eyebrow">
          {copy.miniCaseTopics}
        </AppText>
        <AppText color="mutedSoft" variant="caption">
          {copy.miniCaseTopicsHelp}
        </AppText>

        <View style={styles.list}>
          {MINI_CASE_TOPIC_CHOICES.map((topicId) => {
            const selected = draft.miniCases.includes(topicId);
            const label = miniCaseTopicLabel(topicId, language);

            return (
              <PressableSurface
                accessibilityLabel={label}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={topicId}
                onPress={() => onChange(toggleMiniCaseTopic(draft, topicId))}
                variant="row"
              >
                <View style={styles.topicRow}>
                  <AppText
                    color={selected ? "ink" : "muted"}
                    style={styles.topicLabel}
                    variant={selected ? "bodyStrong" : "body"}
                  >
                    {label}
                  </AppText>
                  {selected ? (
                    <AppText color="accentInk" variant="caption">
                      {copy.selected}
                    </AppText>
                  ) : null}
                </View>
              </PressableSurface>
            );
          })}
        </View>
      </View>

      <AppText color="mutedSoft" variant="caption">
        {copy.configNote}
      </AppText>
    </View>
  );
}

function CountChip({
  active,
  label,
  onPress
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <PressableSurface
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : null]}
      variant="row"
    >
      <AppText color={active ? "onAccent" : "muted"} variant="caption">
        {label}
      </AppText>
    </PressableSurface>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    root: {
      gap: tokens.space.xl
    },
    section: {
      gap: tokens.space.sm
    },
    list: {
      gap: tokens.space.xs,
      marginTop: tokens.space.sm
    },
    topicBlock: {
      gap: tokens.space.xs
    },
    topicRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md,
      // Comfortably above the 44pt minimum at every Dynamic Type size.
      minHeight: 44
    },
    topicLabel: {
      flex: 1
    },
    counts: {
      flexDirection: "row",
      gap: tokens.space.sm,
      paddingBottom: tokens.space.sm
    },
    chip: {
      alignItems: "center",
      borderColor: c.border,
      borderRadius: tokens.radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: "center",
      minHeight: 44,
      paddingHorizontal: tokens.space.md
    },
    chipActive: {
      backgroundColor: c.accent,
      borderColor: c.accent
    }
  });
