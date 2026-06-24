import { useLocalSearchParams } from "expo-router";

import { ReaderItemProvider } from "../../../src/features/today";
import { MiniCaseReader } from "../../../src/features/today/readers";

export default function MiniCaseReaderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ReaderItemProvider contentItemId={id}>
      <MiniCaseReader caseId={id} />
    </ReaderItemProvider>
  );
}
