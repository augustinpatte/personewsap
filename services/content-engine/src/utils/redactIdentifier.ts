const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const USER_IDENTIFIER_KEYS = new Set([
  "auth_user_id",
  "test_user_id",
  "user_id",
  "userId",
  "userIds"
]);

export function redactIdentifier(identifier: string | null | undefined): string | null {
  if (!identifier) {
    return null;
  }

  if (identifier.length <= 10) {
    return "[redacted]";
  }

  return `${identifier.slice(0, 6)}...${identifier.slice(-4)}`;
}

export function redactLogIdentifiers(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactLogIdentifiers(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (USER_IDENTIFIER_KEYS.has(key)) {
        if (Array.isArray(entry)) {
          return [key, entry.map((item) => (typeof item === "string" ? redactIdentifier(item) : redactLogIdentifiers(item)))];
        }

        return [key, typeof entry === "string" ? redactIdentifier(entry) : redactLogIdentifiers(entry)];
      }

      if (typeof entry === "string" && UUID_PATTERN.test(entry)) {
        return [key, redactIdentifier(entry)];
      }

      return [key, redactLogIdentifiers(entry)];
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
