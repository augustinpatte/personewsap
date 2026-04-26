import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";
import { TOPICS } from "../../src/constants/product";

export default function TopicsScreen() {
  return (
    <PlaceholderScreen
      eyebrow="Onboarding"
      title="Choose topics"
      description={`Placeholder for the 8-topic taxonomy: ${TOPICS.map((topic) => topic.label).join(", ")}.`}
    />
  );
}
