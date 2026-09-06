import { useLocalSearchParams } from "expo-router";

import { TeamDetailScreen } from "../../src/features/teams";

export default function TeamDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <TeamDetailScreen teamId={id} />;
}
