import type { OnboardingModuleId } from "../onboarding/options";

/**
 * Which modules the reader has switched on — the one in-memory copy.
 *
 * Read once with the profile (AuthProvider's bootstrap already reads the
 * user_preferences row), replaced when Settings saves, and owned by the user it
 * was read for. Module tabs read it from memory on focus instead of re-reading
 * four preference tables every time a tab is shown.
 *
 * The defaults are those of loadEditablePreferences: no row means the three
 * content modules on and the learning path off.
 */
export type ModuleFlags = Readonly<Record<OnboardingModuleId, boolean>>;

/** The flags together with the reader they belong to. */
export type OwnedModuleFlags = {
  userId: string;
  flags: ModuleFlags;
};

export type ModuleFlagsRow = {
  newsletter_enabled?: boolean | null;
  business_stories_enabled?: boolean | null;
  mini_cases_enabled?: boolean | null;
  learning_path_enabled?: boolean | null;
};

export function moduleFlagsFromPreferencesRow(row: ModuleFlagsRow | null | undefined): ModuleFlags {
  return {
    newsletter: row?.newsletter_enabled !== false,
    business_story: row?.business_stories_enabled !== false,
    mini_case: row?.mini_cases_enabled !== false,
    learning_path: row?.learning_path_enabled === true
  };
}

export function moduleFlagsFromEnabledModules(enabledModules: readonly OnboardingModuleId[]): ModuleFlags {
  return {
    newsletter: enabledModules.includes("newsletter"),
    business_story: enabledModules.includes("business_story"),
    mini_case: enabledModules.includes("mini_case"),
    learning_path: enabledModules.includes("learning_path")
  };
}

/**
 * The flags for `userId`, or null when what is held belongs to nobody or to
 * another reader. This is the guard that keeps one account's modules from ever
 * showing on another's tabs during a switch: the owner is checked on every read.
 */
export function moduleFlagsFor(
  owned: OwnedModuleFlags | null,
  userId: string | null | undefined
): ModuleFlags | null {
  return owned && userId && owned.userId === userId ? owned.flags : null;
}

/** What a preference save changed, so the caller reloads only what depends on it. */
export function changedModuleFlags(
  before: ModuleFlags | null,
  after: ModuleFlags
): OnboardingModuleId[] {
  return (Object.keys(after) as OnboardingModuleId[]).filter(
    (moduleId) => before?.[moduleId] !== after[moduleId]
  );
}
