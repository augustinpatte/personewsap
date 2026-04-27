type SourceLogDetails = Record<string, unknown>;

export function sourceLog(event: string, details: SourceLogDetails): void {
  process.stderr.write(`[sources] ${new Date().toISOString()} ${event} ${JSON.stringify(details)}\n`);
}

export function sourceWarning(event: string, details: SourceLogDetails): void {
  process.stderr.write(`[sources] ${new Date().toISOString()} ${event} ${JSON.stringify(details)}\n`);
}
