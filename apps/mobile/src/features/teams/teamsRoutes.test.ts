import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every navigation in the app leads somewhere that exists.
 *
 * THE BUG THIS CLASS OF TEST EXISTS FOR. The Teams landing screen shipped with
 * two buttons that called `router.push("/(teams)/join")` and
 * `router.push("/(teams)/create")` against a route tree that contained neither.
 * Expo Router does not fail a build over that and TypeScript could not see it
 * through the `as Href` casts the codebase uses; the buttons simply did
 * nothing, and the only way to find out was to tap them on a device.
 *
 * So the route table is derived from the filesystem and every navigation target
 * in the app is resolved against it. A dead push is a failing test rather than
 * a dead button.
 *
 * WHAT A "TARGET" IS. Any string literal or template literal handed to
 * `router.push` / `replace` / `navigate`, or to an `href`, that starts with a
 * slash. A `${...}` hole is treated as one path segment, which is exactly what
 * it is: a team id or a content id, never a slash-bearing sub-path.
 */

const appDir = join(__dirname, "..", "..", "..", "app");
const srcDir = join(__dirname, "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Each route file, as the path Expo Router derives from it. */
function routePatterns(): string[] {
  return walk(appDir)
    .filter((file) => /\.[jt]sx?$/.test(file))
    .map((file) => relative(appDir, file).split(sep).join("/"))
    .filter((route) => !route.endsWith("_layout.tsx"))
    .map((route) => `/${route.replace(/\.[jt]sx?$/, "")}`)
    .map((route) => (route.endsWith("/index") ? route.slice(0, -"/index".length) : route))
    .map((route) => (route === "" ? "/" : route));
}

/**
 * A route group — `(teams)` — is not part of the URL, so both spellings resolve.
 *
 * The codebase writes the group out (`/(teams)/join`) because that is what the
 * typed-routes cast wants; an invite deep link writes `/join` because that is
 * what a link should look like. Both have to be accepted or one of them is a
 * false failure.
 */
function expand(route: string): string[] {
  const withoutGroups = route.replace(/\/\([^)]+\)/g, "");
  return withoutGroups === route ? [route] : [route, withoutGroups || "/"];
}

const ROUTES = routePatterns().flatMap(expand);

function toRegExp(pattern: string): RegExp {
  const source = pattern
    .split("/")
    .map((segment) => {
      if (/^\[\.\.\..+\]$/.test(segment)) {
        return ".+";
      }

      if (/^\[.+\]$/.test(segment)) {
        return "[^/]+";
      }

      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");

  return new RegExp(`^${source}$`);
}

const MATCHERS = ROUTES.map(toRegExp);

function resolves(target: string): boolean {
  return MATCHERS.some((matcher) => matcher.test(target));
}

const NAVIGATION = /(?:router\.(?:push|replace|navigate)|href=\{?)\s*\(?\s*(["'`])([^"'`]+)\1/g;

function navigationTargets(): Array<{ file: string; target: string }> {
  const found: Array<{ file: string; target: string }> = [];

  for (const file of [...walk(appDir), ...walk(srcDir)]) {
    if (!/\.[jt]sx?$/.test(file) || /\.test\.[jt]sx?$/.test(file)) {
      continue;
    }

    const source = readFileSync(file, "utf8");

    for (const match of source.matchAll(NAVIGATION)) {
      const raw = match[2];

      if (!raw.startsWith("/")) {
        continue;
      }

      const target = raw
        // A `${...}` hole is one segment: an id, never a sub-path.
        .replace(/\$\{[^}]*\}/g, "x")
        .split("?")[0]
        .replace(/(.)\/$/, "$1");

      found.push({ file, target });
    }
  }

  return found;
}

describe("the route table", () => {
  it("has the five Teams destinations the product needs", () => {
    for (const route of [
      "/(teams)/create",
      "/(teams)/join",
      "/(teams)/[id]",
      "/(teams)/[id]/manage",
      "/(teams)/[id]/members",
      "/(teams)/[id]/invite"
    ]) {
      expect(ROUTES, route).toContain(route);
    }
  });

  it("has the player profile editor outside Teams", () => {
    // Reached from Account. Teams is where you manage a league; "who am I on a
    // leaderboard" belongs beside the email and the language.
    expect(ROUTES).toContain("/player-profile");
  });

  it("resolves the invite deep link", () => {
    // `Linking.createURL("/join")` — a group is not part of a URL, so this has
    // to land on (teams)/join or every invite link is dead.
    expect(resolves("/join")).toBe(true);
  });
});

describe("no dead routes", () => {
  it("resolves every navigation target in the app", () => {
    const dead = navigationTargets().filter((entry) => !resolves(entry.target));

    expect(dead.map((entry) => `${entry.target} (${entry.file})`)).toEqual([]);
  });

  it("found targets to check, so an empty pass cannot be a green test", () => {
    expect(navigationTargets().length).toBeGreaterThan(10);
  });
});

describe("the bottom bar", () => {
  const tabsLayout = readFileSync(join(appDir, "(tabs)", "_layout.tsx"), "utf8");

  it("carries exactly five destinations", () => {
    const declared = [...tabsLayout.matchAll(/<Tabs\.Screen\s+name="(\w+)"/g)].map(
      (match) => match[1]
    );

    expect(declared).toEqual(["newsletter", "cases", "stories", "path", "teams", "settings"]);
    // Settings is in the group but not in the bar: five is the most a bottom
    // bar carries at 10.5pt without the labels becoming unreadable.
    expect(tabsLayout).toMatch(/name="settings"[\s\S]{0,80}href: null/);
  });

  it("keeps the translucent bar material", () => {
    expect(tabsLayout).toContain("TabBarBackground");
  });
});

describe("Realtime stays on one screen", () => {
  it("is opened by Team Detail and by nothing else", () => {
    const users = [...walk(srcDir), ...walk(appDir)]
      .filter((file) => /\.[jt]sx?$/.test(file) && !/\.test\.[jt]sx?$/.test(file))
      .filter((file) => readFileSync(file, "utf8").includes("useTeamLeaderboardChannel"))
      .map((file) => file.split(sep).pop());

    // The hook's own module, its barrel export, and the one screen that uses it.
    expect(users.sort()).toEqual([
      "TeamDetailScreen.tsx",
      "useTeamLeaderboardChannel.ts"
    ]);
  });
});
