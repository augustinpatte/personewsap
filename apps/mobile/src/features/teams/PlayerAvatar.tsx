import { Image, StyleSheet, View } from "react-native";

import { AppText } from "../../components";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { initialsFor } from "./playerProfile";
import { useAvatarUrl } from "./useAvatarUrl";

/**
 * One player's photo, at the size a row or a header needs.
 *
 * ALWAYS RENDERS SOMETHING. The signed URL arrives a moment after the row does,
 * a moderated avatar comes back as NULL, a blocked member is deliberately
 * masked, and the bucket can simply be unreachable — so the initials are not a
 * fallback bolted on afterwards, they are what is drawn until and unless an
 * image is available. A row that could render empty would leave a hole in a
 * leaderboard on every one of those paths.
 *
 * The image is decorative: the name is beside it in text, and the row carries
 * its own accessibility label. Announcing "photo of augustin" after "augustin"
 * would make VoiceOver read the same person twice.
 */
export function PlayerAvatar({
  avatarPath,
  masked = false,
  name,
  size = "row"
}: {
  avatarPath: string | null | undefined;
  /** Blocked or moderated: the initials stand in and no request is made. */
  masked?: boolean;
  name: string | null;
  size?: "row" | "header" | "hero";
}) {
  const styles = useThemedStyles(createStyles);
  const url = useAvatarUrl(masked ? null : avatarPath);
  const dimension = size === "hero" ? 96 : size === "header" ? 48 : 36;

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
      <AppText color="accentInk" variant={size === "hero" ? "subtitle" : "caption"}>
        {initialsFor(name)}
      </AppText>
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    frame: {
      alignItems: "center",
      backgroundColor: c.accentSoft,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: "center",
      overflow: "hidden"
    }
  });
