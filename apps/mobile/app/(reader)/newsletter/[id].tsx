import { useLocalSearchParams } from "expo-router";

import { NewsletterReader } from "../../../src/features/today/readers";

export default function NewsletterReaderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <NewsletterReader articleId={id} />;
}
