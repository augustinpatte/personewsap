import { useEffect, useReducer, useRef, useState } from "react";
import { Stack, useRouter, type Href } from "expo-router";
import { BackHandler, Image, StyleSheet, TextInput, View, type ScrollView } from "react-native";

import { AppText, Card, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../design/theme";
import { trackAnalyticsEvent } from "../../lib/analytics";
import { useAuth } from "../auth";
import { EditorialRule } from "../modules";
import { formatDropDate, getReaderCopy } from "../today/contentCopy";
import { ReaderScaffold } from "../today/readers";
import { pickAndCompressAvatar } from "./avatarUpload";
import { TeamAvatar } from "./PlayerAvatar";
import { validateTeamName } from "./playerProfile";
import { uploadTeamAvatar } from "./teamAvatarUpload";
import { TeamConfigFields } from "./TeamConfigFields";
import { draftEditionShape, draftHasAGame, draftToNewsletterTopics } from "./teamConfigOptions";
import {
  INITIAL_TEAM_SETUP,
  teamSetupCanGoBack,
  teamSetupDraft,
  teamSetupProgress,
  teamSetupReducer
} from "./teamSetupFlow";
import { IntensityOptions, PresetGrid, RecommendationSummary, SetupStepHeader } from "./TeamSetupParts";
import { getTeamsCopy } from "./teamsCopy";
import { createTeam, saveTeamConfig, setTeamAvatar } from "./teamsData";

/**
 * Creating a Team.
 *
 * THREE SHORT STEPS, THEN THE SAME EDITOR AS BEFORE. Most founders know what
 * their Team is about and roughly how much they want to play, and should not
 * have to learn the topic catalogue to say so: pick a subject, pick a level,
 * see what that means, create. The full editor — every topic, every count —
 * is one tap away at the first step (Build from scratch) and at the last
 * (Customize), and it is the editor Manage uses, unchanged. A preset only
 * writes the draft; the flow's rules live in teamSetupFlow.ts.
 *
 * TWO WRITES, IN ORDER, AND THE SECOND CAN FAIL SAFELY. `create_team` makes the
 * team and its first (empty) config version; `update_team_config` fills that
 * version in. If the second call fails the reader still owns a real Team with a
 * real invite code and can set the topics from Manage — the alternative, holding
 * the team back until the config lands, would lose the team on a dropped
 * connection.
 *
 * THE PHOTO IS OPTIONAL AND IS SENT LAST. A Team's storage path is
 * `<team id>/<file>.jpg` and the id does not exist until `create_team` has
 * returned, so the picture cannot be uploaded before the Team is. It is chosen
 * here, held as a local file, and sent after — and if that send fails the Team
 * still exists, with no photo, exactly as it would for the majority of Teams
 * that never add one. Nothing about creating a Team is ever blocked on it.
 *
 * WHAT IT SAYS AT THE END. "Your Team starts scoring with the next edition."
 * That is the server's rule (`create_team` sets the founder's
 * `eligible_from_edition` to the next scoring edition, exactly as it does for
 * somebody joining) and the screen states it rather than letting it be
 * discovered as a zero that never moves.
 */
export function CreateTeamScreen() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { profileLanguage } = useAuth();
  const language = profileLanguage ?? "en";
  const copy = getTeamsCopy(language);
  const scrollRef = useRef<ScrollView>(null);

  const [setup, dispatch] = useReducer(teamSetupReducer, INITIAL_TEAM_SETUP);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Held locally until the Team has an id to be stored under.
  const [pendingPhoto, setPendingPhoto] = useState<{
    uri: string;
    base64: string;
    bytes: number;
  } | null>(null);
  const [pickingPhoto, setPickingPhoto] = useState(false);

  const draft = teamSetupDraft(setup);
  const shape = draftEditionShape(draft);
  const inFlow = teamSetupCanGoBack(setup);

  // Each step starts at its top, not wherever the last one was scrolled to.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    setError(null);
  }, [setup.step]);

  // Android's back button steps back inside the flow before it leaves it.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!inFlow) {
        return false;
      }

      dispatch({ type: "back" });
      return true;
    });

    return () => subscription.remove();
  }, [inFlow]);

  const nameProblemMessage = () => {
    switch (validateTeamName(name)) {
      case "too_short":
        return copy.nameTooShort;
      case "too_long":
        return copy.nameTooLong;
      case "not_allowed":
        return copy.nameNotAllowed;
      default:
        return null;
    }
  };

  const onChoosePhoto = async () => {
    setError(null);
    setPickingPhoto(true);

    const picked = await pickAndCompressAvatar();

    setPickingPhoto(false);

    if (picked.status === "cancelled") {
      return;
    }

    if (picked.status !== "picked") {
      setError(
        picked.status === "too_large"
          ? copy.avatarTooLarge
          : picked.status === "permission_denied"
            ? copy.avatarPermissionBody
            : copy.avatarFailed
      );
      return;
    }

    setPendingPhoto({ uri: picked.uri, base64: picked.base64, bytes: picked.bytes });
  };

  const onCreate = async () => {
    const nameProblem = nameProblemMessage();

    if (nameProblem) {
      setError(nameProblem);
      return;
    }

    if (!draftHasAGame(draft)) {
      setError(copy.gamesRequired);
      return;
    }

    setCreating(true);
    setError(null);

    const created = await createTeam(name.trim());

    if (!created.ok) {
      setCreating(false);
      setError(created.error.code === "22023" ? copy.nameTooShort : copy.actionFailed);
      return;
    }

    // Best effort, and deliberately not a rollback: the Team exists, and the
    // owner can set the topics from Manage if this second call did not land.
    await saveTeamConfig({
      teamId: created.data.teamId,
      newsletterTopics: draftToNewsletterTopics(draft),
      miniCaseTopics: draft.miniCases
    });

    if (setup.presetId) {
      trackAnalyticsEvent("team_created_from_preset", {
        team_preset: setup.presetId,
        team_intensity: setup.intensityId,
        language
      });
    }

    // Same rule for the photo, and it is the reason it is sent here rather than
    // before: the path is keyed by the Team id. A failure leaves a Team with no
    // picture, which is what most Teams have anyway, and Manage can set one.
    if (pendingPhoto) {
      const upload = await uploadTeamAvatar({
        teamId: created.data.teamId,
        base64: pendingPhoto.base64,
        bytes: pendingPhoto.bytes
      });

      if (upload.status === "uploaded") {
        await setTeamAvatar({ teamId: created.data.teamId, avatarPath: upload.path });
      }
    }

    setCreating(false);

    // replace, not push: Back from the invite screen belongs on the Teams list,
    // not on a create form for a Team that now exists.
    router.replace(`/(teams)/${created.data.teamId}/invite?created=1` as Href);
  };

  const identity = (
    <TeamIdentityFields
      busy={creating || pickingPhoto}
      language={language}
      name={name}
      onChangeName={(value) => {
        setName(value);
        setError(null);
      }}
      onChoosePhoto={() => void onChoosePhoto()}
      onRemovePhoto={() => setPendingPhoto(null)}
      pendingPhotoUri={pendingPhoto?.uri ?? null}
      pickingPhoto={pickingPhoto}
    />
  );

  const errorLine = error ? (
    <AppText
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      color="danger"
      style={styles.error}
      variant="body"
    >
      {error}
    </AppText>
  ) : null;

  const createButton = (
    <PrimaryButton
      disabled={creating}
      label={copy.createConfirm}
      loading={creating}
      onPress={() => void onCreate()}
      style={styles.submit}
    />
  );

  return (
    <ReaderScaffold
      closeLabel={getReaderCopy(language).close}
      eyebrow={copy.eyebrow}
      iconName="users"
      onClose={() => router.back()}
      scrollRef={scrollRef}
    >
      {/* The swipe back would leave the whole flow; inside it, Back steps back. */}
      <Stack.Screen options={{ gestureEnabled: !inFlow }} />

      {setup.step === "template" ? (
        <>
          <SetupStepHeader
            body={copy.setupTemplateBody}
            language={language}
            progress={teamSetupProgress(setup)}
            title={copy.setupTemplateTitle}
          />
          <PresetGrid
            language={language}
            onBuildFromScratch={() => dispatch({ type: "buildFromScratch" })}
            onSelect={(presetId) => {
              trackAnalyticsEvent("team_preset_selected", { team_preset: presetId, language });
              dispatch({ type: "choosePreset", presetId });
            }}
            selectedId={setup.presetId}
          />
        </>
      ) : null}

      {setup.step === "intensity" ? (
        <>
          <SetupStepHeader
            body={copy.setupIntensityBody}
            language={language}
            onBack={() => dispatch({ type: "back" })}
            progress={teamSetupProgress(setup)}
            title={copy.setupIntensityTitle}
          />
          <IntensityOptions
            language={language}
            onSelect={(intensityId) => dispatch({ type: "chooseIntensity", intensityId })}
            selectedId={setup.intensityId}
          />
          <PrimaryButton
            label={copy.setupContinue}
            onPress={() => {
              trackAnalyticsEvent("team_intensity_selected", {
                team_preset: setup.presetId ?? undefined,
                team_intensity: setup.intensityId,
                language
              });
              dispatch({ type: "continueToPreview" });
            }}
            style={styles.submit}
          />
        </>
      ) : null}

      {setup.step === "preview" && setup.presetId ? (
        <>
          <SetupStepHeader
            body={copy.setupPreviewBody}
            language={language}
            onBack={() => dispatch({ type: "back" })}
            progress={teamSetupProgress(setup)}
            title={copy.setupPreviewTitle}
          />
          <RecommendationSummary
            draft={draft}
            heading={copy.setupSelectedPreset(
              copy.presets[setup.presetId].name,
              copy.intensities[setup.intensityId].name
            )}
            language={language}
          />
          {identity}
          <AppText color="mutedSoft" style={styles.note} variant="caption">
            {copy.startsNextEditionCreated}
          </AppText>
          {errorLine}
          {createButton}
          <SecondaryButton
            disabled={creating}
            label={copy.setupCustomize}
            onPress={() => {
              trackAnalyticsEvent("team_preset_customized", {
                team_preset: setup.presetId ?? undefined,
                team_intensity: setup.intensityId,
                language
              });
              dispatch({ type: "customize" });
            }}
            style={styles.secondary}
          />
        </>
      ) : null}

      {setup.step === "manual" ? (
        <>
          <SetupStepHeader
            body={setup.manualOrigin === "customize" ? copy.setupCustomizeIntro : copy.createIntro}
            language={language}
            onBack={() => dispatch({ type: "back" })}
            progress={null}
            title={setup.manualOrigin === "customize" ? copy.setupCustomizeTitle : copy.createTitle}
          />

          {identity}

          <EditorialRule />

          <TeamConfigFields
            draft={setup.manualDraft}
            language={language}
            onChange={(next) => {
              dispatch({ type: "editManual", draft: next });
              setError(null);
            }}
          />

          <EditorialRule label={copy.reviewTitle} />

          <View style={styles.review}>
            <ReviewRow label={copy.nameLabel} value={name.trim() || copy.nameNotSet} />
            <ReviewRow
              label={copy.newsletterTopics}
              value={
                shape.articles === 0
                  ? copy.noTopicsChosen
                  : `${copy.topicsChosen(Object.keys(draft.newsletter).length)} · ${copy.articlesTotal(
                      shape.articles
                    )}`
              }
            />
            <ReviewRow
              label={copy.miniCaseTopics}
              value={
                shape.miniCases === 0 ? copy.noTopicsChosen : copy.topicsChosen(shape.miniCases)
              }
            />
            <AppText color="mutedSoft" variant="caption">
              {copy.startsNextEditionCreated}
            </AppText>
          </View>

          {errorLine}
          {createButton}

          {setup.manualOrigin === "customize" ? (
            <SecondaryButton
              disabled={creating}
              label={copy.setupBackToRecommendation}
              onPress={() => dispatch({ type: "back" })}
              style={styles.secondary}
            />
          ) : null}
        </>
      ) : null}
    </ReaderScaffold>
  );
}

