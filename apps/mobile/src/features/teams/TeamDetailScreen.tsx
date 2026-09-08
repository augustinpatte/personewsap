import { useCallback, useEffect, useState } from "react";
import { useRouter, type Href } from "expo-router";
import { AppState, StyleSheet, View } from "react-native";

import { AppText, ModuleContentSkeleton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { useAuth } from "../auth";
import { ModuleError } from "../modules";
import { getModuleCopy } from "../modules/moduleCopy";
import { getReaderCopy } from "../today/contentCopy";
import { ReaderScaffold } from "../today/readers";
import { resolveReaderEditionDate } from "../today/editionCadence";
import { countryName, findCountry } from "./countries";
import {
  LEADERBOARD_RANGES,
  displayIdentity,
  findSelf,
  formatTeamPoints,
  rankLeaderboard,
  teamEditionProgress,
  type LeaderboardRange,
  type LeaderboardRow
} from "./leaderboard";
import { PlayerAvatar, TeamAvatar } from "./PlayerAvatar";
import { getTeamsCopy, rangeLabel, statusLabel } from "./teamsCopy";
import {
  fetchBlockedUserIds,
  fetchLeaderboard,
  fetchMyStreak,
  fetchTeamDetail,
  type TeamDetail
} from "./teamsData";
import { useRefetchOnReturn } from "./useRefetchOnReturn";
import { useTeamLeaderboardChannel } from "./useTeamLeaderboardChannel";

/**
 * One Team.
 *
 * Your standing first, then everyone's. The summary above the list answers the
 * question somebody opens this screen to ask — where am I, how many points,
 * how long is my run — and the leaderboard answers the second one.
 *
 * This is the only screen in the app that opens a Realtime channel, and it
 * closes it on the way out.
 */
export function TeamDetailScreen({ teamId }: { teamId: string }) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { profileLanguage, user } = useAuth();
  const language = profileLanguage ?? "en";
  const copy = getTeamsCopy(language);
  const moduleCopy = getModuleCopy(language);

  const [range, setRange] = useState<LeaderboardRange>("edition");
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [streak, setStreak] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(
    async (nextRange: LeaderboardRange) => {
      if (!user?.id) {
        return;
      }

      // Four reads, in parallel, once. The header, the standing, the reader's
      // run and their block list are all needed to draw a single frame of this
      // screen, and doing them in sequence would make a Realtime nudge cost
      // four round trips of latency instead of one.
      const [leaderboard, blocks, detail, myStreak] = await Promise.all([
        fetchLeaderboard({
          teamId,
          range: nextRange,
          editionDate: nextRange === "all_time" ? null : resolveReaderEditionDate()
        }),
        fetchBlockedUserIds(user.id),
        fetchTeamDetail(teamId),
        fetchMyStreak({ teamId, userId: user.id })
      ]);

      if (!leaderboard.ok || !detail.ok) {
        setStatus("error");
        return;
      }

      const blockedIds = blocks.ok ? blocks.data : new Set<string>();

      setTeam(detail.data);
      setStreak(myStreak.ok ? myStreak.data : null);
      setRows(
        rankLeaderboard({
          members: leaderboard.data,
          selfUserId: user.id,
          blockedUserIds: blockedIds
        })
      );
      setStatus("ready");
    },
    [teamId, user?.id]
  );

  useEffect(() => {
    setStatus("loading");
    void load(range);
  }, [load, range]);

  // THE DATABASE IS THE SOURCE OF TRUTH, NOT THE CHANNEL.
  //
  // A Broadcast can be missed — the socket drops, the app is backgrounded, the
  // event arrives while the screen is unmounting. So returning to this screen
  // refetches unconditionally rather than trusting that every event landed. The
  // channel makes an update fast; this is what makes it correct.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void load(range);
      }
    });

    return () => subscription.remove();
  }, [load, range]);

  // Back from Manage or Members: a rename, a removal or a transfer that just
  // happened one screen up is the whole reason the reader is looking again.
  useRefetchOnReturn(
    useCallback(() => {
      void load(range);
    }, [load, range])
  );

  // Opened here, closed on the way out. The hook's teardown is unconditional.
  useTeamLeaderboardChannel({
    teamId,
    isMember: true,
    onChanged: useCallback(() => {
      void load(range);
    }, [load, range])
  });

  const self = findSelf(rows);
  const progress = teamEditionProgress(rows);
  const startsNextEdition = self?.status === "starts_next_edition";

  // Loading and error both keep the scaffold. Returning a bare skeleton here
  // took the safe area, the background and the way back off the screen for as
  // long as the fetch lasted, so a slow network showed an unpainted page with
  // no exit; the reader now waits inside the same frame the Team arrives in.
  if (status === "loading" || status === "error") {
    return (
      <ReaderScaffold
        closeLabel={getReaderCopy(language).close}
        eyebrow={copy.eyebrow}
        iconName="users"
        onClose={() => router.back()}
      >
        {status === "loading" ? (
          <ModuleContentSkeleton label={moduleCopy.common.loading} />
        ) : (
          <ModuleError language={language} onRetry={() => void load(range)} />
        )}
      </ReaderScaffold>
    );
  }

  return (
    <ReaderScaffold
      closeLabel={getReaderCopy(language).close}
      eyebrow={copy.eyebrow}
      iconName="users"
      onClose={() => router.back()}
    >
      <View style={styles.identity}>
        <View style={styles.identityHead}>
          <TeamAvatar avatarPath={team?.avatarPath} size="header" />
          <View style={styles.identityCopy}>
            <AppText numberOfLines={2} variant="title">
              {team?.name ?? copy.hiddenMember}
            </AppText>
            <AppText color="muted" variant="caption">
              {[copy.members(team?.memberCount ?? rows.length), copy.currentEdition].join(" · ")}
            </AppText>
          </View>
        </View>
        {team?.status === "archived" ? (
          <AppText color="mutedSoft" variant="caption">
            {copy.teamArchived}
          </AppText>
        ) : null}
        {startsNextEdition ? (
          // The mid-edition join rule, said plainly rather than left to be
          // discovered as a zero that never moves.
          <AppText color="accentInk" variant="caption">
            {copy.startsNextEdition}
          </AppText>
        ) : null}
      </View>

      <View style={styles.summary}>
        <View style={styles.summaryRow}>
          <SummaryStat
            label={copy.myRank}
            value={self ? copy.rank(self.rank) : copy.noRankYet}
          />
          <SummaryStat
            label={copy.myPoints}
            value={formatTeamPoints(self?.scoreMilli ?? 0)}
          />
        </View>
        <View style={styles.summaryRow}>
          <SummaryStat
            label={copy.myStreak}
            value={streak === null ? copy.noRankYet : copy.streakValue(streak)}
          />
          <SummaryStat
            label={copy.completion}
            value={copy.editionProgress(progress.completed, progress.total)}
          />
        </View>
      </View>

      <View style={styles.actions}>
        <SecondaryButton
          label={copy.viewMembers}
          onPress={() => router.push(`/(teams)/${teamId}/members` as Href)}
        />
        <SecondaryButton
          label={team?.isOwner ? copy.manage : copy.leaveTeam}
          onPress={() => router.push(`/(teams)/${teamId}/manage` as Href)}
        />
      </View>

      {/* The app's own switch component, extended to three. No segmented
          control from a second design system. */}
      <View style={styles.ranges}>
        {LEADERBOARD_RANGES.map((value) => (
          <RangeTab
            active={range === value}
            key={value}
            label={rangeLabel(value, copy)}
            onPress={() => setRange(value)}
          />
        ))}
      </View>

      <View style={styles.list}>
        {rows.map((row) => (
          <LeaderboardRowView copy={copy} key={row.userId} language={language} row={row} />
        ))}
      </View>
    </ReaderScaffold>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.stat}>
      <AppText color="muted" variant="caption">
        {label}
      </AppText>
      <AppText variant="subtitle">{value}</AppText>
    </View>
  );
}

