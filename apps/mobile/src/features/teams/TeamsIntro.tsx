import { useReducer } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppText, ContentReveal, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useReducedMotion } from "../../design/useReducedMotion";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { useAuth } from "../auth";
import { ReaderScaffold } from "../today/readers";
import {
  clampIntroStep,
  isLastIntroStep,
  SCORING_STEP_INDEX,
  TEAMS_INTRO_STEPS,
  teamsIntroReducer,
  type TeamsIntroMode,
  type TeamsIntroStep
} from "./teamsIntroRules";
import {
  getTeamsIntroCopy,
  type TeamsIntroCopy,
  type TeamsIntroItem,
  type TeamsIntroTier
} from "./teamsIntroCopy";

/**
 * The Teams introduction: three pages, one at a time.
 *
 * A vertical page per step rather than a swipe pager — the app has no pager
 * pattern, a pager would need a package, and a vertical page grows with Dynamic
 * Type where a fixed-height card would clip. Progress is drawn and spoken
 * (1/3, "Step 1 of 3"), and the buttons are the shared ones, so every target
 * clears 44pt and follows the theme.
 *
 * This component only presents. It never writes anything: the landing decides
 * what finishing the first-open introduction means, and "How scoring works"
 * simply closes.
 */
export function TeamsIntro({
  language,
  mode,
  initialStep = 0,
  onFinish
}: {
  language: "fr" | "en";
  mode: TeamsIntroMode;
  initialStep?: number;
  onFinish: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getTeamsIntroCopy(language);
  const reduceMotion = useReducedMotion();
  const [index, dispatch] = useReducer(teamsIntroReducer, initialStep, clampIntroStep);
  const step = TEAMS_INTRO_STEPS[index];
  const last = isLastIntroStep(index);
  const primaryLabel = last ? (mode === "first_open" ? copy.getStarted : copy.done) : copy.continueLabel;

  const page = <StepPage copy={copy} step={step} />;

  return (
    <View style={styles.intro}>
      <StepProgress copy={copy} index={index} total={TEAMS_INTRO_STEPS.length} />

      {reduceMotion ? page : <ContentReveal key={step}>{page}</ContentReveal>}

      <View style={styles.actions}>
        <PrimaryButton
          label={primaryLabel}
          onPress={() => (last ? onFinish() : dispatch({ type: "continue" }))}
        />
        {index > 0 ? <SecondaryButton label={copy.back} onPress={() => dispatch({ type: "back" })} /> : null}
      </View>
    </View>
  );
}

/**
 * "How scoring works", opened by hand from Teams. The same pages, starting on
 * the points; Done and the back arrow both just close. Nothing is recorded, so
 * reopening it can never bring back — or cancel — the first-open introduction.
 */
export function TeamsScoringGuideScreen() {
  const router = useRouter();
  const { profileLanguage } = useAuth();
  const language = profileLanguage ?? "en";
  const copy = getTeamsIntroCopy(language);

  return (
    <ReaderScaffold
      closeLabel={copy.close}
      eyebrow={copy.howScoringWorks}
      iconName="help-circle"
      onClose={() => router.back()}
    >
      <TeamsIntro
        initialStep={SCORING_STEP_INDEX}
        language={language}
        mode="manual"
        onFinish={() => router.back()}
      />
    </ReaderScaffold>
  );
}

function StepProgress({ copy, index, total }: { copy: TeamsIntroCopy; index: number; total: number }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View
      accessibilityLabel={copy.progressSpoken(index + 1, total)}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: total, now: index + 1 }}
      accessible
      style={styles.progress}
    >
      <View style={styles.progressTrack}>
        {Array.from({ length: total }, (_unused, segment) => (
          <View
            key={segment}
            style={[styles.progressSegment, segment <= index ? styles.progressSegmentDone : null]}
          />
        ))}
      </View>
      <AppText color="muted" variant="caption">
        {copy.progress(index + 1, total)}
      </AppText>
    </View>
  );
}

function StepPage({ copy, step }: { copy: TeamsIntroCopy; step: TeamsIntroStep }) {
  const styles = useThemedStyles(createStyles);
  const section = copy[step];

  return (
    <View style={styles.page}>
      <View style={styles.heading}>
        <AppText color="accentInk" variant="eyebrow">
          {section.eyebrow}
        </AppText>
        <AppText accessibilityRole="header" variant="title">
          {section.title}
        </AppText>
        {step === "points" ? (
          <AppText color="inkSoft" variant="lede">
            {copy.points.lede}
          </AppText>
        ) : null}
      </View>

      {step === "points" ? (
        <View style={styles.tiers}>
          {copy.points.tiers.map((tier) => (
            <TierRow key={tier.name} tier={tier} />
          ))}
          <View style={styles.timeout}>
            <TierRow muted tier={copy.points.timeout} />
          </View>
          <AppText color="inkSoft" variant="body">
            {copy.points.after}
          </AppText>
        </View>
      ) : (
        <View style={styles.items}>
          {copy[step].items.map((item) => (
            <ItemRow item={item} key={item.heading} />
          ))}
        </View>
      )}
    </View>
  );
}

function ItemRow({ item }: { item: TeamsIntroItem }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.item}>
      <AppText color="ink" variant="bodyStrong">
        {item.heading}
      </AppText>
      <AppText color="inkSoft" variant="body">
        {item.body}
      </AppText>
    </View>
  );
}

/** One score: its value, its name, a bar filled to its share of the point. */
function TierRow({ tier, muted = false }: { tier: TeamsIntroTier; muted?: boolean }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View
      accessibilityLabel={`${tier.value}. ${tier.name}. ${tier.body}`}
      accessible
      style={styles.tier}
    >
      <View style={styles.tierHead}>
        <AppText color={muted ? "muted" : "accentInk"} style={styles.tierValue} variant="subtitle">
          {tier.value}
        </AppText>
        <AppText color={muted ? "muted" : "ink"} variant="bodyStrong">
          {tier.name}
        </AppText>
      </View>
      <View style={styles.tierTrack}>
        <View style={[styles.tierFill, { width: `${Math.round(tier.share * 100)}%` }]} />
      </View>
      <AppText color="inkSoft" variant="body">
        {tier.body}
      </AppText>
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    intro: {
      gap: tokens.space.xl
    },
    progress: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md
    },
    progressTrack: {
      flex: 1,
      flexDirection: "row",
      gap: tokens.space.xs
    },
    progressSegment: {
      backgroundColor: c.border,
      borderRadius: 2,
      flex: 1,
      height: 4
    },
    progressSegmentDone: {
      backgroundColor: c.accent
    },
    page: {
      gap: tokens.space.lg
    },
    heading: {
      gap: tokens.space.sm
    },
    items: {
      gap: tokens.space.lg
    },
    item: {
      gap: tokens.space.xs
    },
    tiers: {
      gap: tokens.space.lg
    },
    tier: {
      gap: tokens.space.xs
    },
    tierHead: {
      alignItems: "baseline",
      flexDirection: "row",
      gap: tokens.space.md
    },
    tierValue: {
      minWidth: 40
    },
    tierTrack: {
      backgroundColor: c.surfaceMuted,
      borderRadius: 3,
      height: 6,
      overflow: "hidden"
    },
    tierFill: {
      backgroundColor: c.accent,
      height: "100%"
    },
    timeout: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      paddingTop: tokens.space.lg
    },
    actions: {
      gap: tokens.space.sm
    }
  });
