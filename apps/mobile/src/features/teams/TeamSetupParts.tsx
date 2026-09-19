import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import { AppText, Card, IconBadge, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { SelectableCard } from "../onboarding/SelectableCard";
import type { ContentLanguage } from "../today/contentTypes";
import {
  draftEditionShape,
  miniCaseTopicLabel,
  newsletterTopicLabel,
  type TeamConfigDraft
} from "./teamConfigOptions";
import {
  DEFAULT_TEAM_INTENSITY,
  TEAM_INTENSITY_LEVELS,
  applyTeamPreset,
  TEAM_PRESETS,
  type TeamIntensityId,
  type TeamPreset,
  type TeamPresetId
} from "./teamPresets";
import { getTeamsCopy } from "./teamsCopy";

/**
 * The pieces of the guided setup, shared by Create and by Manage's "Start from
 * a preset". Selection looks the way it does everywhere else in the app: the
 * accent Card tone and border of onboarding's SelectableCard, which the
 * intensity step uses as it is.
 */

/** "Step 2 of 3", the title, one line, and Back when there is somewhere to go. */
export function SetupStepHeader({
  body,
  language,
  onBack,
  progress,
  title
}: {
  body: string;
  language: ContentLanguage;
  onBack?: () => void;
  progress: { current: number; total: number } | null;
  title: string;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getTeamsCopy(language);

  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        {onBack ? (
          <Pressable
            accessibilityLabel={copy.setupBack}
            accessibilityRole="button"
            hitSlop={12}
            onPress={onBack}
            style={styles.back}
          >
            <AppText color="accentInk" variant="label">
              {`‹ ${copy.setupBack}`}
            </AppText>
          </Pressable>
        ) : null}
        {progress ? (
          <AppText color="mutedSoft" style={styles.progress} variant="caption">
            {copy.setupStep(progress.current, progress.total)}
          </AppText>
        ) : null}
      </View>
      <AppText accessibilityRole="header" variant="title">
        {title}
      </AppText>
      <AppText color="muted" variant="body">
        {body}
      </AppText>
    </View>
  );
}

/**
 * Eight focused presets in two columns, Balanced across the full width beneath
 * them, and — only on Create — Build from scratch as its own quieter row. Nine
 * equal cards in one column would be a wall; this is four short rows and two.
 */
export function PresetGrid({
  language,
  onBuildFromScratch,
  onSelect,
  selectedId
}: {
  language: ContentLanguage;
  onBuildFromScratch?: () => void;
  onSelect: (presetId: TeamPresetId) => void;
  selectedId: TeamPresetId | null;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getTeamsCopy(language);
  const focused = TEAM_PRESETS.filter((preset) => preset.id !== "balanced");
  const balanced = TEAM_PRESETS.find((preset) => preset.id === "balanced");

  return (
    <View style={styles.grid}>
      <View style={styles.gridRows}>
        {focused.map((preset) => (
          <View key={preset.id} style={styles.gridCell}>
            <PresetTile
              language={language}
              onPress={() => onSelect(preset.id)}
              preset={preset}
              selected={selectedId === preset.id}
            />
          </View>
        ))}
      </View>

      {balanced ? (
        <PresetTile
          language={language}
          onPress={() => onSelect(balanced.id)}
          preset={balanced}
          selected={selectedId === balanced.id}
          wide
        />
      ) : null}

      {onBuildFromScratch ? (
        <Pressable
          accessibilityHint={copy.setupScratchBody}
          accessibilityLabel={copy.setupScratchTitle}
          accessibilityRole="button"
          onPress={onBuildFromScratch}
        >
          {({ pressed }) => (
            <View style={[styles.scratch, pressed ? styles.scratchPressed : null]}>
              <IconBadge name="sliders" size="sm" tone="muted" />
              <View style={styles.tileCopy}>
                <AppText variant="bodyStrong">{copy.setupScratchTitle}</AppText>
                <AppText color="muted" variant="caption">
                  {copy.setupScratchBody}
                </AppText>
              </View>
            </View>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function PresetTile({
  language,
  onPress,
  preset,
  selected,
  wide = false
}: {
  language: ContentLanguage;
  onPress: () => void;
  preset: TeamPreset;
  selected: boolean;
  wide?: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const text = getTeamsCopy(language).presets[preset.id];

  return (
    <Pressable
      accessibilityHint={text.body}
      accessibilityLabel={text.name}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.tilePressable}
    >
      {({ pressed }) => (
        <Card
          padding="md"
          style={[
            styles.tile,
            wide ? styles.tileWide : null,
            selected ? styles.tileSelected : null,
            pressed ? styles.tilePressed : null
          ]}
          tone={selected ? "accent" : "default"}
        >
          <IconBadge name={preset.icon} size="sm" tone={selected ? "accent" : "default"} />
          <View style={styles.tileCopy}>
            <AppText variant="bodyStrong">{text.name}</AppText>
            <AppText color="muted" variant="caption">
              {text.body}
            </AppText>
          </View>
        </Card>
      )}
    </Pressable>
  );
}

/** Chill / Regular / Intensive, Regular marked as the recommendation. */
export function IntensityOptions({
  language,
  onSelect,
  selectedId
}: {
  language: ContentLanguage;
  onSelect: (intensityId: TeamIntensityId) => void;
  selectedId: TeamIntensityId;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getTeamsCopy(language);

  return (
    <View accessibilityRole="radiogroup" style={styles.options}>
      {TEAM_INTENSITY_LEVELS.map((level) => (
        <SelectableCard
          // Said in the description, not as a badge: SelectableCard's badge
          // replaces the selection dot, and one row without a dot would read as
          // a different kind of control.
          description={
            level.id === DEFAULT_TEAM_INTENSITY
              ? `${copy.intensities[level.id].body} ${copy.setupRecommended}.`
              : copy.intensities[level.id].body
          }
          key={level.id}
          label={copy.intensities[level.id].name}
          onPress={() => onSelect(level.id)}
          selected={selectedId === level.id}
        />
      ))}
    </View>
  );
}

/**
 * What the Team will play, in words: the topic names the editor uses, the mini
 * cases, and the volume of one edition. It describes the configuration, not a
 * promise about any one edition's inventory.
 */
export function RecommendationSummary({
  draft,
  heading,
  language
}: {
  draft: TeamConfigDraft;
  heading?: string;
  language: ContentLanguage;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getTeamsCopy(language);
  const shape = draftEditionShape(draft);
  const topics = Object.keys(draft.newsletter).map((topicId) => newsletterTopicLabel(topicId, language));
  const miniCases = draft.miniCases.map((topicId) => miniCaseTopicLabel(topicId, language));

  return (
    <Card padding="lg" style={styles.summary}>
      {heading ? (
        <AppText color="accentInk" variant="eyebrow">
          {heading}
        </AppText>
      ) : null}
      <SummaryBlock label={copy.setupTopicsLabel} values={topics} />
      {miniCases.length > 0 ? <SummaryBlock label={copy.setupMiniCasesLabel} values={miniCases} /> : null}
      <View style={styles.summaryRow}>
        <AppText color="muted" variant="caption">
          {copy.setupPerEdition}
        </AppText>
        <AppText variant="bodyStrong">{copy.setupEditionShape(shape.articles, shape.miniCases)}</AppText>
      </View>
    </Card>
  );
}

function SummaryBlock({ label, values }: { label: string; values: string[] }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.summaryRow}>
      <AppText color="muted" variant="caption">
        {label}
      </AppText>
      {values.map((value) => (
        <AppText key={value} variant="body">
          {value}
        </AppText>
      ))}
    </View>
  );
}

/**
 * Manage's "Start from a preset": the same two choices and the same summary as
 * Create, inside the owner's edit screen.
 *
 * IT ONLY EVER REPLACES THE DRAFT ON SCREEN. Applying a preset sets the topics
 * in the editor below, after a confirmation that says so; nothing is written
 * until the owner presses Save, and Save already states the edition the change
 * takes effect from. An existing Team is never re-shaped by opening this, and
 * closing it changes nothing.
 */
export function TeamPresetPanel({
  language,
  onApply,
  onClose
}: {
  language: ContentLanguage;
  onApply: (draft: TeamConfigDraft) => void;
  onClose: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getTeamsCopy(language);
  const [presetId, setPresetId] = useState<TeamPresetId | null>(null);
  const [intensityId, setIntensityId] = useState<TeamIntensityId>(DEFAULT_TEAM_INTENSITY);
  const recommendation = presetId ? applyTeamPreset(presetId, intensityId) : null;

  const confirmReplace = () => {
    if (!recommendation) {
      return;
    }

    Alert.alert(copy.presetReplaceConfirmTitle, copy.presetReplaceConfirmBody, [
      { text: copy.presetCancel, style: "cancel" },
      { text: copy.presetReplaceConfirm, onPress: () => onApply(recommendation) }
    ]);
  };

  return (
    <Card padding="lg" style={styles.panel}>
      <AppText color="muted" variant="body">
        {copy.presetManageBody}
      </AppText>

      <PresetGrid language={language} onSelect={setPresetId} selectedId={presetId} />

      {presetId && recommendation ? (
        <>
          <IntensityOptions language={language} onSelect={setIntensityId} selectedId={intensityId} />
          <RecommendationSummary
            draft={recommendation}
            heading={copy.setupSelectedPreset(copy.presets[presetId].name, copy.intensities[intensityId].name)}
            language={language}
          />
          <PrimaryButton label={copy.presetReplace} onPress={confirmReplace} style={styles.panelAction} />
        </>
      ) : null}

      <SecondaryButton label={copy.presetCancel} onPress={onClose} />
    </Card>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    header: {
      gap: tokens.space.sm,
      marginTop: tokens.space.md
    },
    headerTop: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      minHeight: 28
    },
    back: {
      justifyContent: "center",
      minHeight: 44
    },
    progress: {
      marginLeft: "auto"
    },
    grid: {
      gap: tokens.space.sm,
      marginTop: tokens.space.lg
    },
    gridRows: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.space.sm
    },
    // Two columns: half the row, less half the gap between them.
    gridCell: {
      flexBasis: "48%",
      flexGrow: 1
    },
    tilePressable: {
      flex: 1
    },
    tile: {
      borderColor: c.border,
      flex: 1,
      gap: tokens.space.sm,
      minHeight: 124
    },
    tileWide: {
      alignItems: "center",
      flexDirection: "row",
      minHeight: 0
    },
    tileSelected: {
      borderColor: c.accent
    },
    tilePressed: {
      transform: [{ scale: tokens.press.cardScale }]
    },
    tileCopy: {
      flexShrink: 1,
      gap: tokens.space.xs
    },
    scratch: {
      alignItems: "center",
      borderColor: c.borderStrong,
      borderRadius: tokens.radius.lg,
      borderStyle: "dashed",
      borderWidth: 1,
      flexDirection: "row",
      gap: tokens.space.md,
      marginTop: tokens.space.xs,
      minHeight: 56,
      padding: tokens.space.md
    },
    scratchPressed: {
      backgroundColor: c.pressedSurface
    },
    options: {
      gap: tokens.space.sm,
      marginTop: tokens.space.lg
    },
    summary: {
      gap: tokens.space.md,
      marginTop: tokens.space.lg
    },
    summaryRow: {
      gap: tokens.space.xs
    },
    panel: {
      gap: tokens.space.md
    },
    panelAction: {
      marginTop: tokens.space.md
    }
  });
