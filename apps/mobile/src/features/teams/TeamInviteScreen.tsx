import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Share, StyleSheet, View } from "react-native";

import { AppText, Card, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { useAuth } from "../auth";
import { ModuleError, ModuleLoading } from "../modules";
import { getModuleCopy } from "../modules/moduleCopy";
import { getReaderCopy } from "../today/contentCopy";
import { ReaderScaffold } from "../today/readers";
import { inviteShareText } from "./inviteLink";
import { getTeamsCopy } from "./teamsCopy";
import {
  fetchInviteCode,
  fetchTeamDetail,
  rotateInviteCode,
  setInviteOpen,
  type TeamDetail,
  type TeamInvite
} from "./teamsData";

/**
 * The invite code, and the four things an owner can do with it.
 *
 * OWNER ONLY, AND THE SERVER IS WHAT SAYS SO. `authenticated` holds no SELECT on
 * `public.teams`, so `get_team_invite_code` is the single route to a code and it
 * checks who is asking. A member who is not the owner gets "Team not found" —
 * the same answer a stranger gets, because a distinct "you are not the owner"
 * would confirm the team exists to anybody who guessed an id. This screen
 * renders that refusal as "only the owner can manage this Team" rather than as
 * an error, because for a member it is not one.
 *
 * ROTATION IS MEANINGFUL AGAIN, which it was not while every member could read
 * the code straight off the row: after a rotation only the owner knows the new
 * one. Turning the invite off is the other half — it stops new joins without
 * invalidating a code the owner may still want to reuse.
 *
 * Also the screen somebody lands on immediately after creating a Team, which is
 * why it states the eligibility rule: the Team exists now, the scoring starts
 * with the next edition.
 */
export function TeamInviteScreen({ teamId }: { teamId: string }) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { created } = useLocalSearchParams<{ created?: string }>();
  const { profileLanguage } = useAuth();
  const language = profileLanguage ?? "en";
  const copy = getTeamsCopy(language);
  const moduleCopy = getModuleCopy(language);

  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [invite, setInvite] = useState<TeamInvite | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const justCreated = created === "1";

  const load = useCallback(async () => {
    setStatus("loading");

    const [detail, code] = await Promise.all([
      fetchTeamDetail(teamId),
      fetchInviteCode(teamId)
    ]);

    if (!detail.ok || !detail.data) {
      setStatus("error");
      return;
    }

    setTeam(detail.data);
    // A non-owner simply has no code to show. That is not an error state: the
    // screen tells them the owner manages invites and stops there.
    setInvite(code.ok ? code.data : null);
    setStatus("ready");
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const teamName = team?.name ?? copy.hiddenMember;

  const onShare = async () => {
    if (!invite?.code) {
      return;
    }

    try {
      await Share.share({
        message: inviteShareText({
          code: invite.code,
          message: copy.inviteShareMessage(teamName, invite.code)
        })
      });
    } catch {
      // A dismissed share sheet is not a failure and has nothing to report.
    }
  };

  const onCopy = async () => {
    if (!invite?.code) {
      return;
    }

    await Clipboard.setStringAsync(invite.code);
    setNotice(copy.inviteCopied);
  };

  const onRotate = async () => {
    setWorking(true);
    const result = await rotateInviteCode(teamId);
    setWorking(false);

    if (!result.ok) {
      setNotice(copy.actionFailed);
      return;
    }

    setInvite((current) => (current ? { ...current, code: result.data } : current));
    setNotice(copy.inviteRotated);
  };

  const onToggleOpen = async (open: boolean) => {
    setWorking(true);
    const result = await setInviteOpen(teamId, open);
    setWorking(false);

    if (!result.ok) {
      setNotice(copy.actionFailed);
      return;
    }

    setInvite((current) => (current ? { ...current, open } : current));
    setNotice(open ? copy.inviteOpenState : copy.inviteDisabledState);
  };

  return (
    <ReaderScaffold
      closeLabel={getReaderCopy(language).close}
      eyebrow={copy.inviteTitle}
      iconName="users"
      onClose={() => {
        // Straight after Create, Back belongs on the Team itself rather than on
        // the form that made it.
        if (justCreated) {
          router.replace(`/(teams)/${teamId}` as Href);
          return;
        }

        router.back();
      }}
    >
      {status === "loading" ? <ModuleLoading label={moduleCopy.common.loading} /> : null}
      {status === "error" ? <ModuleError language={language} onRetry={() => void load()} /> : null}

      {status === "ready" && team ? (
        <View style={styles.body}>
          <View style={styles.header}>
            <AppText variant="title">{justCreated ? copy.createdTitle : teamName}</AppText>
            {justCreated ? (
              <>
                <AppText color="muted" variant="body">
                  {teamName}
                </AppText>
                {/* Only on the Create path. An owner who opens Invite to fetch
                    the code for a Team that has been scoring for three weeks
                    would be told their scores have not started yet. */}
                <AppText color="accentInk" variant="body">
                  {copy.startsNextEditionCreated}
                </AppText>
              </>
            ) : (
              <AppText color="muted" variant="body">
                {copy.inviteBody}
              </AppText>
            )}
          </View>

          {invite ? (
            <Card padding="lg" style={styles.card}>
              <AppText color="muted" variant="eyebrow">
                {copy.inviteCode}
              </AppText>
              {/* Selectable so a reader can copy it by hand, and read out
                  character by character by VoiceOver rather than as a word. */}
              <AppText
                accessibilityLabel={invite.code.split("").join(" ")}
                selectable
                style={styles.code}
                variant="title"
              >
                {invite.code}
              </AppText>
              <AppText color="mutedSoft" variant="caption">
                {invite.open ? copy.inviteOpenState : copy.inviteDisabledState}
              </AppText>

              <PrimaryButton label={copy.shareInvite} onPress={() => void onShare()} />
              <SecondaryButton label={copy.inviteCopy} onPress={() => void onCopy()} />
              <SecondaryButton
                disabled={working}
                label={copy.regenerate}
                onPress={() => void onRotate()}
              />
              <AppText color="mutedSoft" variant="caption">
                {copy.regenerateHint}
              </AppText>
              <SecondaryButton
                disabled={working}
                label={invite.open ? copy.inviteDisable : copy.inviteEnable}
                onPress={() => void onToggleOpen(!invite.open)}
              />
            </Card>
          ) : (
            <Card padding="lg" style={styles.card}>
              <AppText color="muted" variant="body">
                {copy.manageOwnerOnly}
              </AppText>
            </Card>
          )}

          {notice ? (
            <AppText accessibilityLiveRegion="polite" color="success" variant="body">
              {notice}
            </AppText>
          ) : null}

          <SecondaryButton
            label={copy.openTeam}
            onPress={() => router.replace(`/(teams)/${teamId}` as Href)}
          />
        </View>
      ) : null}
    </ReaderScaffold>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    body: {
      gap: tokens.space.lg,
      marginTop: tokens.space.md
    },
    header: {
      gap: tokens.space.sm
    },
    card: {
      gap: tokens.space.md
    },
    code: {
      color: c.ink,
      letterSpacing: 6
    }
  });
