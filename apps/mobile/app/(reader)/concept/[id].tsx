import { useLocalSearchParams } from "expo-router";

import { ReaderItemProvider } from "../../../src/features/today";
import { ConceptReader } from "../../../src/features/today/readers";

export default function ConceptReaderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ReaderItemProvider contentItemId={id}>
      <ConceptReader conceptId={id} />
    </ReaderItemProvider>
  );
}
