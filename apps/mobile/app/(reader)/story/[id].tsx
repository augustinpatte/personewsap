import { useLocalSearchParams } from "expo-router";

import { BusinessStoryReader } from "../../../src/features/today/readers";

export default function BusinessStoryReaderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <BusinessStoryReader storyId={id} />;
}