/** Name and optional photo: the same block on the preview and in the editor. */
function TeamIdentityFields({
  busy,
  language,
  name,
  onChangeName,
  onChoosePhoto,
  onRemovePhoto,
  pendingPhotoUri,
  pickingPhoto
}: {
  busy: boolean;
  language: "fr" | "en";
  name: string;
  onChangeName: (value: string) => void;
  onChoosePhoto: () => void;
  onRemovePhoto: () => void;
  pendingPhotoUri: string | null;
  pickingPhoto: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const colors = useThemeColors();
  const copy = getTeamsCopy(language);

  return (
    <Card padding="lg" style={styles.card}>
      <View style={styles.photo}>
        {pendingPhotoUri ? (
          <Image
            accessibilityIgnoresInvertColors
            accessible={false}
            source={{ uri: pendingPhotoUri }}
            style={styles.pendingPhoto}
          />
        ) : (
          <TeamAvatar avatarPath={null} size="hero" />
        )}
        <AppText color="muted" variant="caption">
          {`${copy.teamPhotoLabel} · ${copy.avatarOptional}`}
        </AppText>
        <AppText align="center" color="mutedSoft" variant="caption">
          {copy.teamPhotoHelp}
        </AppText>
        <SecondaryButton
          disabled={busy}
          label={
            pickingPhoto
              ? copy.avatarPreparing
              : pendingPhotoUri
                ? copy.teamPhotoChange
                : copy.teamPhotoChoose
          }
          onPress={onChoosePhoto}
        />
        {pendingPhotoUri ? (
          <SecondaryButton disabled={busy} label={copy.teamPhotoRemove} onPress={onRemovePhoto} />
        ) : null}
      </View>

      <View style={styles.field}>
        <AppText color="muted" variant="caption">
          {copy.nameLabel}
        </AppText>
        <TextInput
          accessibilityLabel={copy.nameLabel}
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={40}
          onChangeText={onChangeName}
          placeholder={copy.namePlaceholder}
          placeholderTextColor={colors.mutedSoft}
          style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
          value={name}
        />
      </View>
    </Card>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.reviewRow}>
      <AppText color="muted" style={styles.reviewLabel} variant="caption">
        {label}
      </AppText>
      <AppText style={styles.reviewValue} variant="body">
        {value}
      </AppText>
    </View>
  );
}

