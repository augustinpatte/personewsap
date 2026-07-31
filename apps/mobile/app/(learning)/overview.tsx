import { useAuth } from "../../src/features/auth";
import { LearningPathOverviewScreen } from "../../src/features/learning";

export default function LearningOverviewRoute() {
  const { profileLanguage } = useAuth();

  return <LearningPathOverviewScreen language={profileLanguage} />;
}
