import type { GeneratedContentItem, MiniCaseChallenge, RankedArticle } from "../domain.js";
import type { CatalogRepairPlan, PlannedCatalogEntry } from "./catalogRepairPlan.js";

/**
 * The human-readable half of a repair plan.
 *
 * The JSON plan is what gets applied; this is what gets read. An editorial
 * decision is made by someone looking at the actual prose, the actual questions
 * and the actual correct answer — not at a hash — so everything needed to accept
 * or reject a candidate is on the page, next to what it replaces.
 *
 * Written to be diffable and skimmable: one section per entry, old before new,
 * and the source decision spelled out so "why is this a different story?" never
 * has to be reconstructed from the JSON.
 */
export function renderCatalogRepairReview(plan: CatalogRepairPlan): string {
  const lines: string[] = [
    `# Catalog repair review — ${plan.mode.toUpperCase()}`,
    "",
    `Repair id: \`${plan.repairId}\``,
    `Catalog run: \`${plan.runId}\``,
    `Prepared: ${plan.createdAt}`,
    `Edition date: ${plan.dropDate}`,
    `Languages: ${plan.languages.join(", ")}`,
    `Generator: ${plan.generator?.generatorLabel ?? "unknown"}`,
    "",
    "## Summary",
    "",
    `- **Requested**: ${plan.requestedEntryIds.length}`,
    `- **Prepared**: ${plan.preparedEntryIds.length}`,
    `- **Failed**: ${plan.failedEntries.length}`,
    ""
  ];

  // Failures lead, before any candidate. A batch that produced five of eight is
  // not a success with a footnote, and the three that did not make it are the
  // first thing the operator has to act on.
  if (plan.failedEntries.length > 0) {
    lines.push(
      "### Entries that produced no candidate",
      "",
      "These were requested and are NOT in this plan. They still need repair.",
      ""
    );

    for (const failure of plan.failedEntries) {
      lines.push(`- \`${failure.entryId}\` — **${failure.reason}**`);

      for (const detail of failure.details) {
        lines.push(`  - ${detail}`);
      }
    }

    lines.push("");
  }

  lines.push(
    "> Nothing here has been written. Read each entry, then apply the plan with",
    "> `--apply-plan` to persist exactly these candidates — no regeneration.",
    ""
  );

  plan.entries.forEach((entry, index) => {
    lines.push(...renderEntry(entry, index));
  });

  return `${lines.join("\n")}\n`;
}

function renderEntry(entry: PlannedCatalogEntry, index: number): string[] {
  const lines: string[] = [
    "---",
    "",
    `## ${index + 1}. \`${entry.entryId}\``,
    "",
    `- **Mode**: ${entry.mode}`,
    `- **Content type**: ${entry.contentType}${entry.miniCaseTopic ? ` (${entry.miniCaseTopic})` : ""}`,
    `- **Slot index**: ${entry.index}`,
    `- **Validation**: item ${entry.validation.itemValidation}, pair ${entry.validation.pairValidation} (${entry.validation.checkedAt})`,
    ""
  ];

  lines.push("### What is being replaced", "");
  for (const version of entry.versions) {
    lines.push(
      `- **${version.language.toUpperCase()} old title**: ${version.originalTitle}`,
      `  - content item: \`${version.contentItemId}\` (preserved)`,
      `  - old sources: ${formatUrls(version.originalSourceUrls)}`
    );
  }
  lines.push("");

  lines.push("### Source decision", "", entry.sourceDecision, "");

  lines.push("### Sources of the new candidate", "");
  if (entry.approvedSources.length === 0) {
    lines.push("_None recorded._", "");
  } else {
    for (const source of entry.approvedSources) {
      lines.push(...renderSource(source, entry.sourceUrls.includes(source.url)));
    }
    lines.push("");
  }

  for (const version of entry.versions) {
    lines.push(...renderVersion(version.language, version.item));
  }

  return lines;
}

function renderSource(source: RankedArticle, cited: boolean): string[] {
  return [
    `- ${cited ? "**cited**" : "approved, not cited"} — ${source.publisher || "unknown publisher"}: ${source.title || "untitled"}`,
    `  - ${source.url}`,
    `  - language: ${source.language} · published: ${source.published_at?.slice(0, 10) ?? "unknown"}`
  ];
}

function renderVersion(language: string, item: GeneratedContentItem): string[] {
  const lines: string[] = [`### New ${language.toUpperCase()} candidate`, "", `**${item.title}**`, ""];

  if (item.content_type === "business_story") {
    lines.push(
      `- Company / market: ${item.company_or_market}`,
      `- Story date: ${item.story_date}`,
      `- Mechanism: ${item.editorial_memory?.key_mechanism ?? "—"}`,
      `- Industry: ${item.editorial_memory?.industry ?? "—"}`,
      "",
      "#### Body",
      "",
      item.body_md,
      ""
    );

    return lines;
  }

  if (item.content_type === "mini_case") {
    lines.push(...renderMiniCase(item));
    return lines;
  }

  lines.push("", item.body_md, "");
  return lines;
}

function renderMiniCase(item: MiniCaseChallenge): string[] {
  const lines: string[] = [
    "#### Taxonomy",
    "",
    `- product_topic: \`${item.product_topic}\``,
    `- scenario_type: \`${item.scenario_type}\``,
    `- decision_type: \`${item.decision_type}\``,
    `- concept_tested: \`${item.concept_tested}\``,
    `- question_pattern: \`${item.question_pattern}\``,
    `- correct_answer_pattern: \`${item.correct_answer_pattern}\``,
    `- difficulty: \`${item.difficulty}\``,
    "",
    "#### Context",
    "",
    item.context,
    "",
    "#### Challenge",
    "",
    item.challenge,
    "",
    "#### Questions",
    ""
  ];

  const questions = Array.isArray(item.questions) ? item.questions : [];

  questions.forEach((question, questionIndex) => {
    lines.push(`**Q${questionIndex + 1} (${question.role})** — ${question.question}`, "");

    // Options are listed in the order a reader will see them, which is what the
    // deterministic ordering decided. The correct one is marked, so a reviewer
    // can check both the answer and whether its position is a giveaway.
    for (const option of question.options) {
      const marker = option.is_correct ? "**[CORRECT]**" : "[ ]";
      lines.push(`- ${marker} \`${option.id}\` ${option.text}`);
      lines.push(`  - feedback: ${option.feedback}`);
    }

    lines.push("");
  });

  lines.push("#### Takeaway", "", item.final_takeaway || item.core_takeaway || "—", "");

  return lines;
}

function formatUrls(urls: string[]): string {
  return urls.length > 0 ? urls.join(", ") : "_none_";
}
