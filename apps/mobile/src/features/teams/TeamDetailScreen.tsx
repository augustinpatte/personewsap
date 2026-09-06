import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { AppState, StyleSheet, View } from "react-native";

import { AppText, IconBadge } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { useAuth } from "../auth";
import { ModuleError, ModuleLoading, ModuleScroll, ViewSwitch } from "../modules";
import { getModuleCopy } from "../modules/moduleCopy";
import { getReaderCopy } from "../today/contentCopy";
import { ReaderScaffold } from "../today/readers";
import { resolveReaderEditionDate } from "../today/editionCadence";
import { findCountry } from "./countries";
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
import { initialsFor } from "./playerProfile";
import { getTeamsCopy, rangeLabel, statusLabel } from "./teamsCopy";
import { fetchBlockedUserIds, fetchLeaderboard } from "./teamsData";
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
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(
    async (nextRange: LeaderboardRange) => {
      if (!user?.id) {
        return;
      }

      const [leaderboard, blocks] = await Promise.all([
        fetchLeaderboard({
          teamId,
          range: nextRange,
          editionDate: nextRange === "all_time" ? null : resolveReaderEditionDate()
        }),
        fetchBlockedUserIds(user.id)
      ]);

      if (!leaderboard.ok) {
        setStatus("error");
        return;
      }

      const blockedIds = blocks.ok ? blocks.data : new Set<string>();

      setBlocked(blockedIds);
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

  if (status === "loading") {
    return <ModuleLoading label={moduleCopy.common.loading} />;
  }

  if (status === "error") {
    return (
      <ReaderScaffold closeLabel={getReaderCopy(language).close} onClose={() => router.back()}>
        <ModuleError language={language} onRetry={() => void load(range)} />
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
      <View style={styles.summary}>
        <AppText color="muted" variant="eyebrow">
          {copy.currentEdition}
        </AppText>
        <View style={styles.summaryRow}>
          <SummaryStat
            label={copy.myRank}
            value={self ? copy.rank(self.rank) : copy.noRankYet}
          />
          <SummaryStat
            label={copy.myPoints}
            value={formatTeamPoints(self?.scoreMilli ?? 0)}
          />
          <SummaryStat
            label={copy.completion}
            value={copy.editionProgress(progress.completed, progress.total)}
          />
        </View>
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

      <View style={styles.avatar}>
        <AppText color="accentInk" variant="caption">
          {initialsFor(identity.name)}
        </AppText>
      </View>

      <View style={styles.rowCopy}>
        <AppText numberOfLines={1} variant="bodyStrong">
          {row.isSelf ? `${identity.name} · ${copy.you}` : identity.name}
        </AppText>
        <AppText color="muted" variant="caption">
          {[country ? (language === "fr" ? country.nameFr : country.nameEn) : null,
            statusLabel(row.status, copy)]
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
    summary: {
      gap: tokens.space.md
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
    avatar: {
      alignItems: "center",
      backgroundColor: c.surfaceMuted,
      borderRadius: tokens.radius.pill,
      height: 32,
      justifyContent: "center",
      width: 32
    },
    rowCopy: {
      flex: 1,
      gap: tokens.space.xs
    }
  });
