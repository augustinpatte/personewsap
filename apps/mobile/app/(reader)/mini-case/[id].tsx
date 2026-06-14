import { useLocalSearchParams } from "expo-router";

import { MiniCaseReader } from "../../../src/features/today/readers";

export default function MiniCaseReaderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <MiniCaseReader caseId={id} />;
}
