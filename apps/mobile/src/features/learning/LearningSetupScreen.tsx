import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";

import { AppScreen, AppText, Card, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../design/theme";
import { trackAnalyticsEvent } from "../../lib/analytics";
import { localized } from "../../lib/i18n";
import type { Language } from "../../types/domain";
import { SelectableCard } from "../onboarding";
import { getCurrentLevelLabel, getCurrentLevelOptions, getTargetLevelLabel, getTargetLevelOptions } from "./learningLevels";
import { getLearningCopy } from "./learningCopy";
import { useLearningPath } from "./LearningPathContext";
import type {
  LearningCurrentLevel,
  LearningDomain,
  LearningObjective,
  LearningTargetLevel
} from "./learningTypes";
import {
  localizeLearningDescription,
  localizeLearningField
} from "./learningTypes";

type SetupStep = 0 | 1 | 2 | 3 | 4;
const LEARNING_SETUP_DRAFT_KEY = "personewsap:learning-setup-draft:v1";

export function LearningSetupScreen({ language }: { language: Language | null | undefined }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ replace?: string; onboarding?: string }>();
  const replacing = params.replace === "1";
  const fromOnboarding = params.onboarding === "1";
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const copy = getLearningCopy(language).setup;
  const {
    domains,
    disableLearningPath,
    objectives,
    startPath,
    status
  } = useLearningPath();
  const [step, setStep] = useState<SetupStep>(0);
  const [domainId, setDomainId] = useState<string | null>(null);
  const [currentLevel, setCurrentLevel] = useState<LearningCurrentLevel | null>(null);
  const [targetLevel, setTargetLevel] = useState<LearningTargetLevel | null>(null);
  const [objectiveId, setObjectiveId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedDomain = domains.find((domain) => domain.id === domainId) ?? null;
  const selectedObjective = objectives.find((objective) => objective.id === objectiveId) ?? null;
  const filteredObjectives = useMemo(
    () =>
      objectives
        .filter((objective) => objective.domain_id === domainId)
        .sort((a, b) => a.position - b.position),
    [domainId, objectives]
  );
  const currentOptions = getCurrentLevelOptions(language);
  const targetOptions = getTargetLevelOptions(language);
  const canContinue =
    (step === 0 && Boolean(domainId)) ||
    (step === 1 && Boolean(currentLevel)) ||
    (step === 2 && Boolean(targetLevel)) ||
    (step === 3 && Boolean(objectiveId)) ||
    step === 4;

  useEffect(() => {
    trackAnalyticsEvent("learning_setup_started", {
      language: language ?? undefined
    });
  }, [language]);

  useEffect(() => {
    let cancelled = false;

    async function restoreDraft() {
      try {
        const value = await AsyncStorage.getItem(LEARNING_SETUP_DRAFT_KEY);
        if (!value || cancelled) {
          return;
        }
        const draft = JSON.parse(value) as Partial<{
          currentLevel: LearningCurrentLevel;
          currentStep: SetupStep;
          domainId: string;
          objectiveId: string;
          targetLevel: LearningTargetLevel;
        }>;
        if (typeof draft.domainId === "string") {
          setDomainId(draft.domainId);
        }
        if (typeof draft.objectiveId === "string") {
          setObjectiveId(draft.objectiveId);
        }
        if (isCurrentLevel(draft.currentLevel)) {
          setCurrentLevel(draft.currentLevel);
        }
        if (isTargetLevel(draft.targetLevel)) {
          setTargetLevel(draft.targetLevel);
        }
        if (typeof draft.currentStep === "number" && draft.currentStep >= 0 && draft.currentStep <= 4) {
          setStep(draft.currentStep);
        }
      } catch (error) {
        if (__DEV__) {
          console.warn("[LearningSetup] Could not restore draft", error);
        }
      }
    }

    void restoreDraft();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(
      LEARNING_SETUP_DRAFT_KEY,
      JSON.stringify({
        domainId,
        currentLevel,
        targetLevel,
        objectiveId,
        currentStep: step,
        updatedAt: new Date().toISOString()
      })
    );
  }, [currentLevel, domainId, objectiveId, step, targetLevel]);

  const moveNext = () => {
    if (!canContinue) {
      setErrorMessage(copy.missingSelection);
      return;
    }
    setErrorMessage(null);
    setStep((current) => Math.min(4, current + 1) as SetupStep);
  };

  const moveBack = () => {
    setErrorMessage(null);
    setStep((current) => Math.max(0, current - 1) as SetupStep);
  };

  const handleCreate = async () => {
    if (!domainId || !objectiveId || !currentLevel || !targetLevel) {
      setErrorMessage(copy.missingSelection);
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    const result = await startPath({
      domainId,
      objectiveId,
      currentLevel,
      targetLevel
    });

    setSubmitting(false);

    if (!result.ok) {
      setErrorMessage(result.error?.message ?? copy.error);
      return;
    }

    if (replacing) {
      trackAnalyticsEvent("learning_path_replaced", {
        language: language ?? undefined
      });
    }

    await AsyncStorage.removeItem(LEARNING_SETUP_DRAFT_KEY);
    router.replace("/(tabs)/today");
  };

  const handleNotNow = async () => {
    setSubmitting(true);
    const result = await disableLearningPath();
    setSubmitting(false);

    if (!result.ok) {
      setErrorMessage(result.error?.message ?? copy.error);
      return;
    }

    await AsyncStorage.removeItem(LEARNING_SETUP_DRAFT_KEY);
    router.replace("/(tabs)/today");
  };

  return (
    <AppScreen contentStyle={styles.screen}>
      <View style={styles.header}>
        <AppText variant="eyebrow">{copy.eyebrow}</AppText>
        <AppText variant="title">{replacing ? copy.replacingTitle : copy.title}</AppText>
        <AppText color="muted" variant="body">
          {copy.subtitle}
        </AppText>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((step + 1) / 5) * 100}%` }]} />
        </View>
        <AppText color="muted" variant="caption">
          {copy.stepLabel(step + 1, 5)}
        </AppText>
      </View>

      {status === "loading" ? (
        <Card padding="lg">
          <ActivityIndicator color={colors.accent} />
        </Card>
      ) : null}

      {step === 0 ? (
        <SelectionStep title={copy.domainTitle}>
          {domains.map((domain) => (
            <SelectableCard
              description={localizeLearningDescription(domain, language)}
              key={domain.id}
              label={localizeLearningField(domain, language)}
              onPress={() => {
                setDomainId(domain.id);
                setObjectiveId(null);
                setErrorMessage(null);
                trackAnalyticsEvent("learning_domain_selected", {
                  language: language ?? undefined
                });
              }}
              selected={domain.id === domainId}
            />
          ))}
        </SelectionStep>
      ) : null}

      {step === 1 ? (
        <SelectionStep title={copy.currentLevelTitle}>
          {currentOptions.map((option) => (
            <SelectableCard
              description={localized(
                {
                  en: `Level ${option.value} of 7`,
                  fr: `Niveau ${option.value} sur 7`
                },
                language
              )}
              key={option.value}
              label={option.label}
              onPress={() => {
                setCurrentLevel(option.value);
                setErrorMessage(null);
              }}
              selected={option.value === currentLevel}
            />
          ))}
        </SelectionStep>
      ) : null}

      {step === 2 ? (
        <SelectionStep title={copy.targetLevelTitle}>
          {targetOptions.map((option) => (
            <SelectableCard
              description={option.description}
              key={option.value}
              label={option.label}
              onPress={() => {
                setTargetLevel(option.value);
                setErrorMessage(null);
              }}
              selected={option.value === targetLevel}
            />
          ))}
        </SelectionStep>
      ) : null}

      {step === 3 ? (
        <SelectionStep title={copy.objectiveTitle}>
          {filteredObjectives.length === 0 ? (
            <Card padding="md" tone="muted">
              <AppText color="muted" variant="body">
                {copy.objectiveEmpty}
              </AppText>
            </Card>
          ) : (
            filteredObjectives.map((objective) => (
              <SelectableCard
                description={localizeLearningDescription(objective, language)}
                key={objective.id}
                label={localizeLearningField(objective, language)}
                onPress={() => {
                  setObjectiveId(objective.id);
                  setErrorMessage(null);
                }}
                selected={objective.id === objectiveId}
              />
            ))
          )}
        </SelectionStep>
      ) : null}

      {step === 4 && selectedDomain && selectedObjective && currentLevel && targetLevel ? (
        <ConfirmationStep
          currentLevel={currentLevel}
          domain={selectedDomain}
          language={language}
          objective={selectedObjective}
          replacing={replacing}
          targetLevel={targetLevel}
        />
      ) : null}

      {errorMessage ? (
        <AppText color="danger" variant="body">
          {errorMessage}
        </AppText>
      ) : null}

      <View style={styles.actions}>
        {step > 0 ? (
          <SecondaryButton disabled={submitting} label={copy.back} onPress={moveBack} />
        ) : fromOnboarding ? (
          <SecondaryButton disabled={submitting} label={copy.notNow} onPress={handleNotNow} />
        ) : null}
        {step < 4 ? (
          <PrimaryButton disabled={!canContinue || submitting} label={copy.next} onPress={moveNext} />
        ) : (
          <PrimaryButton
            disabled={submitting}
            label={submitting ? copy.creating : copy.create}
            loading={submitting}
            onPress={handleCreate}
          />
        )}
      </View>
    </AppScreen>
  );
}

function SelectionStep({ children, title }: { children: ReactNode; title: string }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.step}>
      <AppText variant="subtitle">{title}</AppText>
      <View style={styles.options}>{children}</View>
    </View>
  );
}

function ConfirmationStep({
  currentLevel,
  domain,
  language,
  objective,
  replacing,
  targetLevel
}: {
  currentLevel: LearningCurrentLevel;
  domain: LearningDomain;
  language: Language | null | undefined;
  objective: LearningObjective;
  replacing: boolean;
  targetLevel: LearningTargetLevel;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getLearningCopy(language).setup;

  return (
    <View style={styles.step}>
      <AppText variant="subtitle">{copy.confirmationTitle}</AppText>
      {replacing ? (
        <Card padding="md" tone="muted">
          <AppText color="muted" variant="body">
            {copy.replaceNotice}
          </AppText>
        </Card>
      ) : null}
      <Card padding="lg">
        <SummaryRow label={copy.domain} value={localizeLearningField(domain, language)} />
        <SummaryRow label={copy.orientation} value={localizeLearningField(objective, language)} />
        <SummaryRow label={copy.currentLevel} value={getCurrentLevelLabel(currentLevel, language)} />
        <SummaryRow label={copy.targetLevel} value={getTargetLevelLabel(targetLevel, language)} />
        <SummaryRow label={copy.frequency} value={copy.frequencyValue} />
        <SummaryRow label={copy.duration} value={copy.durationValue} />
        <AppText color="muted" variant="body">
          {copy.providers}
        </AppText>
      </Card>
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.summaryRow}>
      <AppText color="muted" variant="caption">
        {label}
      </AppText>
      <AppText variant="bodyStrong">{value}</AppText>
    </View>
  );
}

function isCurrentLevel(value: unknown): value is LearningCurrentLevel {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7;
}

function isTargetLevel(value: unknown): value is LearningTargetLevel {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    actions: {
      gap: tokens.space.md
    },
    header: {
      gap: tokens.space.sm
    },
    options: {
      gap: tokens.space.md
    },
    progressFill: {
      backgroundColor: c.accent,
      borderRadius: tokens.radius.pill,
      height: "100%"
    },
    progressTrack: {
      backgroundColor: c.surfaceMuted,
      borderRadius: tokens.radius.pill,
      height: 3,
      marginTop: tokens.space.sm,
      overflow: "hidden"
    },
    screen: {
      gap: tokens.space.xl,
      paddingBottom: tokens.space.xxl
    },
    step: {
      gap: tokens.space.md
    },
    summaryRow: {
      gap: tokens.space.xs
    }
  });
