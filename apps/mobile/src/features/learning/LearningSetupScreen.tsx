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
import { useAuth } from "../auth";
import { SelectableCard } from "../onboarding";
import {
  getAllowedTargetLevelOptions,
  getCurrentLevelLabel,
  getCurrentLevelOptions,
  getTargetLevelLabel
} from "./learningLevels";
import { getLearningCopy } from "./learningCopy";
import {
  getLearningSetupDraftKey,
  LEARNING_SETUP_DRAFT_KEY_V1,
  parseLearningSetupDraft,
  reconcileLearningSetupDraft,
  type LearningSetupStep
} from "./learningSetupDraft";
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

type SetupStep = LearningSetupStep;

export function LearningSetupScreen({ language }: { language: Language | null | undefined }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ replace?: string; onboarding?: string }>();
  const replacing = params.replace === "1";
  const fromOnboarding = params.onboarding === "1";
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const copy = getLearningCopy(language).setup;
  const { user } = useAuth();
  const {
    domains,
    disableLearningPath,
    error,
    objectives,
    reload,
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
  // The draft is only written back once it has been read and reconciled with the
  // live data, so an empty initial state can never overwrite it.
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [reloading, setReloading] = useState(false);
  const loadFailed = status === "error";

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
  const targetOptions = getAllowedTargetLevelOptions(currentLevel, language);
  const canContinue =
    !loadFailed &&
    ((step === 0 && Boolean(domainId)) ||
      (step === 1 && Boolean(currentLevel)) ||
      (step === 2 && Boolean(targetLevel)) ||
      (step === 3 && Boolean(objectiveId)) ||
      step === 4);

  useEffect(() => {
    trackAnalyticsEvent("learning_setup_started", {
      language: language ?? undefined
    });
  }, [language]);

  useEffect(() => {
    // Hydration needs the live domains and orientations to check the draft
    // against them, so it waits for a successful load and runs exactly once.
    if (draftHydrated || status !== "ready") {
      return;
    }

    let cancelled = false;

    async function restoreDraft() {
      try {
        const draftKey = getLearningSetupDraftKey(user?.id);
        const value =
          (await AsyncStorage.getItem(draftKey)) ?? (await AsyncStorage.getItem(LEARNING_SETUP_DRAFT_KEY_V1));
        if (cancelled) {
          return;
        }

        const restored = reconcileLearningSetupDraft(parseLearningSetupDraft(value), {
          domains,
          objectives
        });

        setDomainId(restored.domainId);
        setObjectiveId(restored.objectiveId);
        setCurrentLevel(restored.currentLevel);
        setTargetLevel(restored.targetLevel);
        setStep(restored.currentStep);
      } catch (restoreError) {
        if (__DEV__) {
          console.warn("[LearningSetup] Could not restore draft", restoreError);
        }
      } finally {
        if (!cancelled) {
          setDraftHydrated(true);
        }
      }
    }

    void restoreDraft();

    return () => {
      cancelled = true;
    };
  }, [domains, draftHydrated, objectives, status, user?.id]);

  useEffect(() => {
    if (!draftHydrated) {
      return;
    }

    void AsyncStorage.setItem(
      getLearningSetupDraftKey(user?.id),
      JSON.stringify({
        domainId,
        currentLevel,
        targetLevel,
        objectiveId,
        currentStep: step,
        updatedAt: new Date().toISOString()
      })
    );
  }, [currentLevel, domainId, draftHydrated, objectiveId, step, targetLevel, user?.id]);

  useEffect(() => {
    if (!loadFailed || !error) {
      return;
    }
    if (__DEV__) {
      console.warn("[LearningSetup] learning path data failed to load", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
    }
  }, [error, loadFailed]);

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

    await AsyncStorage.removeItem(getLearningSetupDraftKey(user?.id));
    await AsyncStorage.removeItem(LEARNING_SETUP_DRAFT_KEY_V1);
    router.replace("/(tabs)/today");
  };

  const handleRetry = async () => {
    setReloading(true);
    setErrorMessage(null);
    await reload();
    setReloading(false);
  };

  const handleNotNow = async () => {
    setSubmitting(true);
    const result = await disableLearningPath();
    setSubmitting(false);

    if (!result.ok) {
      setErrorMessage(result.error?.message ?? copy.error);
      return;
    }

    await AsyncStorage.removeItem(getLearningSetupDraftKey(user?.id));
    await AsyncStorage.removeItem(LEARNING_SETUP_DRAFT_KEY_V1);
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

      {loadFailed ? (
        <View style={styles.step}>
          <Card padding="lg">
            <View style={styles.errorCard}>
              <AppText variant="subtitle">{copy.loadErrorTitle}</AppText>
              <AppText color="muted" variant="body">
                {copy.loadErrorBody}
              </AppText>
              {error?.message ? (
                <AppText color="muted" variant="caption">
                  {error.message}
                </AppText>
              ) : null}
              <PrimaryButton
                disabled={reloading}
                label={reloading ? copy.retrying : copy.retry}
                loading={reloading}
                onPress={handleRetry}
              />
            </View>
          </Card>
        </View>
      ) : null}

      {!loadFailed && step === 0 ? (
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

      {!loadFailed && step === 1 ? (
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
                setTargetLevel((current) =>
                  current &&
                  getAllowedTargetLevelOptions(option.value, language).some((target) => target.value === current)
                    ? current
                    : null
                );
                setErrorMessage(null);
              }}
              selected={option.value === currentLevel}
            />
          ))}
        </SelectionStep>
      ) : null}

      {!loadFailed && step === 2 ? (
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

      {!loadFailed && step === 3 ? (
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

      {!loadFailed && step === 4 && selectedDomain && selectedObjective && currentLevel && targetLevel ? (
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
        {loadFailed ? null : step < 4 ? (
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

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    actions: {
      gap: tokens.space.md
    },
    errorCard: {
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
