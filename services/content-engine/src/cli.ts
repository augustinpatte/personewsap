#!/usr/bin/env node
import { parseDryRunOptions, runDryRun } from "./cli/dryRun.js";
import { parseLlmRunOptions, runLlmRun } from "./cli/llmRun.js";

async function main(): Promise<void> {
  const [command = "dry-run", ...args] = process.argv.slice(2);

  if (command === "dry-run") {
    const output = await runDryRun(parseDryRunOptions(args));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "llm-run") {
    const output = await runLlmRun(parseLlmRunOptions(args));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function printHelp(): void {
  process.stdout.write(`PersoNewsAP content engine

Commands:
  dry-run                 Run local sample source -> processing -> generation pipeline.
  llm-run                 Run the same pipeline with OpenAI structured LLM generation.

Options:
  --date YYYY-MM-DD       Drop date. Defaults to today.
  --language en           Single language. Defaults to en.
  --languages en,fr       Comma-separated languages.
  --topics a,b            Approved topic IDs. Defaults to core dry-run topics.
  --newsletter-count 4    Newsletter article count. Defaults to 4.
  --live-rss              Also try live RSS feeds. No API key required.

Examples:
  npm run dry-run
  npm run dry-run -- --languages en,fr --newsletter-count 3
  OPENAI_API_KEY=... npm run llm-run -- --language en
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`content-engine failed: ${message}\n`);
  process.exitCode = 1;
});
