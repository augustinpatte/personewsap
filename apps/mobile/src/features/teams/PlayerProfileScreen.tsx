import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppText } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { useAuth } from "../auth";
import { ModuleError, ModuleLoading } from "../modules";
import { getModuleCopy } from "../modules/moduleCopy";
import { getReaderCopy } from "../today/contentCopy";
import { ReaderScaffold } from "../today/readers";
import type { PlayerProfile } from "./playerProfile";
import { PlayerProfileForm } from "./PlayerProfileForm";
import { getTeamsCopy } from "./teamsCopy";
import { fetchPlayerProfile } from "./teamsData";

/**
 * Editing the player identity from Account.
 *
 * The same form the Teams gate uses, so a reader changing their photo a month
 * later meets the same rules they met the first time. Reached from Account
 * rather than from Teams: Teams is where you manage a league, and "who am I on
 * a leaderboard" belongs beside the email address and the language.
 */
export function PlayerProfileScreen() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { profileLanguage, user } = useAuth();
  const language = profileLanguage ?? "en";
  const copy = getTeamsCopy(language);
  const moduleCopy = getModuleCopy(language);

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) {
      return;
    }

    setStatus("loading");
    const result = await fetchPlayerProfile(user.id);

    if (!result.ok) {
      setStatus("error");
      return;
    }

    setProfile(result.data);
    setStatus("ready");
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ReaderScaffold
      closeLabel={getReaderCopy(language).close}
      eyebrow={copy.editProfileTitle}
      iconName="users"
      onClose={() => router.back()}
    >
      {status === "loading" ? <ModuleLoading label={moduleCopy.common.loading} /> : null}
      {status === "error" ? <ModuleError language={language} onRetry={() => void load()} /> : null}

      {status === "ready" && profile ? (
        <View style={styles.body}>
          <AppText variant="title">{copy.editProfileTitle}</AppText>
          <AppText color="muted" variant="body">
            {copy.editProfileBody}
          </AppText>

          {saved ? (
            <AppText accessibilityLiveRegion="polite" color="success" variant="body">
              {copy.profileSaved}
            </AppText>
          ) : null}

          <PlayerProfileForm
            onCompleted={(next) => {
              setProfile(next);
              setSaved(true);
            }}
            profile={profile}
            submitLabel={copy.save}
          />
        </View>
      ) : null}
    </ReaderScaffold>
  );
}

const createStyles = (_c: ThemeColors) =>
  StyleSheet.create({
    body: {
      gap: tokens.space.md,
      marginTop: tokens.space.md
    }
  });
