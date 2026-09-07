import { useLocalSearchParams } from "expo-router";

import { TeamMembersScreen } from "../../../src/features/teams";

export default function TeamMembersRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <TeamMembersScreen teamId={id} />;
}
