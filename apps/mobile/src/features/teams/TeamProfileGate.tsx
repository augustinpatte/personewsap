import { StyleSheet, View } from "react-native";

import { AppText } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { useAuth } from "../auth";
import { ModuleScroll } from "../modules";
import { missingProfileFields, type PlayerProfile } from "./playerProfile";
import { PlayerProfileForm } from "./PlayerProfileForm";
import { getTeamsCopy } from "./teamsCopy";

/**
 * The one thing Teams asks for before it will show you a leaderboard.
 *
 * A photo, a username and a country — all three, once. A leaderboard is a list
 * of people, and the photo is how you recognise the friend you are playing
 * against; a Team where half the rows are two grey letters is a spreadsheet.
 *
 * NOTHING ABOUT THIS GATE REACHES THE REST OF THE APP. A reader who closes it
 * still has their Newsletter, their Mini Cases, their Stories, their Path, their
 * archive and their Settings, exactly as before, with `profiles.username`,
 * `country_code` and `avatar_path` all still NULL. It is rendered by the Teams
 * landing screen and by nothing else, and the photo-library prompt only ever
 * happens on a tap inside it.
 *
 * The form itself is shared with Account's "Edit player profile", so the
 * username rules, the country list and the avatar budget have one home rather
 * than two that drift.
 */
export function TeamProfileGate({
  onCompleted,
  profile
}: {
  onCompleted: () => void;
  profile: PlayerProfile;
}) {
  const styles = useThemedStyles(createStyles);
  const { profileLanguage } = useAuth();
  const language = profileLanguage ?? "en";
  const copy = getTeamsCopy(language);
  const missing = missingProfileFields(profile);

  return (
    <ModuleScroll contentStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="title">{copy.profileTitle}</AppText>
        <AppText color="muted" variant="body">
          {copy.profileBody}
        </AppText>
        {missing.length > 0 ? (
          <AppText color="mutedSoft" variant="caption">
            {copy.profileNeeds}
          </AppText>
        ) : null}
      </View>

      <PlayerProfileForm onCompleted={() => onCompleted()} profile={profile} />
    </ModuleScroll>
  );
}

const createStyles = (_c: ThemeColors) =>
  StyleSheet.create({
    content: {
      gap: tokens.space.xl
    },
    header: {
      gap: tokens.space.sm
    }
  });
