import { StyleSheet, View } from "react-native";
import { useRouter, type Href } from "expo-router";

import { AppScreen, AppText, Card, PrimaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles } from "../../design/theme";
import type { Language } from "../../types/domain";
import { getCurrentLevelLabel, getTargetLevelLabel } from "./learningLevels";
import { getLearningCopy } from "./learningCopy";
import { getHistoricalLearningPaths, useLearningPath } from "./LearningPathContext";
import {
  getLearningPathDateInfo,
  getLearningPathStatusCopyKey
} from "./learningPathState";
import {
  localizeLearningField,
  type LearningDomain,
  type LearningObjective,
  type LearningPath
} from "./learningTypes";

export function LearningPathHistoryScreen({
  language
}: {
  language: Language | null | undefined;
}) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const copy = getLearningCopy(language);
  const { displayPath, domains, learningPaths, objectives } = useLearningPath();
  const history = getHistoricalLearningPaths(learningPaths, displayPath);

  return (
    <AppScreen contentStyle={styles.screen}>
      <View style={styles.header}>
        <AppText variant="eyebrow">{copy.overview.eyebrow}</AppText>
        <AppText variant="title">{copy.overview.pathHistory}</AppText>
      </View>

      {history.length === 0 ? (
        <Card padding="lg" tone="muted">
          <AppText color="muted" variant="body">
            {copy.account.historyEmpty}
          </AppText>
        </Card>
      ) : (
        history.map((path) => (
          <PathHistoryCard
            domains={domains}
            key={path.id}
            language={language}
            objectives={objectives}
            onOpen={() =>
              router.push(
                { pathname: "/(learning)/overview", params: { pathId: path.id } } as unknown as Href
              )
            }
            path={path}
          />
        ))
      )}
    </AppScreen>
  );
}

function PathHistoryCard({
  domains,
  language,
  objectives,
  onOpen,
  path
}: {
  domains: LearningDomain[];
  language: Language | null | undefined;
  objectives: LearningObjective[];
  onOpen: () => void;
  path: LearningPath;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getLearningCopy(language);
  const domain = domains.find((candidate) => candidate.id === path.domain_id) ?? null;
  const objective = objectives.find((candidate) => candidate.id === path.objective_id) ?? null;
  const pathDateInfo = getLearningPathDateInfo(path);

  return (
    <Card padding="lg">
      <View style={styles.pathCard}>
        <AppText variant="subtitle">
          {domain ? localizeLearningField(domain, language) : path.domain_id}
        </AppText>
        <AppText color="muted" variant="body">
          {objective ? localizeLearningField(objective, language) : path.objective_id}
        </AppText>
        <InfoLine label={copy.overview.status} value={copy.overview[getLearningPathStatusCopyKey(path)]} />
        <InfoLine
          label={copy.overview.currentLevel}
          value={getCurrentLevelLabel(path.current_level, language)}
        />
        <InfoLine
          label={copy.overview.targetLevel}
          value={getTargetLevelLabel(path.target_level, language)}
        />
        <InfoLine
          label={copy.overview[pathDateInfo.labelKey]}
          value={formatPathDate(pathDateInfo.value, language)}
        />
        <PrimaryButton label={copy.account.overview} onPress={onOpen} />
      </View>
    </Card>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.infoLine}>
      <AppText color="muted" variant="caption">
        {label}
      </AppText>
      <AppText variant="bodyStrong">{value}</AppText>
    </View>
  );
}

function formatPathDate(date: string | null | undefined, language: Language | null | undefined) {
  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat(language === "fr" ? "fr" : "en", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(date));
}

const createStyles = () =>
  StyleSheet.create({
    header: {
      gap: tokens.space.sm
    },
    infoLine: {
      gap: tokens.space.xs
    },
    pathCard: {
      gap: tokens.space.sm
    },
    screen: {
      gap: tokens.space.lg,
      paddingBottom: tokens.space.xxl
    }
  });
