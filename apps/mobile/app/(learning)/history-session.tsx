import { useAuth } from "../../src/features/auth";
import { LearningHistoricalSessionScreen } from "../../src/features/learning";

export default function LearningHistorySessionRoute() {
  const { profileLanguage } = useAuth();

  return <LearningHistoricalSessionScreen language={profileLanguage} />;
}