function RangeTab({
  active,
  label,
  onPress
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.rangeTab}>
      <AppText
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        color={active ? "ink" : "muted"}
        onPress={onPress}
        style={styles.rangeLabel}
        variant="label"
      >
        {label}
      </AppText>
      {active ? <View style={styles.rangeUnderline} /> : null}
    </View>
  );
}

/**
 * One member.
 *
 * A blocked member keeps their rank and their points and loses their name and
 * photo — for the person who blocked them, and for nobody else. Hiding the
 * score instead would make the standing wrong for everyone.
 */
function LeaderboardRowView({
  copy,
  language,
  row
}: {
  copy: ReturnType<typeof getTeamsCopy>;
  language: "fr" | "en";
  row: LeaderboardRow;
}) {
  const styles = useThemedStyles(createStyles);
  const identity = displayIdentity(row, {
    blocked: copy.blockedMember,
    hidden: copy.hiddenMember
  });
  const country = identity.showCountry ? findCountry(row.countryCode) : null;

  return (
    <View
      accessibilityLabel={[
        copy.rank(row.rank),
        row.isSelf ? copy.you : identity.name,
        formatTeamPoints(row.scoreMilli),
        statusLabel(row.status, copy)
      ].join(", ")}
      accessible
      style={[styles.row, row.isSelf ? styles.rowSelf : null]}
    >
      <AppText color="muted" style={styles.rank} variant="caption">
        {copy.rank(row.rank)}
      </AppText>

      <PlayerAvatar
        avatarPath={row.avatarPath}
        masked={!identity.showAvatar}
        name={identity.name}
      />

      <View style={styles.rowCopy}>
        <AppText numberOfLines={1} variant="bodyStrong">
          {row.isSelf ? `${identity.name} · ${copy.you}` : identity.name}
        </AppText>
        <AppText color="muted" variant="caption">
          {[
            country ? `${country.code} · ${countryName(country, language)}` : null,
            statusLabel(row.status, copy),
            // Only where it means something: a run of one is not a run.
            row.editionsCompleted > 1 ? copy.streakValue(row.editionsCompleted) : null
          ]
            .filter(Boolean)
            .join(" · ")}
        </AppText>
      </View>

      <AppText variant="bodyStrong">{formatTeamPoints(row.scoreMilli)}</AppText>
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    identity: {
      gap: tokens.space.xs
    },
    identityHead: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md
    },
    identityCopy: {
      flex: 1,
      gap: tokens.space.xs
    },
    summary: {
      gap: tokens.space.md,
      marginTop: tokens.space.lg
    },
    actions: {
      gap: tokens.space.sm,
      marginTop: tokens.space.lg
    },
    summaryRow: {
      flexDirection: "row",
      gap: tokens.space.lg
    },
    stat: {
      flex: 1,
      gap: tokens.space.xs
    },
    ranges: {
      borderBottomColor: c.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: tokens.space.lg,
      marginTop: tokens.space.xl
    },
    rangeTab: {
      gap: tokens.space.sm
    },
    rangeLabel: {
      // A 44pt target on a text control: the label is short and the row is not.
      minHeight: 44,
      paddingTop: tokens.space.md
    },
    rangeUnderline: {
      backgroundColor: c.accent,
      height: 2
    },
    list: {
      gap: tokens.space.xs,
      marginTop: tokens.space.lg
    },
    row: {
      alignItems: "center",
      borderTopColor: c.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: tokens.space.md,
      minHeight: 56,
      paddingVertical: tokens.space.md
    },
    rowSelf: {
      backgroundColor: c.accentSoft,
      borderRadius: tokens.radius.sm
    },
    rank: {
      minWidth: 32
    },
    rowCopy: {
      flex: 1,
      gap: tokens.space.xs
    }
  });
