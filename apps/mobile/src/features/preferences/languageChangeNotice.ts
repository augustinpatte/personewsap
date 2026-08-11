import type { Language } from "../../types/domain";

export const LANGUAGE_CHANGE_NOTICE_KEY_V1 = "personewsap:language-change-notice:v1";

export type LanguageChangeNotice = {
  language: Language;
  changedOn: string;
};

type LanguageChangeNoticeStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export async function recordLanguageChangeNotice(
  storage: LanguageChangeNoticeStorage,
  language: Language,
  changedOn = formatLocalDate(new Date())
): Promise<void> {
  await storage.setItem(
    LANGUAGE_CHANGE_NOTICE_KEY_V1,
    JSON.stringify({
      language,
      changedOn
    } satisfies LanguageChangeNotice)
  );
}

export async function clearLanguageChangeNotice(storage: LanguageChangeNoticeStorage): Promise<void> {
  await storage.removeItem(LANGUAGE_CHANGE_NOTICE_KEY_V1);
}

export async function readLanguageChangeNotice(
  storage: LanguageChangeNoticeStorage
): Promise<LanguageChangeNotice | null> {
  return parseLanguageChangeNotice(await storage.getItem(LANGUAGE_CHANGE_NOTICE_KEY_V1));
}

export async function shouldShowStoredLanguageChangeNotice(
  storage: LanguageChangeNoticeStorage,
  input: {
    currentLanguage: Language;
    dropDate: string;
    isEditionDay: boolean;
    isEmptyDrop: boolean;
  }
): Promise<boolean> {
  if (!input.isEmptyDrop) {
    await clearLanguageChangeNotice(storage);
    return false;
  }

  const notice = await readLanguageChangeNotice(storage);
  const visible = shouldShowLanguageChangeNotice(notice, input);

  if (notice && notice.changedOn !== input.dropDate) {
    await clearLanguageChangeNotice(storage);
  }

  return visible;
}

export function shouldShowLanguageChangeNotice(
  notice: LanguageChangeNotice | null,
  input: {
    currentLanguage: Language;
    dropDate: string;
    isEditionDay: boolean;
    isEmptyDrop: boolean;
  }
): boolean {
  return (
    input.isEmptyDrop &&
    input.isEditionDay &&
    notice?.language === input.currentLanguage &&
    notice.changedOn === input.dropDate
  );
}

export function parseLanguageChangeNotice(value: string | null): LanguageChangeNotice | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<LanguageChangeNotice>;
    if (
      (parsed.language === "fr" || parsed.language === "en") &&
      typeof parsed.changedOn === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed.changedOn)
    ) {
      return {
        language: parsed.language,
        changedOn: parsed.changedOn
      };
    }
  } catch {
    return null;
  }

  return null;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
