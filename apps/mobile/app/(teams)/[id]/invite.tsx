import { useLocalSearchParams } from "expo-router";

import { TeamInviteScreen } from "../../../src/features/teams";

export default function TeamInviteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <TeamInviteScreen teamId={id} />;
}
