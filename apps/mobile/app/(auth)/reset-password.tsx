import { useRouter } from "expo-router";

import { PlaceholderScreen } from "../../src/components/PlaceholderScreen";
import { SecondaryButton } from "../../src/components";

export default function ResetPasswordScreen() {
  const router = useRouter();

  return (
    <PlaceholderScreen
      eyebrow="Auth"
      title="Reset password"
      description="Placeholder for password reset flow using Supabase Auth."
    >
      <SecondaryButton label="Back to login" onPress={() => router.replace("/(auth)/login")} />
    </PlaceholderScreen>
  );
}
