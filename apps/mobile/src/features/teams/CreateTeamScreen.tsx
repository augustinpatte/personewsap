import { useState } from "react";
import { useRouter, type Href } from "expo-router";
import { Image, StyleSheet, TextInput, View } from "react-native";

import { AppText, Card, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../design/theme";
import { useAuth } from "../auth";
import { EditorialRule } from "../modules";
import { formatDropDate, getReaderCopy } from "../today/contentCopy";
import { ReaderScaffold } from "../today/readers";
import { pickAndCompressAvatar } from "./avatarUpload";
import { TeamAvatar } from "./PlayerAvatar";
import { validateTeamName } from "./playerProfile";
import { uploadTeamAvatar } from "./teamAvatarUpload";
import { TeamConfigFields } from "./TeamConfigFields";
import {
  EMPTY_DRAFT,
  draftEditionShape,
  draftHasAGame,
  draftToNewsletterTopics,
  type TeamConfigDraft
} from "./teamConfigOptions";
import { getTeamsCopy } from "./teamsCopy";
import { createTeam, saveTeamConfig, setTeamAvatar } from "./teamsData";

/**
 * Creating a Team.
 *
 * ONE SCREEN, NOT A WIZARD. Name, newsletter topics, mini cases, review, create.
 * A five-step flow would put three taps and two animations between somebody and
 * a league they have already decided to start, and none of those steps has a
 * decision in it that depends on the previous one — which is the only thing that
 * justifies a wizard. Everything is visible and revisable until Create.
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
  const colors = useThemeColors();
  const { profileLanguage } = useAuth();
  const language = profileLanguage ?? "en";
  const copy = getTeamsCopy(language);

  const [name, setName] = useState("");
  const [draft, setDraft] = useState<TeamConfigDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Held locally until the Team has an id to be stored under.
  const [pendingPhoto, setPendingPhoto] = useState<{
    uri: string;
    base64: string;
    bytes: number;
  } | null>(null);
  const [pickingPhoto, setPickingPhoto] = useState(false);

  const shape = draftEditionShape(draft);

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

  return (
    <ReaderScaffold
      closeLabel={getReaderCopy(language).close}
      eyebrow={copy.eyebrow}
      iconName="users"
      onClose={() => router.back()}
    >
      <View style={styles.header}>
        <AppText variant="title">{copy.createTitle}</AppText>
        <AppText color="muted" variant="body">
          {copy.createIntro}
        </AppText>
      </View>

      <Card padding="lg" style={styles.card}>
        <View style={styles.photo}>
          {pendingPhoto ? (
            <Image
              accessibilityIgnoresInvertColors
              accessible={false}
              source={{ uri: pendingPhoto.uri }}
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
            disabled={creating || pickingPhoto}
            label={
              pickingPhoto
                ? copy.avatarPreparing
                : pendingPhoto
                  ? copy.teamPhotoChange
                  : copy.teamPhotoChoose
            }
            onPress={() => void onChoosePhoto()}
          />
          {pendingPhoto ? (
            <SecondaryButton
              disabled={creating || pickingPhoto}
              label={copy.teamPhotoRemove}
              onPress={() => setPendingPhoto(null)}
            />
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
            onChangeText={(value) => {
              setName(value);
              setError(null);
            }}
            placeholder={copy.namePlaceholder}
            placeholderTextColor={colors.mutedSoft}
            style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
            value={name}
          />
        </View>
      </Card>

      <EditorialRule />

      <TeamConfigFields
        draft={draft}
        language={language}
        onChange={(next) => {
          setDraft(next);
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

      {error ? (
        <AppText
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          color="danger"
          style={styles.error}
          variant="body"
        >
          {error}
        </AppText>
      ) : null}

      <PrimaryButton
        disabled={creating}
        label={copy.createConfirm}
        loading={creating}
        onPress={() => void onCreate()}
        style={styles.submit}
      />
    </ReaderScaffold>
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
    header: {
      gap: tokens.space.sm,
      marginTop: tokens.space.md
    },
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
    error: {
      marginTop: tokens.space.md
    },
    submit: {
      marginTop: tokens.space.xl
    }
  });
