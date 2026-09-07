import { supabase } from "../../lib/supabase";
import type { ContentLanguage, ContentTeamRef, ContentType } from "./contentTypes";

/**
 * The reader's Team content, as the database hands it over.
 *
 * ONE ROUND TRIP, WHATEVER THE SHAPE OF THE READER'S LIFE. A reader in four
 * Teams, each assigned six articles and a case, is one RPC — not one per Team,
 * and certainly not one per item. `get_my_team_edition_content` already returns
 * one row per LOGICAL content with every Team that assigned it folded into a
 * `teams` array, so the client never fans out and never joins `public.teams`
 * (which carries the invite code and the unmoderated name, and which the client
 * holds no SELECT on at all).
 *
 * WHAT COMES BACK IS AN INDEX, NOT AN ARTICLE. The RPC returns identity, title
 * and summary — enough to know what the reader was given — and no body. The
 * bodies are read from `content_items` in one further query, under the ordinary
 * read policy, which is what keeps the entitlement rules in the database rather
 * than in this file.
 *
 * BEST EFFORT, ALWAYS. Every fetch here returns an empty list on failure rather
 * than throwing. A reader whose Team content could not be loaded still gets
 * their own edition, which is the product; one who got an error screen instead
 * would have lost both.
 */

/** The content types a Team can be assigned. Business Story is never one. */
export const TEAM_ASSIGNABLE_CONTENT_TYPES = [
  "newsletter_article",
  "mini_case"
] as const;

export type TeamAssignableContentType = (typeof TEAM_ASSIGNABLE_CONTENT_TYPES)[number];

export type TeamContentAssignment = {
  /** Shared by the FR and EN renderings of one editorial job. */
  contentLogicalKey: string;
  contentType: TeamAssignableContentType;
  /** The rendering to show: the reader's language when it exists. */
  displayContentItemId: string;
  displayLanguage: ContentLanguage;
  editionDate: string;
  /** Position inside the Team's own edition, so Team order stays the Team's. */
  position: number;
  teams: ContentTeamRef[];
};

/** The identity two routes to one article have to agree on (logical, not row). */
export function teamContentIdentity(input: {
  contentLogicalKey: string;
  contentType: string;
}): string {
  return `${input.contentType}:${input.contentLogicalKey}`;
}

/**
 * Parse the RPC's rows.
 *
 * Defensive to the point of dullness on purpose: this is the one place where
 * database JSON becomes typed application data, and a malformed row must drop
 * out rather than reach a screen. A row for a content type Teams cannot be
 * assigned is dropped too — Business Story is Solo, and the surest way to keep
 * it Solo is to refuse it here as well as in the schema.
 */
export function parseTeamContentAssignments(rows: unknown): TeamContentAssignment[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  const assignments: TeamContentAssignment[] = [];

  for (const entry of rows) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const contentLogicalKey = readString(row.content_logical_key);
    const contentType = row.content_type;
    const displayContentItemId = readString(row.display_content_item_id);

    if (
      contentLogicalKey.length === 0 ||
      displayContentItemId.length === 0 ||
      !isTeamAssignableContentType(contentType)
    ) {
      continue;
    }

    assignments.push({
      contentLogicalKey,
      contentType,
      displayContentItemId,
      displayLanguage: row.display_language === "fr" ? "fr" : "en",
      editionDate: readString(row.edition_date).slice(0, 10),
      position: readPosition(row.assignment_position),
      teams: parseTeamRefs(row.teams)
    });
  }

  // Stable order, decided here rather than trusted from the wire: the Team's
  // own position first, then the logical key so two rows sharing a position
  // still resolve to one order instead of the planner's.
  return assignments.sort(
    (left, right) =>
      left.position - right.position ||
      left.contentLogicalKey.localeCompare(right.contentLogicalKey)
  );
}

