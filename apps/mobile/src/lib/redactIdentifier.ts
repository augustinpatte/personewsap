/**
 * An id as it may appear in a development log line: the first and last four
 * characters, enough to tell two readers apart, never the whole value.
 *
 * One copy on purpose. The six data modules that log carried identical copies,
 * and a redaction rule that drifts in one of them is a full id in a log.
 */
export function redactIdentifier(identifier: string): string {
  return identifier.length <= 8
    ? identifier
    : `${identifier.slice(0, 4)}...${identifier.slice(-4)}`;
}
