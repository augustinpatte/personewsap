import { useState } from "react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { StyleSheet, TextInput, View } from "react-native";

import { AppText, Card, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../design/theme";
import { useAuth } from "../auth";
import { getReaderCopy } from "../today/contentCopy";
import { ReaderScaffold } from "../today/readers";
import { INVITE_CODE_LENGTH, isCompleteInviteCode, normalizeInviteCode } from "./inviteCode";
import { getTeamsCopy } from "./teamsCopy";
import { joinTeamWithCode } from "./teamsData";

/**
 * Joining a Team.
 *
 * One field. The overwhelmingly common way into this product's social layer is
 * a code somebody sent you, so this screen is one step from the Teams tab and
 * has nothing else on it.
 *
 * ONE ANSWER FOR SEVERAL FAILURES, ON PURPOSE. A code that does not exist, a
 * code whose Team has been archived, and a code the owner has turned off all
 * produce the same "That code does not match a Team." Distinguishing them would
 * turn this field into an oracle: eight characters is a small enough space that
 * a distinct "that Team is archived" would confirm a hit and let somebody map
 * the code space by the difference in the replies. The server already answers
 * uniformly (`join_team_with_invite` raises the same P0002 for all three); this
 * screen does not undo that by guessing which one it was.
 *
 * "Already a member" is different and is NOT an error: it means the reader is
 * where they wanted to be, so the screen offers to open the Team.
 */
export function JoinTeamScreen() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const colors = useThemeColors();
  const { profileLanguage } = useAuth();
  const language = profileLanguage ?? "en";
  const copy = getTeamsCopy(language);

  // Prefilled when the reader arrived through an invite link. The field stays
  // editable and the code is still normalised: a link is a convenience, not a
  // separate way in, and there is no auto-submit — joining a league is a
  // decision, and a tap on a link in a group chat is not one.
  const { code: linkedCode } = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(() =>
    typeof linkedCode === "string" ? normalizeInviteCode(linkedCode) : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState<{
    teamId: string;
    name: string | null;
    alreadyMember: boolean;
  } | null>(null);

  const onJoin = async () => {
    const normalized = normalizeInviteCode(code);

    if (!isCompleteInviteCode(normalized)) {
      setError(copy.joinTooShort);
      return;
    }

    setJoining(true);
    setError(null);

    const outcome = await joinTeamWithCode(normalized);

    setJoining(false);

    if (outcome.status === "not_found") {
      setError(copy.joinNotFound);
      return;
    }

    if (outcome.status === "failed") {
      setError(copy.joinFailed);
      return;
    }

    setJoined({
      teamId: outcome.teamId,
      name: outcome.name,
      alreadyMember: outcome.status === "already_member"
    });
  };

  return (
    <ReaderScaffold
      closeLabel={getReaderCopy(language).close}
      eyebrow={copy.eyebrow}
      iconName="users"
      onClose={() => router.back()}
    >
      <View style={styles.header}>
        <AppText variant="title">{joined ? copy.joinedTitle : copy.joinTitle}</AppText>
        <AppText color="muted" variant="body">
          {joined ? (joined.name ?? copy.hiddenMember) : copy.joinBody}
        </AppText>
      </View>

      {joined ? (
        <Card padding="lg" style={styles.card}>
          <AppText accessibilityLiveRegion="polite" variant="body">
            {joined.alreadyMember ? copy.joinAlreadyMember : copy.startsNextEdition}
          </AppText>
          <PrimaryButton
            label={copy.openTeam}
            onPress={() => router.replace(`/(teams)/${joined.teamId}` as Href)}
          />
        </Card>
      ) : (
        <Card padding="lg" style={styles.card}>
          <View style={styles.field}>
            <AppText color="muted" variant="caption">
              {copy.joinCodeLabel}
            </AppText>
            <TextInput
              accessibilityHint={copy.joinHint}
              accessibilityLabel={copy.joinCodeLabel}
              // The code is uppercase alphanumeric; autocorrect on an eight
              // character token produces a different token.
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect={false}
              maxLength={INVITE_CODE_LENGTH}
              onChangeText={(value) => {
                setCode(normalizeInviteCode(value));
                setError(null);
              }}
              placeholder={copy.joinPlaceholder}
              placeholderTextColor={colors.mutedSoft}
              style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
              value={code}
            />
            <AppText color="mutedSoft" variant="caption">
              {copy.joinHint}
            </AppText>
          </View>

          {error ? (
            <AppText
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              color="danger"
              variant="body"
            >
              {error}
            </AppText>
          ) : null}

          <PrimaryButton
            disabled={joining || !isCompleteInviteCode(code)}
            label={copy.joinConfirm}
            loading={joining}
            onPress={() => void onJoin()}
          />
          <SecondaryButton label={copy.cancel} onPress={() => router.back()} />
        </Card>
      )}
    </ReaderScaffold>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    header: {
      gap: tokens.space.sm,
      marginTop: tokens.space.md
    },
    card: {
      gap: tokens.space.lg,
      marginTop: tokens.space.xl
    },
    field: {
      gap: tokens.space.sm
    },
    input: {
      borderColor: c.border,
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      fontSize: tokens.typography.size.title,
      // The code is read back character by character when somebody dictates it,
      // so it is set wide rather than tight.
      letterSpacing: 4,
      minHeight: 56,
      paddingHorizontal: tokens.space.md,
      paddingVertical: tokens.space.md,
      textAlign: "center"
    }
  });
