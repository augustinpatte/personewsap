import { useAuth } from "../../../src/features/auth";
import { LearningFeedbackScreen } from "../../../src/features/learning";

export default function LearningFeedbackRoute() {
  const { profileLanguage } = useAuth();

  return <LearningFeedbackScreen language={profileLanguage} />;
}
