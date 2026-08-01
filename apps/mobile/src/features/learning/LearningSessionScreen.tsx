import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";

import { AppScreen, AppText, Card, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { trackAnalyticsEvent } from "../../lib/analytics";
import type { Language } from "../../types/domain";
import { getLearningCopy } from "./learningCopy";
import { copyLearningPrompt, copyPromptAndOpenProvider } from "./learningPromptCopy";
import { useLearningPath } from "./LearningPathContext";
import { LEARNING_PROVIDER_LINKS } from "./providerLinks";
import type { LearningProviderId } from "./learningTypes";
import {
  localizeLearningField,
  localizeSessionObjectives,
  localizeSessionSummary,
  localizeSessionTitle
} from "./learningTypes";

export function LearningSessionScreen({ language }: { language: Language | null | undefined }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const sessionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const {
    displayDomain,
    displayObjective,
    getSessionById,
    markSessionOpened,
    recordSessionStartedAfterPromptCopy,
    status
  } = useLearningPath();
  const styles = useThemedStyles(createStyles);
  const copy = getLearningCopy(language).session;
  const session = sessionId ? getSessionById(sessionId) : undefined;
  const [promptVisible, setPromptVisible] = useState(false);
  const [promptUsed, setPromptUsed] = useState(
    Boolean(session?.started_at) || session?.status === "started" || session?.status === "completed"
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "danger">("success");
  const openedSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session || openedSessionIdRef.current === session.id) {
      return;
    }

    openedSessionIdRef.current = session.id;
    trackAnalyticsEvent("learning_session_opened", {
      language: language ?? undefined
    });

    void markSessionOpened(session.id);
  }, [language, markSessionOpened, session]);

  useEffect(() => {
    setPromptUsed(Boolean(session?.started_at) || session?.status === "started" || session?.status === "completed");
  }, [session?.started_at, session?.status]);

  const copyPrompt = async () => {
    if (!session?.prompt_text || !session.id) {
      return { copied: false, syncPending: false };
    }

    const result = await copyLearningPrompt({
      promptText: session.prompt_text,
      sessionId: session.id,
      copyToClipboard: Clipboard.setStringAsync,
      recordSessionStartedAfterPromptCopy
    });

    if (!result.copied) {
      setStatusTone("danger");
      setStatusMessage(copy.copyFailed);
      return result;
    }

    setPromptUsed(true);
    setStatusTone("success");
    setStatusMessage(result.syncPending ? copy.syncPending : copy.promptCopied);
    trackAnalyticsEvent("learning_prompt_copied", {
      language: language ?? undefined
    });
    return { copied: true, syncPending: result.syncPending };
  };

  const openProvider = async (providerId: LearningProviderId) => {
    const provider = LEARNING_PROVIDER_LINKS[providerId];

    await copyPromptAndOpenProvider({
      providerId,
      providerUrl: provider.url,
      copyPrompt,
      canOpenUrl: Linking.canOpenURL,
      openUrl: Linking.openURL,
      onPromptReady: (copied) => {
        setPromptUsed(true);
        setStatusTone("success");
        setStatusMessage(copied.syncPending ? copy.syncPending : copy.promptCopied);
      },
      onCopyFailed: () => {
        setStatusTone("danger");
        setStatusMessage(copy.copyFailed);
      },
      onOpenFailed: () => {
        setStatusTone("danger");
        setStatusMessage(copy.openFailed);
      },
      onOpenSucceeded: (_providerId, copied) => {
        setStatusTone("success");
        setStatusMessage(copied.syncPending ? copy.syncPending : copy.promptCopied);
        trackAnalyticsEvent("learning_provider_opened", {
          language: language ?? undefined
        });
      }
    });
  };

  if (status === "loading") {
    return (
      <AppScreen centered>
        <Card elevated padding="lg">
          <AppText variant="title">{copy.loading}</AppText>
        </Card>
      </AppScreen>
    );
  }

  if (!session) {
    return (
      <AppScreen centered>
        <Card elevated padding="lg">
          <AppText variant="eyebrow">{copy.eyebrow}</AppText>
          <AppText variant="title">{copy.unavailableTitle}</AppText>
          <AppText color="muted" variant="body">
            {copy.unavailableBody}
          </AppText>
          <PrimaryButton label={copy.backToday} onPress={() => router.replace("/(tabs)/today")} />
        </Card>
      </AppScreen>
    );
  }

  return (
    <AppScreen contentStyle={styles.screen}>
      <View style={styles.header}>
        <AppText variant="eyebrow">{copy.eyebrow}</AppText>
        {displayDomain && displayObjective ? (
          <AppText color="muted" variant="caption">
            {`${localizeLearningField(displayDomain, language)} · ${localizeLearningField(
              displayObjective,
              language
            )}`}
          </AppText>
        ) : null}
        <AppText color="muted" variant="eyebrow">
          {copy.sessionLabel(session.session_number)}
        </AppText>
        <AppText variant="title">{localizeSessionTitle(session, language)}</AppText>
        <AppText color="muted" variant="read">
          {localizeSessionSummary(session, language)}
        </AppText>
        <AppText color="accentInk" variant="label">
          {copy.duration}
        </AppText>
      </View>

      <Card padding="lg">
        <AppText variant="subtitle">{copy.objectives}</AppText>
        {localizeSessionObjectives(session, language)
          .slice(0, 3)
          .map((objective) => (
            <View key={objective} style={styles.objectiveRow}>
              <View style={styles.dot} />
              <AppText color="inkSoft" style={styles.objectiveCopy} variant="body">
                {objective}
              </AppText>
            </View>
          ))}
      </Card>

      <Card padding="lg" tone="muted">
        <AppText variant="subtitle">{copy.openWith}</AppText>
        <View style={styles.providerGrid}>
          {(Object.keys(LEARNING_PROVIDER_LINKS) as LearningProviderId[]).map((providerId) => (
            <SecondaryButton
              key={providerId}
              label={LEARNING_PROVIDER_LINKS[providerId].label}
              onPress={() => {
                void openProvider(providerId);
              }}
            />
          ))}
        </View>
        <SecondaryButton
          label={copy.copyPrompt}
          onPress={() => {
            void copyPrompt();
          }}
        />
        {statusMessage ? (
          <AppText color={statusTone} variant="body">
            {statusMessage}
          </AppText>
        ) : null}
      </Card>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: promptVisible }}
        onPress={() => setPromptVisible((current) => !current)}
        style={({ pressed }) => [styles.promptToggle, pressed ? styles.pressed : null]}
      >
        <AppText color="accentInk" variant="label">
          {promptVisible ? copy.hidePrompt : copy.viewPrompt}
        </AppText>
      </Pressable>

      {promptVisible ? (
        <Card padding="md" tone="muted">
          <AppText selectable color="inkSoft" variant="body">
            {session.prompt_text}
          </AppText>
        </Card>
      ) : null}

      {!promptUsed ? (
        <AppText color="muted" variant="caption">
          {copy.completeLocked}
        </AppText>
      ) : null}

      <PrimaryButton
        disabled={!promptUsed}
        label={copy.complete}
        onPress={() =>
          router.push(
            { pathname: "/(learning)/feedback/[id]", params: { id: session.id } } as unknown as Href
          )
        }
      />
    </AppScreen>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    dot: {
      backgroundColor: c.accent,
      borderRadius: tokens.radius.pill,
      height: 7,
      marginTop: 9,
      width: 7
    },
    header: {
      gap: tokens.space.sm
    },
    objectiveCopy: {
      flex: 1
    },
    objectiveRow: {
      flexDirection: "row",
      gap: tokens.space.sm
    },
    pressed: {
      opacity: 0.72
    },
    promptToggle: {
      alignSelf: "flex-start",
      minHeight: 44,
      justifyContent: "center"
    },
    providerGrid: {
      gap: tokens.space.sm
    },
    screen: {
      gap: tokens.space.xl,
      paddingBottom: tokens.space.xxl
    }
  });
