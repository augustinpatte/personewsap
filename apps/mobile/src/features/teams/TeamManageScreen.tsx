import { useCallback, useEffect, useState } from "react";
import { useRouter, type Href } from "expo-router";
import { Alert, StyleSheet, TextInput, View } from "react-native";

import { AppText, Card, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../design/theme";
import { useAuth } from "../auth";
import { EditorialRule, ModuleError, ModuleLoading } from "../modules";
import { getModuleCopy } from "../modules/moduleCopy";
import { formatDropDate, getReaderCopy } from "../today/contentCopy";
import { ReaderScaffold } from "../today/readers";
import { validateTeamName } from "./playerProfile";
import { TeamConfigFields } from "./TeamConfigFields";
import {
  EMPTY_DRAFT,
  draftHasAGame,
  draftToNewsletterTopics,
  type TeamConfigDraft
} from "./teamConfigOptions";
import { getTeamsCopy } from "./teamsCopy";
import {
  archiveTeam,
  fetchTeamConfig,
  fetchTeamDetail,
  leaveTeam,
  renameTeam,
  saveTeamConfig,
  type TeamDetail
} from "./teamsData";
import { useRefetchOnReturn } from "./useRefetchOnReturn";

/**
 * Everything an owner decides about a Team.
 *
 * EVERY CONFIGURATION CHANGE SAYS WHEN IT TAKES EFFECT, and the date shown is
 * the server's answer rather than one this screen computed. `update_team_config`
 * writes a new version stamped with the next scoring edition and returns that
 * date; the edition in flight keeps resolving to the previous version. Without
 * that sentence an owner who changes topics mid-edition watches nothing happen
 * and concludes the app is broken.
 *
 * LEAVING AND ARCHIVING ARE TWO DIFFERENT DECISIONS and the server refuses to
 * take both at once. An owner with other members must transfer ownership before
 * leaving — otherwise one person walking out would end a league four other
 * people had not agreed to end. An owner alone is archiving, and is told so
 * before they confirm.
 *
 * The destructive actions live at the bottom, behind a rule, each behind a
 * native confirmation. Nothing here is one tap.
 */
export function TeamManageScreen({ teamId }: { teamId: string }) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const colors = useThemeColors();
  const { profileLanguage } = useAuth();
  const language = profileLanguage ?? "en";
  const copy = getTeamsCopy(language);
  const moduleCopy = getModuleCopy(language);

  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<TeamConfigDraft>(EMPTY_DRAFT);
  const [effectiveFrom, setEffectiveFrom] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");

    const [detail, config] = await Promise.all([
      fetchTeamDetail(teamId),
      // The PENDING version, not the effective one: an owner editing is editing
      // the change that has not landed yet, and showing them the live version
      // would silently discard an edit they made an hour ago.
      fetchTeamConfig({ teamId, scope: "pending" })
    ]);

    if (!detail.ok || !detail.data) {
      setStatus("error");
      return;
    }

    setTeam(detail.data);
    setName(detail.data.name ?? "");

    if (config.ok) {
      setDraft({
        newsletter: Object.fromEntries(
          config.data.newsletterTopics.map((topic) => [topic.topicId, topic.articlesCount])
        ),
        miniCases: config.data.miniCaseTopics
      });
      setEffectiveFrom(config.data.effectiveFromEdition);
    }

    setStatus("ready");
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back from Members, where ownership may have just been transferred away —
  // in which case this screen is no longer the reader's to use.
  useRefetchOnReturn(useCallback(() => void load(), [load]));

  const onRename = async () => {
    const problem = validateTeamName(name);

    if (problem) {
      setError(
        problem === "too_short"
          ? copy.nameTooShort
          : problem === "too_long"
            ? copy.nameTooLong
            : copy.nameNotAllowed
      );
      return;
    }

    setWorking(true);
    setError(null);
    const result = await renameTeam({ teamId, name: name.trim() });
    setWorking(false);

    if (!result.ok) {
      setError(result.error.code === "42501" ? copy.notOwner : copy.actionFailed);
      return;
    }

    setNotice(copy.renameSaved);
  };

  const onSaveConfig = async () => {
    if (!draftHasAGame(draft)) {
      setError(copy.gamesRequired);
      return;
    }

    setWorking(true);
    setError(null);

    const result = await saveTeamConfig({
      teamId,
      newsletterTopics: draftToNewsletterTopics(draft),
      miniCaseTopics: draft.miniCases
    });

    setWorking(false);

    if (!result.ok) {
      setError(result.error.code === "42501" ? copy.notOwner : copy.actionFailed);
      return;
    }

    setEffectiveFrom(result.data.effectiveFromEdition);
    setNotice(copy.configSaved);
  };

  const onArchive = () => {
    Alert.alert(copy.archiveTitle, copy.archiveConfirm, [
      { text: copy.cancel, style: "cancel" },
      {
        text: copy.confirm,
        style: "destructive",
        onPress: async () => {
          const result = await archiveTeam(teamId);

          if (!result.ok) {
            setError(copy.actionFailed);
            return;
          }

          router.replace("/(tabs)/teams" as Href);
        }
      }
    ]);
  };

  const onLeave = () => {
    const alone = (team?.memberCount ?? 1) <= 1;

    Alert.alert(
      copy.leaveTitle,
      alone && team?.isOwner ? copy.leaveAsOwnerAlone : copy.leaveConfirm,
      [
        { text: copy.cancel, style: "cancel" },
        {
          text: copy.confirm,
          style: "destructive",
          onPress: async () => {
            const outcome = await leaveTeam(teamId);

            // The server refuses an owner who still has company, and says why.
            // Surfaced rather than swallowed: the reader has a next step.
            if (outcome.status === "transfer_required") {
              setError(copy.ownerMustTransfer);
              return;
            }

            if (outcome.status !== "left") {
              setError(copy.actionFailed);
              return;
            }

            router.replace("/(tabs)/teams" as Href);
          }
        }
      ]
    );
  };

  const effectiveLabel = effectiveFrom
    ? copy.effectiveFrom(formatDropDate(effectiveFrom, language))
    : copy.configTakesEffect;

  return (
    <ReaderScaffold
      closeLabel={getReaderCopy(language).close}
      eyebrow={copy.manageTitle}
      iconName="users"
      onClose={() => router.back()}
    >
      {status === "loading" ? <ModuleLoading label={moduleCopy.common.loading} /> : null}
      {status === "error" ? <ModuleError language={language} onRetry={() => void load()} /> : null}

      {status === "ready" && team ? (
        <View style={styles.body}>
          <AppText variant="title">{team.name ?? copy.hiddenMember}</AppText>

          {team.isOwner ? null : (
            <AppText color="muted" variant="body">
              {copy.manageOwnerOnly}
            </AppText>
          )}

          {notice ? (
            <AppText accessibilityLiveRegion="polite" color="success" variant="body">
              {notice}
            </AppText>
          ) : null}
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

          {team.isOwner ? (
            <>
              <Card padding="lg" style={styles.card}>
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
                <PrimaryButton
                  disabled={working}
                  label={copy.renameSave}
                  onPress={() => void onRename()}
                />
              </Card>

              <EditorialRule label={copy.editConfig} />

              <TeamConfigFields
                draft={draft}
                language={language}
                onChange={(next) => {
                  setDraft(next);
                  setError(null);
                }}
              />

              {/* Said before the save, not after it: an owner should know the
                  change is not retroactive before they make it. */}
              <AppText color="accentInk" variant="caption">
                {effectiveLabel}
              </AppText>

              <PrimaryButton
                disabled={working}
                label={copy.saveConfig}
                onPress={() => void onSaveConfig()}
              />

              <EditorialRule />

              <SecondaryButton
                label={copy.inviteTitle}
                onPress={() => router.push(`/(teams)/${teamId}/invite` as Href)}
              />
            </>
          ) : null}

          <SecondaryButton
            label={copy.viewMembers}
            onPress={() => router.push(`/(teams)/${teamId}/members` as Href)}
          />

          <EditorialRule />

          <View style={styles.danger}>
            <SecondaryButton label={copy.leaveTeam} onPress={onLeave} />
            {team.isOwner ? (
              <SecondaryButton label={copy.archiveTeam} onPress={onArchive} />
            ) : null}
            <AppText color="mutedSoft" variant="caption">
              {copy.archiveConfirm}
            </AppText>
          </View>
        </View>
      ) : null}
    </ReaderScaffold>
  );
}

const createStyles = (_c: ThemeColors) =>
  StyleSheet.create({
    body: {
      gap: tokens.space.lg,
      marginTop: tokens.space.md
    },
    card: {
      gap: tokens.space.md
    },
    input: {
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      fontSize: tokens.typography.size.body,
      minHeight: 48,
      paddingHorizontal: tokens.space.md,
      paddingVertical: tokens.space.md
    },
    danger: {
      gap: tokens.space.sm
    }
  });
