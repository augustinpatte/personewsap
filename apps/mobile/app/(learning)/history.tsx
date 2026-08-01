import { useAuth } from "../../src/features/auth";
import { LearningPathHistoryScreen } from "../../src/features/learning";

export default function LearningHistoryRoute() {
  const { profileLanguage } = useAuth();

  return <LearningPathHistoryScreen language={profileLanguage} />;
}
