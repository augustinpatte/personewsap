import { StyleSheet, View } from "react-native";

import { tokens } from "../design/tokens";
import { AppText } from "./AppText";
import { Card } from "./Card";
import { ProgressPill } from "./ProgressPill";
import { SecondaryButton } from "./SecondaryButton";

type DataModeBannerProps = {
  mode: "live" | "cache" | "preview" | "checking";
  title: string;
  description: string;
  detail?: string;
  actionLabel?: string;
  onActionPress?: () => void;
};

export function DataModeBanner({
  mode,
  title,
  description,
  detail,
  actionLabel,
  onActionPress
}: DataModeBannerProps) {
  const isLive = mode === "live";
  const isCache = mode === "cache";
  const isChecking = mode === "checking";

  return (
    <Card
      padding="md"
      style={[
        styles.banner,
        isLive ? styles.liveBanner : null,
        isCache ? styles.cacheBanner : null,
        mode === "preview" ? styles.previewBanner : null
      ]}
      tone={isLive ? "accent" : "muted"}
    >
      <View style={styles.header}>
        <ProgressPill
          label={
            isLive
              ? "LIVE DATA"
              : isCache
                ? "CACHED DATA"
                : isChecking
                  ? "CHECKING LIVE DATA"
                  : "PREVIEW MODE"
          }
          tone={isLive ? "success" : isCache ? "warning" : isChecking ? "neutral" : "warning"}
          value={isLive ? 1 : undefined}
        />
        {detail ? (
          <AppText color={isLive ? "accentInk" : "muted"} variant="caption">
            {detail}
          </AppText>
        ) : null}
      </View>
      <View style={styles.copy}>
        <AppText color={isLive ? "accentInk" : "ink"} variant="bodyStrong">
          {title}
        </AppText>
        <AppText color={isLive ? "accentInk" : "muted"} variant="caption">
          {description}
        </AppText>
      </View>
      {actionLabel ? <SecondaryButton label={actionLabel} onPress={onActionPress} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  banner: {
    gap: tokens.space.md
  },
  liveBanner: {
    borderColor: tokens.color.success
  },
  cacheBanner: {
    borderColor: tokens.color.warning
  },
  previewBanner: {
    borderColor: tokens.color.warning,
    borderWidth: 1
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.sm,
    justifyContent: "space-between"
  },
  copy: {
    gap: tokens.space.xs
  }
});
