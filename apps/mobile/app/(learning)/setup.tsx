import { useAuth } from "../../src/features/auth";
import { LearningSetupScreen } from "../../src/features/learning";

export default function LearningSetupRoute() {
  const { profileLanguage } = useAuth();

  return <LearningSetupScreen language={profileLanguage} />;
}
