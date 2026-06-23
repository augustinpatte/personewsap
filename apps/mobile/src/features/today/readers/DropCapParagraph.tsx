import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

import { AppText } from "../../../components";
import { tokens } from "../../../design/tokens";
import { useThemeColors } from "../../../design/theme";

// Minimum opener length before the magazine initial is worth applying. Short
// summaries and one-line intros keep the plain reading style.
const MIN_LENGTH_FOR_DROP_CAP = 140;

type DropCapParagraphProps = {
  text: string;
  style?: StyleProp<TextStyle>;
};

// Editorial opener: the first letter of a long-form paragraph is set as a large
// serif versal initial, the rest of the paragraph flows as normal reading text.
// Implemented with a nested <Text> (no float, fully reliable in React Native)
// so it renders identically in FR/EN and light/dark. Falls back to a plain
// paragraph whenever the text is too short to carry the effect.
export function DropCapParagraph({ text, style }: DropCapParagraphProps) {
  const colors = useThemeColors();
  const trimmed = text.trimStart();
  const characters = Array.from(trimmed);
  const first = characters[0] ?? "";
  const isLetter = /\p{L}/u.test(first);

  if (!isLetter || trimmed.length < MIN_LENGTH_FOR_DROP_CAP) {
    return (
      <AppText style={style} variant="read">
        {text}
      </AppText>
    );
  }

  const rest = characters.slice(1).join("");

  return (
    <AppText style={style} variant="read">
      <Text style={[styles.cap, { color: colors.ink }]}>{first}</Text>
      {rest}
    </AppText>
  );
}

const styles = StyleSheet.create({
  cap: {
    fontFamily: tokens.typography.family.serif,
    fontSize: tokens.typography.size.dropCap,
    fontWeight: tokens.typography.weight.bold,
    letterSpacing: -1,
    lineHeight: tokens.typography.lineHeight.dropCap
  }
});