/** The Team refs on one row, already moderated by the database. */
export function parseTeamRefs(value: unknown): ContentTeamRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const teams: ContentTeamRef[] = [];

  for (const entry of value) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const id = readString(row.id);

    if (id.length === 0 || teams.some((team) => team.id === id)) {
      continue;
    }

    teams.push({
      id,
      // Already null when moderation has hidden it. The badge renders a neutral
      // label in its place; it never invents one.
      name: typeof row.name === "string" && row.name.trim().length > 0 ? row.name : null
    });
  }

  return teams;
}

/** What one logical content is, as a Team assignment. */
export type TeamAssignmentRef = {
  teams: ContentTeamRef[];
  /** The Team's own position for it, which is the order the reader sees. */
  position: number;
};

/**
 * Team assignments by logical identity.
 *
 * Keyed on identity rather than on a row id so it answers for BOTH routes with
 * one lookup: the Team-only article the reader would not otherwise have, and
 * the reader's own copy of an article a Team was also assigned. The second is
 * the one that is easy to miss, and it is the one that decides whether the
 * badge appears on an article already sitting in their edition.
 */
export function indexTeamAssignmentsByIdentity(
  assignments: TeamContentAssignment[]
): Map<string, TeamAssignmentRef> {
  const index = new Map<string, TeamAssignmentRef>();

  for (const assignment of assignments) {
    const identity = teamContentIdentity(assignment);
    const existing = index.get(identity) ?? {
      teams: [],
      position: assignment.position
    };

    for (const team of assignment.teams) {
      if (!existing.teams.some((entry) => entry.id === team.id)) {
        existing.teams.push(team);
      }
    }

    // Two Teams assigning one article at different positions: the earliest
    // wins, so the article leads for the reader who was given it twice.
    existing.position = Math.min(existing.position, assignment.position);
    index.set(identity, existing);
  }

  return index;
}

/** The reader's Team content for one edition. Empty on any failure. */
export async function fetchTeamContentForEdition(
  editionDate: string,
  language?: ContentLanguage
): Promise<TeamContentAssignment[]> {
  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase.rpc("get_my_team_edition_content", {
      p_edition_date: editionDate,
      p_language: language ?? null
    });

    if (error || !data) {
      return [];
    }

    return parseTeamContentAssignments(data);
  } catch {
    // A thrown error — an offline device, a transport failure — is the same
    // answer as a returned one: no Team content. This is the whole reason the
    // caller can treat Team content as additive and never guard it.
    return [];
  }
}

/**
 * The reader's Team content across a span of editions, for the archive.
 *
 * One call for a whole page of editions. The date range is what makes that
 * possible: calling the single-edition RPC once per loaded edition would be
 * twenty-five round trips to draw one list.
 */
export async function fetchTeamContentForRange(input: {
  fromDate: string;
  toDate: string;
  language?: ContentLanguage;
  limit?: number;
}): Promise<TeamContentAssignment[]> {
  if (!supabase || !input.fromDate || !input.toDate) {
    return [];
  }

  try {
    const { data, error } = await supabase.rpc("get_my_team_archive_content", {
      p_from_date: input.fromDate,
      p_to_date: input.toDate,
      p_language: input.language ?? null,
      p_limit: input.limit ?? 200
    });

    if (error || !data) {
      return [];
    }

    return parseTeamContentAssignments(data);
  } catch {
    return [];
  }
}

function isTeamAssignableContentType(value: unknown): value is TeamAssignableContentType {
  return (
    typeof value === "string" &&
    (TEAM_ASSIGNABLE_CONTENT_TYPES as readonly string[]).includes(value)
  );
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPosition(value: unknown): number {
  const position = typeof value === "number" ? value : Number(value);

  return Number.isFinite(position) ? position : 0;
}

/** Narrowing helper for callers that hold a `ContentType` from the domain. */
export function isTeamAssignable(contentType: ContentType): boolean {
  return (TEAM_ASSIGNABLE_CONTENT_TYPES as readonly string[]).includes(contentType);
}
