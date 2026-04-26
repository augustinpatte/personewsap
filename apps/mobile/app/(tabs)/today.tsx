import { Text } from "react-native";

import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";
import { tokens } from "../../src/design/tokens";

const modules = [
  "Personalized AI newsletter",
  "Business story",
  "Mini-case challenge",
  "Key concept"
];

export default function TodayScreen() {
  return (
    <PlaceholderScreen
      eyebrow="Today"
      title="One daily drop"
      description="The future home of the premium 5-minute PersoNewsAP briefing."
    >
      {modules.map((module) => (
        <Text key={module} style={{ color: tokens.color.ink, fontSize: 15, marginBottom: 10 }}>
          {module}
        </Text>
      ))}
    </PlaceholderScreen>
  );
}