/** Exported for the review line and for Manage; the date is the server's. */
export function effectiveEditionLabel(
  effectiveFromEdition: string | null,
  language: "fr" | "en"
): string | null {
  if (!effectiveFromEdition) {
    return null;
  }

  return formatDropDate(effectiveFromEdition, language);
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      gap: tokens.space.lg,
      marginTop: tokens.space.lg
    },
    field: {
      gap: tokens.space.sm
    },
    photo: {
      alignItems: "center",
      gap: tokens.space.sm
    },
    pendingPhoto: {
      borderColor: c.border,
      borderRadius: tokens.radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      height: 96,
      width: 96
    },
    input: {
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      fontSize: tokens.typography.size.body,
      minHeight: 48,
      paddingHorizontal: tokens.space.md,
      paddingVertical: tokens.space.md
    },
    review: {
      gap: tokens.space.md
    },
    reviewRow: {
      borderTopColor: c.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: tokens.space.xs,
      paddingTop: tokens.space.md
    },
    reviewLabel: {
      letterSpacing: 0.4
    },
    reviewValue: {
      color: c.ink
    },
    note: {
      marginTop: tokens.space.md
    },
    error: {
      marginTop: tokens.space.md
    },
    submit: {
      marginTop: tokens.space.xl
    },
    secondary: {
      marginTop: tokens.space.sm
    }
  });
