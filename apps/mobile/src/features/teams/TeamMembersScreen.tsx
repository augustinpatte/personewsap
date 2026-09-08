import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Alert, StyleSheet, View } from "react-native";

import { AppText, Card, ModuleContentSkeleton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { useAuth } from "../auth";
import { ModuleError } from "../modules";
import { getModuleCopy } from "../modules/moduleCopy";
import { formatDropDate, getReaderCopy } from "../today/contentCopy";
import { ReaderScaffold } from "../today/readers";
import { countryName, findCountry } from "./countries";
import { PlayerAvatar } from "./PlayerAvatar";
import { getTeamsCopy } from "./teamsCopy";
import {
  fetchBlockedUserIds,
  fetchTeamDetail,
  fetchTeamMembers,
  removeTeamMember,
  reportContent,
  setBlocked,
  transferTeamOwnership,
  type TeamDetail,
  type TeamMember
} from "./teamsData";
import { useRefetchOnReturn } from "./useRefetchOnReturn";

/**
 * The roster, and the things you can do to a person on it.
 *
 * WHAT IS NOT HERE, and is the reason this screen is short: no chat, no
 * comments, no profile pages, no follow, no activity feed. A Team is a
 * leaderboard between people who already know each other, and every one of
 * those features would turn a private league into a social network with a
 * moderation burden this product has not signed up for. The only interactions
 * are the two safety ones — Report and Block — and the two ownership ones.
 *
 * REPORT AND BLOCK ARE AVAILABLE TO EVERY MEMBER, not only the owner, and they
 * do different jobs. Block is a viewing preference: it masks a name and a photo
 * for the person who blocked, and leaves the score exactly where it was, because
 * a leaderboard that quietly dropped somebody's points would be lying to
 * everyone else about the standing. Report goes to a moderator, who can hide a
 * name or an avatar server-side without destroying anything.
 *
 * REMOVE AND TRANSFER ARE THE OWNER'S, and the server enforces that — the RPCs
 * check `is_team_owner` themselves, so hiding the buttons is a courtesy to the
 * reader rather than the security boundary. The owner cannot remove themselves:
 * leaving and archiving are separate, deliberate decisions with their own
 * confirmations.
 */
export function TeamMembersScreen({ teamId }: { teamId: string }) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { profileLanguage, user } = useAuth();
  const language = profileLanguage ?? "en";
  const copy = getTeamsCopy(language);
  const moduleCopy = getModuleCopy(language);

  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [blocked, setBlockedIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) {
      return;
    }

    setStatus("loading");

    const [detail, roster, blocks] = await Promise.all([
      fetchTeamDetail(teamId),
      fetchTeamMembers(teamId),
      fetchBlockedUserIds(user.id)
    ]);

    if (!detail.ok || !detail.data || !roster.ok) {
      setStatus("error");
      return;
    }

    setTeam(detail.data);
    setMembers(roster.data);
    setBlockedIds(blocks.ok ? blocks.data : new Set());
    setStatus("ready");
  }, [teamId, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useRefetchOnReturn(useCallback(() => void load(), [load]));

  const onToggleBlock = async (member: TeamMember, nextBlocked: boolean) => {
    if (!user?.id) {
      return;
    }

    const result = await setBlocked({
      blockerId: user.id,
      blockedId: member.userId,
      blocked: nextBlocked
    });

    if (!result.ok) {
      setNotice(copy.actionFailed);
      return;
    }

    setBlockedIds((current) => {
      const next = new Set(current);

      if (nextBlocked) {
        next.add(member.userId);
      } else {
        next.delete(member.userId);
      }

      return next;
    });
  };

  const onReport = (member: TeamMember) => {
    if (!user?.id) {
      return;
    }

    // The native action sheet, not a bespoke modal: reporting is a system-level
    // gesture and should feel like one.
    Alert.alert(copy.reportProfile, undefined, [
      {
        text: copy.reportReasonUsername,
        onPress: () => void submitReport(member, "inappropriate_username")
      },
      {
        text: copy.reportReasonAvatar,
        onPress: () => void submitReport(member, "inappropriate_avatar")
      },
      {
        text: copy.reportReasonHarassment,
        onPress: () => void submitReport(member, "harassment")
      },
      { text: copy.reportReasonOther, onPress: () => void submitReport(member, "other") },
      { text: copy.cancel, style: "cancel" }
    ]);
  };

  const submitReport = async (
    member: TeamMember,
    reason: "inappropriate_username" | "inappropriate_avatar" | "harassment" | "other"
  ) => {
    if (!user?.id) {
      return;
    }

    const result = await reportContent({
      reporterId: user.id,
      reportedUserId: member.userId,
      teamId,
      reason
    });

    setNotice(result.ok ? copy.reportSent : copy.actionFailed);
  };

  const onRemove = (member: TeamMember) => {
    Alert.alert(
      copy.removeMember,
      copy.removeMemberConfirm(member.username ?? copy.hiddenMember),
      [
        { text: copy.cancel, style: "cancel" },
        {
          text: copy.confirm,
          style: "destructive",
          onPress: async () => {
            const result = await removeTeamMember({ teamId, userId: member.userId });

            if (!result.ok) {
              setNotice(result.error.code === "42501" ? copy.notOwner : copy.actionFailed);
              return;
            }

            await load();
          }
        }
      ]
    );
  };

  const onTransfer = (member: TeamMember) => {
    Alert.alert(
      copy.transferOwnership,
      copy.transferConfirmBody(member.username ?? copy.hiddenMember),
      [
        { text: copy.cancel, style: "cancel" },
        {
          text: copy.confirm,
          onPress: async () => {
            const result = await transferTeamOwnership({
              teamId,
              newOwnerId: member.userId
            });

            if (!result.ok) {
              setNotice(result.error.code === "42501" ? copy.notOwner : copy.actionFailed);
              return;
            }

            setNotice(copy.transferDone);
            await load();
          }
        }
      ]
    );
  };

  return (
    <ReaderScaffold
      closeLabel={getReaderCopy(language).close}
      eyebrow={copy.membersTitle}
      iconName="users"
      onClose={() => router.back()}
    >
      {status === "loading" ? <ModuleContentSkeleton label={moduleCopy.common.loading} /> : null}
      {status === "error" ? <ModuleError language={language} onRetry={() => void load()} /> : null}

      {status === "ready" && team ? (
        <View style={styles.body}>
          <AppText variant="title">{team.name ?? copy.hiddenMember}</AppText>
          <AppText color="muted" variant="body">
            {copy.members(team.memberCount)}
          </AppText>

          {notice ? (
            <AppText accessibilityLiveRegion="polite" color="success" variant="body">
              {notice}
            </AppText>
          ) : null}

          <View style={styles.list}>
            {members.map((member) => (
              <MemberCard
                copy={copy}
                isBlocked={blocked.has(member.userId)}
                isSelf={member.userId === user?.id}
                key={member.userId}
                language={language}
                member={member}
                onBlock={() => void onToggleBlock(member, !blocked.has(member.userId))}
                onRemove={() => onRemove(member)}
                onReport={() => onReport(member)}
                onTransfer={() => onTransfer(member)}
                viewerIsOwner={team.isOwner}
              />
            ))}
          </View>
        </View>
      ) : null}
    </ReaderScaffold>
  );
}

