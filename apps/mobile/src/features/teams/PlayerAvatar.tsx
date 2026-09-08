import { Feather } from "@expo/vector-icons";
import { Image, StyleSheet, View } from "react-native";

import { useThemedStyles, useThemeColors, type ThemeColors } from "../../design/theme";
import { useAvatarUrl, useTeamAvatarUrl } from "./useAvatarUrl";

/**
 * Every avatar in the app, and the one placeholder behind all of them.
 *
 * ALWAYS RENDERS SOMETHING. The signed URL arrives a moment after the row does,
 * a moderated avatar comes back as NULL, a blocked member is deliberately
 * masked, the reader may simply never have chosen a photo, and the bucket can
 * be unreachable. A row that could render empty would leave a hole in a
 * leaderboard on every one of those paths, so the placeholder is not a fallback
 * bolted on afterwards — it is what is drawn until and unless an image is
 * available.
 *
 * WHAT THE PLACEHOLDER IS. A neutral grey disc with a quiet person (or, for a
 * Team, group) glyph, in the tone the active palette gives to muted things:
 * warm stone in daylight, warm graphite at night. It is the same silhouette
 * every photo app uses for "no picture", which is exactly why it reads as an
 * absence rather than as a broken image.
 *
 * NO INITIALS. An earlier version drew two letters, on the reasoning that a
 * leaderboard of grey discs is anonymous. It is — and a leaderboard of grey
 * discs where one row says "AP" and another says "?" is worse: the letters
 * announce that something is missing, they are unreadable at 36pt for a name in
 * a non-Latin script, and they made a photo feel compulsory. The name is beside
 * the avatar in text on every surface that uses it.
 *
 * The image is decorative: the name is beside it, and the row carries its own
 * accessibility label. Announcing "photo of augustin" after "augustin" would
 * make VoiceOver read the same person twice.
 */

export type AvatarSize = "row" | "header" | "hero";

const DIMENSIONS: Record<AvatarSize, number> = {
  row: 36,
  header: 48,
  hero: 96
};

function dimensionFor(size: AvatarSize): number {
  return DIMENSIONS[size];
}

/**
 * The disc itself: a photo when there is one, the grey placeholder when there
 * is not. Shared by people and Teams so the two can never drift into two
 * different ideas of "no picture".
 */
function AvatarFrame({
  glyph,
  size,
  url
}: {
  glyph: "user" | "users";
  size: AvatarSize;
  url: string | null;
}) {
  const styles = useThemedStyles(createStyles);
  const colors = useThemeColors();
  const dimension = dimensionFor(size);

  const frame = [
    styles.frame,
    { borderRadius: dimension / 2, height: dimension, width: dimension }
  ];

  if (url) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        accessible={false}
        source={{ uri: url }}
        style={frame}
      />
    );
  }

  return (
    <View accessible={false} style={frame}>
      <Feather
        color={colors.mutedSoft}
        name={glyph}
        // A little over half the disc: present enough to read as a silhouette,
        // small enough to stay quiet next to the name it sits beside.
        size={Math.round(dimension * 0.52)}
      />
    </View>
  );
}

export function PlayerAvatar({
  avatarPath,
  masked = false,
  size = "row"
}: {
  avatarPath: string | null | undefined;
  /** Blocked or moderated: the placeholder stands in and no request is made. */
  masked?: boolean;
  /**
   * Accepted and unused. The name is rendered beside every avatar in the app
   * and the placeholder deliberately carries no initials; the prop stays so
   * call sites read as "this avatar belongs to this person" and so a future
   * change of mind has somewhere to land.
   */
  name?: string | null;
  size?: AvatarSize;
}) {
  const url = useAvatarUrl(masked ? null : avatarPath);

  return <AvatarFrame glyph="user" size={size} url={url} />;
}

/**
 * A Team's photo.
 *
 * Optional exactly as a player's is, and absent far more often: most Teams are
 * four friends who never get round to it. The placeholder is the same disc with
 * the group glyph, so a Team with no picture sits beside a member with no
 * picture and the two read as the same kind of nothing.
 */
export function TeamAvatar({
  avatarPath,
  size = "row"
}: {
  avatarPath: string | null | undefined;
  size?: AvatarSize;
}) {
  const url = useTeamAvatarUrl(avatarPath);

  return <AvatarFrame glyph="users" size={size} url={url} />;
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    frame: {
      alignItems: "center",
      // surfaceMuted, not a neutral grey borrowed from somewhere else: the disc
      // is a shade of the page it sits on, in whichever scheme is active.
      backgroundColor: c.surfaceMuted,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: "center",
      overflow: "hidden"
    }
  });
