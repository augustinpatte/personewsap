import { useCallback, useEffect, useState } from "react";
import { useRouter, type Href } from "expo-router";
import { StyleSheet, View } from "react-native";

import {
  AppText,
  EmptyState,
  PressableSurface,
  PrimaryButton,
  SecondaryButton
} from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { trackAnalyticsEvent } from "../../lib/analytics";
import { useAuth } from "../auth";
import { ModuleError, ModuleHeader, ModuleLoading, ModuleScroll } from "../modules";
import { getModuleCopy } from "../modules/moduleCopy";
import { resolveReaderEditionDate } from "../today/editionCadence";
import { formatTeamPoints } from "./leaderboard";
import { isProfileCompleteForTeams, type PlayerProfile } from "./playerProfile";
import { fetchMyTeams, fetchPlayerProfile, type TeamSummary } from "./teamsData";
import { useRefetchOnReturn } from "./useRefetchOnReturn";
import { getTeamsCopy } from "./teamsCopy";
import { TeamProfileGate } from "./TeamProfileGate";

/**
 * The Teams tab.
 *
 * Deliberately the plainest screen in the app. Three things in priority order —
 * your Teams, join one, create one — and Join is visible without scrolling,
 * because the overwhelmingly common first action is "my friend sent me a code".
 *
 * NOT here, on purpose: no feed, no public discovery, no suggested teams, no
 * "teams near you". A Team is a private league between friends; a directory
 * would make it a social network, which is a different product with a different
 * moderation burden.
 *
 * AND NO REALTIME. Not one channel is opened by this screen, however many Teams
 * the reader belongs to. Free gives 200 concurrent connections for the whole
 * product, and a channel per Team here would spend them on a list nobody is
 * watching change. Live updates begin on Team Detail and end when it closes.
 */
export function TeamsLandingScreen() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { profileLanguage, user } = useAuth();
  const language = profileLanguage ?? "en";
  const copy = getTeamsCopy(language);
  const moduleCopy = getModuleCopy(language);

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    if (!user?.id) {
      return;
    }

    setStatus("loading");

    const profileResult = await fetchPlayerProfile(user.id);

    if (!profileResult.ok) {
      setStatus("error");
      return;
    }

    setProfile(profileResult.data);

    // The gate comes first: a reader with no username has no rows to fetch, and
    // asking for them would be a wasted round trip on the exact screen where a
    // first impression is being made.
    if (!isProfileCompleteForTeams(profileResult.data)) {
      setStatus("ready");
      return;
    }

    const teamsResult = await fetchMyTeams({
      userId: user.id,
      editionDate: resolveReaderEditionDate()
    });

    if (!teamsResult.ok) {
      setStatus("error");
      return;
    }

    setTeams(teamsResult.data);
    setStatus("ready");
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back from Create or Join, where a Team was just made or joined. Without
  // this the reader returns to the list they saw before they had one.
  useRefetchOnReturn(useCallback(() => void load(), [load]));

  if (status === "loading") {
    return <ModuleLoading label={moduleCopy.common.loading} />;
  }

  if (status === "error") {
    return (
      <ModuleScroll>
        <ModuleError language={language} onRetry={() => void load()} />
      </ModuleScroll>
    );
  }

  // THE GATE, and the only place in the app it exists. Newsletter, Mini Cases,
  // Stories, Path, the archive and Settings all work untouched for a reader who
  // has never picked a username.
  if (profile && !isProfileCompleteForTeams(profile)) {
    return <TeamProfileGate onCompleted={() => void load()} profile={profile} />;
  }

  return (
    <ModuleScroll contentStyle={styles.content} reveal>
      <ModuteHeaderRow language={language} />

      {/* Your Teams first: the reason a returning reader opened this tab is to
          see where they stand, not to acquire another league. */}
      {teams.length === 0 ? (
        <EmptyState
          description={copy.emptyBody}
          iconName="users"
          title={copy.emptyTitle}
        />
      ) : (
        <View style={styles.list}>
          <AppText color="muted" variant="eyebrow">
            {copy.yourTeams}
          </AppText>
          {teams.map((team) => (
            <TeamCard
              key={team.teamId}
              language={language}
              onPress={() => {
                trackAnalyticsEvent("team_content_opened", { is_team: true });
                router.push(`/(teams)/${team.teamId}` as Href);
              }}
              team={team}
            />
          ))}
        </View>
      )}

      {/* Then Join, then Create — and Join is the primary of the two, because
          the common first action is a code somebody sent you. Both sit under a
          list that is a handful of private leagues, never a feed, so neither is
          ever pushed far down the screen. */}
      <View style={styles.actions}>
        <PrimaryButton
          label={copy.join}
          onPress={() => router.push("/(teams)/join" as Href)}
        />
        <SecondaryButton
          label={copy.create}
          onPress={() => router.push("/(teams)/create" as Href)}
        />
      </View>
    </ModuleScroll>
  );
}

function ModuteHeaderRow({ language }: { language: "fr" | "en" }) {
  const copy = getTeamsCopy(language);
  const moduleCopy = getModuleCopy(language);

  return (
    <ModuleHeader
      accountLabel={moduleCopy.common.accountLabel}
      eyebrow={copy.eyebrow}
      iconName="users"
      title={copy.tabTitle}
    />
  );
}

/**
 * One Team, in as few lines as will do.
 *
 * Name, members, your score, your progress. Not a dashboard: the detail screen
 * is one tap away and is where the leaderboard lives.
 */
function TeamCard({
  language,
  onPress,
  team
}: {
  language: "fr" | "en";
  onPress: () => void;
  team: TeamSummary;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getTeamsCopy(language);

  return (
    <PressableSurface accessibilityHint={copy.leaderboard} onPress={onPress} variant="row">
      <View style={styles.cardHead}>
        <AppText numberOfLines={2} style={styles.cardName} variant="subtitle">
          {team.name ?? copy.hiddenMember}
        </AppText>
        <AppText color="muted" variant="caption">
          {copy.members(team.memberCount)}
        </AppText>
      </View>

      {team.startsNextEdition ? (
        // The mid-edition join rule, said plainly rather than left to be
        // discovered by a zero that never moves.
        <AppText color="accentInk" variant="caption">
          {copy.startsNextEditionShort}
        </AppText>
      ) : (
        <AppText color="muted" variant="caption">
          {`${formatTeamPoints(team.scoreMilli)} · ${copy.editionProgress(
            team.answeredCount,
            team.assignedCount
          )}`}
        </AppText>
      )}
    </PressableSurface>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    content: {
      gap: tokens.space.xl
    },
    actions: {
      gap: tokens.space.sm
    },
    list: {
      gap: tokens.space.md
    },
    cardHead: {
      gap: tokens.space.xs
    },
    cardName: {
      color: c.ink
    }
  });