function MemberCard({
  copy,
  isBlocked,
  isSelf,
  language,
  member,
  onBlock,
  onRemove,
  onReport,
  onTransfer,
  viewerIsOwner
}: {
  copy: ReturnType<typeof getTeamsCopy>;
  isBlocked: boolean;
  isSelf: boolean;
  language: "fr" | "en";
  member: TeamMember;
  onBlock: () => void;
  onRemove: () => void;
  onReport: () => void;
  onTransfer: () => void;
  viewerIsOwner: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const country = findCountry(member.countryCode);
  const name = isBlocked
    ? copy.blockedMember
    : (member.username ?? copy.hiddenMember);
  const role = member.role === "owner" ? copy.roleOwner : copy.roleMember;

  return (
    <Card padding="md" style={styles.member}>
      <View style={styles.memberHead}>
        <PlayerAvatar
          avatarPath={member.avatarPath}
          masked={isBlocked}
          name={isBlocked ? null : member.username}
          size="header"
        />
        <View style={styles.memberIdentity}>
          <AppText numberOfLines={1} variant="bodyStrong">
            {isSelf ? `${name} · ${copy.you}` : name}
          </AppText>
          <AppText color="muted" variant="caption">
            {[
              role,
              country && !isBlocked ? `${country.code} · ${countryName(country, language)}` : null,
              member.joinedAt
                ? copy.memberSince(formatDropDate(member.joinedAt.slice(0, 10), language))
                : null
            ]
              .filter(Boolean)
              .join(" · ")}
          </AppText>
        </View>
      </View>

      {isSelf ? null : (
        // Every action names the member it acts on. The visible label cannot —
        // four short verbs under each card is what makes the roster readable —
        // but VoiceOver reads the buttons as a flat list, and "Block, button"
        // repeated once per member says nothing about whom it would block.
        <View style={styles.memberActions}>
          <SecondaryButton
            accessibilityLabel={copy.actionFor(isBlocked ? copy.unblock : copy.block, name)}
            label={isBlocked ? copy.unblock : copy.block}
            onPress={onBlock}
          />
          <SecondaryButton
            accessibilityLabel={copy.actionFor(copy.report, name)}
            label={copy.report}
            onPress={onReport}
          />
          {/* The owner cannot be removed and cannot be handed the team they
              already own; both are refused server-side too. */}
          {viewerIsOwner && member.role !== "owner" ? (
            <>
              <SecondaryButton
                accessibilityLabel={copy.actionFor(copy.transferOwnership, name)}
                label={copy.transferOwnership}
                onPress={onTransfer}
              />
              <SecondaryButton
                accessibilityLabel={copy.actionFor(copy.removeMember, name)}
                label={copy.removeMember}
                onPress={onRemove}
              />
            </>
          ) : null}
        </View>
      )}

      {isBlocked ? (
        <AppText color="mutedSoft" variant="caption">
          {copy.blockExplains}
        </AppText>
      ) : null}
    </Card>
  );
}

const createStyles = (_c: ThemeColors) =>
  StyleSheet.create({
    body: {
      gap: tokens.space.md,
      marginTop: tokens.space.md
    },
    list: {
      gap: tokens.space.md,
      marginTop: tokens.space.md
    },
    member: {
      gap: tokens.space.md
    },
    memberHead: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md,
      minHeight: 48
    },
    memberIdentity: {
      flex: 1,
      gap: tokens.space.xs
    },
    memberActions: {
      gap: tokens.space.sm
    }
  });
