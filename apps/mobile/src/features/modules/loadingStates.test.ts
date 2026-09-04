import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What each waiting state is allowed to look like.
 *
 * Content that is merely on its way gets a placeholder shaped like the content;
 * something the reader explicitly asked for and is waiting on keeps a spinner,
 * because there the spinner answers a question they just asked. Confusing the
 * two is how an app ends up either spinning at people or pretending a save is
 * instant.
 *
 * `resolveTodayEditionState` already decides which state a screen is in and is
 * tested on its own; these cases pin what each branch then renders.
 */

const modulesDir = __dirname;
const read = (...segments: string[]) =>
  readFileSync(join(modulesDir, ...segments), "utf8");

/** Source with comments removed, so prose about spinners is not a finding. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const chrome = stripComments(read("ModuleChrome.tsx"));
const newsletter = stripComments(read("NewsletterModuleScreen.tsx"));
const stories = stripComments(read("StoriesModuleScreen.tsx"));
const cases = stripComments(read("MiniCasesModuleScreen.tsx"));
const archiveList = stripComments(read("ItemArchiveList.tsx"));
const readerProvider = stripComments(
  read("..", "today", "ReaderItemProvider.tsx")
);
const readerScaffold = stripComments(
  read("..", "today", "readers", "ReaderScaffold.tsx")
);
const primaryButton = stripComments(read("..", "..", "components", "PrimaryButton.tsx"));
const preferencesEditor = stripComments(
  read("..", "preferences", "PreferencesEditor.tsx")
);
const notificationCard = stripComments(
  read("..", "notifications", "NotificationPreferencesCard.tsx")
);

describe("content that is still loading", () => {
  it("shows a placeholder shaped like the edition, not a spinner", () => {
    expect(chrome).toContain("ModuleContentSkeleton");
    expect(chrome).not.toContain("ActivityIndicator");
  });

  it("shows a placeholder shaped like the reading in the reader", () => {
    expect(readerProvider).toContain("ReaderContentSkeleton");
    expect(readerProvider).not.toContain("ActivityIndicator");
  });

  it("routes every module's loading branch through that one surface", () => {
    for (const [name, source] of [
      ["newsletter", newsletter],
      ["stories", stories],
      ["mini cases", cases],
      ["archive", archiveList]
    ] as const) {
      expect(source, name).toContain("<ModuleLoading");
    }
  });
});

describe("content that has arrived", () => {
  it("replaces the placeholder and fades in once", () => {
    for (const [name, source] of [
      ["newsletter", newsletter],
      ["stories", stories],
      ["mini cases", cases]
    ] as const) {
      expect(source, name).toMatch(/<ModuleScroll[^>]*reveal/);
    }

    // The fade lives in one place, so it cannot drift per screen.
    expect(chrome).toContain("ContentReveal");
  });

  it("never delays content in order to animate it", () => {
    const reveal = stripComments(
      read("..", "..", "components", "ContentReveal.tsx")
    );

    expect(reveal).not.toContain("setTimeout");
    expect(reveal).toContain("useReducedMotion");
  });
});

describe("a query that failed", () => {
  it("keeps its error treatment instead of a placeholder that never resolves", () => {
    for (const [name, source] of [
      ["newsletter", newsletter],
      ["stories", stories],
      ["mini cases", cases]
    ] as const) {
      expect(source, name).toContain('editionState === "error"');
      expect(source, name).toContain("<ModuleError");
    }
  });
});

describe("waiting on something the reader asked for", () => {
  it("keeps the spinner where it is the answer to their action", () => {
    // Submitting, saving a preference, toggling notifications: all still
    // spin, deliberately. Replacing these with a skeleton would suggest the
    // screen is loading rather than that their action is in flight.
    expect(primaryButton).toContain("ActivityIndicator");
    expect(preferencesEditor).toContain("ActivityIndicator");
    expect(notificationCard).toContain("ActivityIndicator");
  });

  it("keeps the spinner on an explicitly requested older page", () => {
    expect(archiveList).toContain("loadingMore");
    expect(archiveList).toContain("ActivityIndicator");
    expect(newsletter).toContain("ActivityIndicator");
  });
});

describe("pressed surfaces keep their semantics", () => {
  it("still announces itself as a button with its hint", () => {
    const surface = stripComments(
      read("..", "..", "components", "PressableSurface.tsx")
    );

    expect(surface).toContain("accessibilityRole");
    expect(surface).toContain("accessibilityLabel");
    expect(surface).toContain("accessibilityHint");
    expect(surface).toContain("accessibilityState");
    // Disabled is passed through rather than inferred from the visual state.
    expect(surface).toContain("disabled");
  });

  it("keeps role and hint on the migrated card surfaces", () => {
    for (const [name, source] of [
      ["newsletter", newsletter],
      ["stories", stories],
      ["mini cases", cases]
    ] as const) {
      expect(source, name).toContain("accessibilityHint={copy.common.openHint}");
    }
  });

  it("extends the reach of the small view switch instead of resizing it", () => {
    expect(chrome).toContain("hitSlop");
    expect(chrome).toContain("minHeight: 44");
  });
});

describe("Dynamic Type", () => {
  it("lets the reader bar grow with its label rather than clipping it", () => {
    // The bar carries the eyebrow, so a fixed height is a clipping bug waiting
    // for someone to turn the text size up.
    expect(readerScaffold).toContain("minHeight: 48");
    expect(readerScaffold).not.toMatch(/topBar:\s*\{[^}]*\bheight:\s*\d/);
  });

  it("never switches font scaling off anywhere in the app", () => {
    for (const source of [
      chrome,
      newsletter,
      stories,
      cases,
      archiveList,
      readerScaffold,
      primaryButton
    ]) {
      expect(source).not.toContain("allowFontScaling={false}");
    }
  });
});
