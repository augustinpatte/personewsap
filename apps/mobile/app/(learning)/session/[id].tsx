import { useAuth } from "../../../src/features/auth";
import { LearningSessionScreen } from "../../../src/features/learning";

export default function LearningSessionRoute() {
  const { profileLanguage } = useAuth();

  return <LearningSessionScreen language={profileLanguage} />;
}
