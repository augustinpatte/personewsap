import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";
import { GOALS } from "../../src/constants/product";

export default function GoalsScreen() {
  return (
    <PlaceholderScreen
      eyebrow="Onboarding"
      title="Choose goal"
      description={`Placeholder for goals: ${GOALS.map((goal) => goal.label).join(", ")}.`}
    />
  );
}
