import { useLocalSearchParams } from "expo-router";

import { TeamManageScreen } from "../../../src/features/teams";

export default function TeamManageRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <TeamManageScreen teamId={id} />;
}
