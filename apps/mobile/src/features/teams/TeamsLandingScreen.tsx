import { useCallback, useEffect, useState } from "react";
import { useRouter, type Href } from "expo-router";
import { StyleSheet, View } from "react-native";

import {
  AppText,
  EmptyState,
  ModuleContentSkeleton,
  PressableSurface,
  PrimaryButton,
  SecondaryButton
} from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { trackAnalyticsEvent } from "../../lib/analytics";
import { useAuth } from "../auth";
import {
  ModuleError,
  ModuleHeader,
  ModuleScroll,
  ModuleSurface
} from "../modules";
import { getModuleCopy } from "../modules/moduleCopy";
import { resolveReaderEditionDate } from "../today/editionCadence";
import { formatTeamPoints } from "./leaderboard";
import { TeamAvatar } from "./PlayerAvatar";
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
  const styles = useThemedStyles(createStyles);
  const { profileLanguage, user } = useAuth();
  const language = profileLanguage ?? "en";
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

  // THE MASTHEAD IS NOT PART OF THE LOADING STATE. It used to be: the whole
  // screen was replaced by a skeleton, so the header appeared out of nowhere
  // when the data landed and the page visibly recomposed. The four module tabs
  // keep their chrome and swap only the body, and so does this one now.
  return (
    <ModuleSurface>
      <View style={styles.chrome}>
        <ModuteHeaderRow language={language} />
      </View>

      {status === "loading" ? (
        <ModuleScroll>
          <ModuleContentSkeleton label={moduleCopy.common.loading} />
        </ModuleScroll>
      ) : status === "error" ? (
        <ModuleScroll>
          <ModuleError language={language} onRetry={() => void load()} />
        </ModuleScroll>
      ) : // THE GATE, and the only place in the app it exists. Newsletter, Mini
      // Cases, Stories, Path, the archive and Settings all work untouched for a
      // reader who has never picked a username.
      profile && !isProfileCompleteForTeams(profile) ? (
        <TeamProfileGate onCompleted={() => void load()} profile={profile} />
      ) : (
        <TeamsList language={language} teams={teams} />
      )}
    </ModuleSurface>
  );
}

function TeamsList({ language, teams }: { language: "fr" | "en"; teams: TeamSummary[] }) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const copy = getTeamsCopy(language);

  return (
    <ModuleScroll contentStyle={styles.content} reveal>
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
      <View style={styles.cardIdentity}>
        {/* Null for most Teams, and that is the ordinary case rather than a
            failure: the placeholder disc is what a Team without a photo looks
            like, in both schemes. */}
        <TeamAvatar avatarPath={team.avatarPath} />
        <View style={styles.cardHead}>
          <AppText numberOfLines={2} style={styles.cardName} variant="subtitle">
            {team.name ?? copy.hiddenMember}
          </AppText>
          <AppText color="muted" variant="caption">
            {copy.members(team.memberCount)}
          </AppText>
        </View>
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
    chrome: {
      gap: tokens.space.lg,
      paddingHorizontal: tokens.space.lg,
      paddingTop: tokens.space.md
    },
    actions: {
      gap: tokens.space.sm
    },
    list: {
      gap: tokens.space.md
    },
    cardIdentity: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md
    },
    cardHead: {
      flex: 1,
      gap: tokens.space.xs
    },
    cardName: {
      color: c.ink
    }
  });
