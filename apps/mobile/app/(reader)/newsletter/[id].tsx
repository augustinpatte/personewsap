import { useLocalSearchParams } from "expo-router";

import { ReaderItemProvider } from "../../../src/features/today";
import { NewsletterReader } from "../../../src/features/today/readers";

export default function NewsletterReaderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ReaderItemProvider contentItemId={id}>
      <NewsletterReader articleId={id} />
    </ReaderItemProvider>
  );
}
