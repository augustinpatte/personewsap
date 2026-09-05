import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Language } from "../types/domain";
import { readBootLanguage, resolveBootLanguage, writeBootLanguage } from "./bootLanguage";

// Read once per app run, not once per mounted launch screen: five layouts can
// render the launch screen during a single boot, and they should all agree on
// the first frame rather than each racing their own AsyncStorage round-trip.
let cachedLanguage: Language | null = null;
let pendingRead: Promise<Language | null> | null = null;

function loadBootLanguage(): Promise<Language | null> {
  if (cachedLanguage) {
    return Promise.resolve(cachedLanguage);
  }

  pendingRead ??= readBootLanguage(AsyncStorage).then((language) => {
    cachedLanguage = language;
    pendingRead = null;
    return language;
  });

  return pendingRead;
}

/**
 * The language the app should speak right now, including before the profile
 * has loaded.
 *
 * Returns null while nothing is known — the caller renders a language-neutral
 * screen rather than a sentence in a language the reader may not read.
 */
export function useBootLanguage(profileLanguage: Language | null | undefined): Language | null {
  const [lastKnownLanguage, setLastKnownLanguage] = useState<Language | null>(cachedLanguage);

  useEffect(() => {
    if (cachedLanguage) {
      return;
    }

    let active = true;

    void loadBootLanguage().then((language) => {
      if (active && language) {
        setLastKnownLanguage(language);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  return resolveBootLanguage({ profileLanguage, cachedLanguage: lastKnownLanguage });
}

/**
 * Remember the language a hydrated profile resolved to, so the next cold start
 * opens in it. Called from AuthProvider — the one place that learns the
 * canonical answer — and nowhere else.
 */
export function rememberBootLanguage(language: Language): void {
  cachedLanguage = language;
  void writeBootLanguage(AsyncStorage, language);
}
