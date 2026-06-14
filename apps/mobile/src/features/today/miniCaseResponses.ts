import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "personews:mini-case-responses:v1";

export type MiniCaseResponseRecord = {
  selections: Record<string, string>;
  score: number;
  total: number;
  completedAt: string;
};

type MiniCaseResponseMap = Record<string, MiniCaseResponseRecord>;

export async function readMiniCaseResponse(
  itemId: string
): Promise<MiniCaseResponseRecord | null> {
  const map = await readAll();
  return map[itemId] ?? null;
}

// Persists the answers once. A saved record is never overwritten, so reopening
// a completed case can only ever review the original decisions.
export async function writeMiniCaseResponse(
  itemId: string,
  record: MiniCaseResponseRecord
): Promise<void> {
  const map = await readAll();

  if (map[itemId]) {
    return;
  }

  map[itemId] = record;

  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Device storage is best-effort; a failed write just means review mode
    // falls back to showing the model answers without the user's own picks.
  }
}

async function readAll(): Promise<MiniCaseResponseMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed)) {
      return {};
    }

    const map: MiniCaseResponseMap = {};

    for (const [itemId, value] of Object.entries(parsed)) {
      const record = parseRecord(value);

      if (record) {
        map[itemId] = record;
      }
    }

    return map;
  } catch {
    return {};
  }
}

function parseRecord(value: unknown): MiniCaseResponseRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const { selections, score, total, completedAt } = value;

  if (!isRecord(selections)) {
    return null;
  }

  const normalizedSelections: Record<string, string> = {};

  for (const [questionId, optionId] of Object.entries(selections)) {
    if (typeof optionId === "string") {
      normalizedSelections[questionId] = optionId;
    }
  }

  return {
    selections: normalizedSelections,
    score: typeof score === "number" ? score : 0,
    total: typeof total === "number" ? total : 0,
    completedAt: typeof completedAt === "string" ? completedAt : ""
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
