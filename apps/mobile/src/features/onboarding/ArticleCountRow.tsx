import { Pressable, StyleSheet, View } from "react-native";

import { AppText, Card } from "../../components";
import { tokens } from "../../design/tokens";

type ArticleCountRowProps = {
  label: string;
  description: string;
  count: number;
  onChange: (count: number) => void;
};

const ARTICLE_COUNTS = [1, 2, 3] as const;

export function ArticleCountRow({
  label,
  description,
  count,
  onChange
}: ArticleCountRowProps) {
  return (
    <Card padding="md">
      <View style={styles.header}>
        <View style={styles.copy}>
          <AppText variant="bodyStrong">{label}</AppText>
          <AppText color="muted" variant="caption">
            {description}
          </AppText>
        </View>
        <AppText color="accent" variant="label">
          {count}/topic
        </AppText>
      </View>

      <View style={styles.controls}>
        {ARTICLE_COUNTS.map((option) => {
          const selected = option === count;

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={option}
              onPress={() => onChange(option)}
              style={[styles.countButton, selected ? styles.selectedCountButton : null]}
            >
              <AppText color={selected ? "white" : "accentInk"} variant="label">
                {option}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  },
  copy: {
    flex: 1,
    gap: tokens.space.xs
  },
  controls: {
    flexDirection: "row",
    gap: tokens.space.sm
  },
  countButton: {
    alignItems: "center",
    backgroundColor: tokens.color.surfaceMuted,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: "center"
  },
  selectedCountButton: {
    backgroundColor: tokens.color.accent,
    borderColor: tokens.color.accent
  }
});
