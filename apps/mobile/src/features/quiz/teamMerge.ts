/**
 * One edition, two sources of content.
 *
 * A reader's Newsletter tab used to show exactly their own daily drop. It now
 * has to show that plus whatever their Teams were assigned — inside the same
 * editorial section, not in a second feed, because "Newsletter" is a place in
 * the product and a Team article is still a newsletter article.
 *
 * Two rules make that work, and both are here rather than in a screen:
 *
 *   ORDER      Team first, then personal. A Team item is the one with a
 *              deadline and a leaderboard attached, so it leads.
 *
 *   IDENTITY   Deduplicate on the LOGICAL content key, never on the row id.
 *              The FR and EN renderings of one article are two content_items
 *              rows sharing a content_logical_key; a reader whose personal drop
 *              holds the English row while their Team was assigned the French
 *              one must see one article, not two. Row-id deduplication looks
 *              correct in a single-language test and ships a duplicate the day
 *              somebody switches language.
 *
 * When the same logical article reaches a reader through three routes —
 * personal, Team A and Team B — it appears once, presented as Team, carrying
 * both Team badges. The personal route is not lost: it is recorded on the entry
 * so progress tracking still knows the item is theirs.
 */

export type TeamRef = {
  id: string;
  /** Null when moderation has hidden the name; the UI shows a neutral label. */
  name: string | null;
};

/** The minimum an item must expose to be merged. */
export type MergeableContent = {
  /** The assigned content_items row id — the anchor every interaction uses. */
  id: string;
  /**
   * Shared by the FR and EN renderings of one editorial job. Named for the
   * column it comes from, so the content items the readers already hold can be
   * merged as they are rather than through an adapter that could drop it.
   */
  content_logical_key?: string | null;
  /**
   * Part of the identity, not decoration: a mini case and a newsletter article
   * produced by one staging batch can share a logical key, and collapsing them
   * into one row would lose a reading.
   */
  content_type?: string;
};

export type TeamAssignment<TItem extends MergeableContent> = {
  team: TeamRef;
  item: TItem;
  /** Position within the team's edition, so team order is the team's own. */
  position?: number;
};

/**
 * One row of the merged list.
 *
 * `teams` is empty for a purely personal item and holds every Team that was
 * assigned this content otherwise — that is what lets a submitted answer be
 * explained ("counted for Loyola Finance and Tennis Team") without the screen
 * having to re-query anything.
 */
export type MergedEntry<TItem extends MergeableContent> = {
  item: TItem;
  teams: TeamRef[];
  /** "team" as soon as at least one Team was assigned this content. */
  source: "team" | "personal";
  /** True when the reader's own edition also carries it. */
  inPersonalEdition: boolean;
};

/**
 * The identity two routes to the same article must agree on.
 *
 * It is `content_logical_key` PLUS `content_type`, per the merge rule, and
 * never the row id — the row id is the translated one, and two readings of one
 * article in two languages are two row ids.
 *
 * Falls back to the row id when a logical key is missing — legacy content
 * predates the key, and an item with no key is only ever itself. That fallback
 * is deliberately not silent about what it means: two language renderings of a
 * keyless item WILL both appear, because nothing in the data says they are the
 * same thing.
 */
export function contentIdentity(item: MergeableContent): string {
  const key = item.content_logical_key?.trim();
  const type = item.content_type ?? "content";

  return key && key.length > 0 ? `logical:${type}:${key}` : `item:${item.id}`;
}

export function mergeTeamAndPersonalContent<TItem extends MergeableContent>(input: {
  teamAssignments: Array<TeamAssignment<TItem>>;
  personalItems: TItem[];
}): Array<MergedEntry<TItem>> {
  const byIdentity = new Map<string, MergedEntry<TItem>>();
  const order: string[] = [];

  const assignments = [...input.teamAssignments].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  );

  // Team first, and in one pass, so the order of the output is the order Teams
  // were assigned rather than the order the personal edition happened to use.
  for (const assignment of assignments) {
    const identity = contentIdentity(assignment.item);
    const existing = byIdentity.get(identity);

    if (!existing) {
      byIdentity.set(identity, {
        item: assignment.item,
        teams: [assignment.team],
        source: "team",
        inPersonalEdition: false
      });
      order.push(identity);
      continue;
    }

    // Same content, another Team. One entry, two badges — and never the same
    // Team twice, which a team assigned both language renderings would produce.
    if (!existing.teams.some((team) => team.id === assignment.team.id)) {
      existing.teams.push(assignment.team);
    }
  }

  for (const item of input.personalItems) {
    const identity = contentIdentity(item);
    const existing = byIdentity.get(identity);

    if (!existing) {
      byIdentity.set(identity, {
        item,
        teams: [],
        source: "personal",
        inPersonalEdition: true
      });
      order.push(identity);
      continue;
    }

    // THE collision case (§13): the content is both Team and Solo. It is played
    // once and presented as Team, because at least one Team assignment exists —
    // but the personal route is recorded, since the reader's own progress still
    // counts it.
    existing.inPersonalEdition = true;

    // The item kept is the TEAM one. Its row id is what the Team assignment
    // referenced, and that is the id the backend scores against.
  }

  return order.map((identity) => byIdentity.get(identity) as MergedEntry<TItem>);
}

/** Just the items, in merged order — for screens that do not render badges. */
export function mergedItems<TItem extends MergeableContent>(
  entries: Array<MergedEntry<TItem>>
): TItem[] {
  return entries.map((entry) => entry.item);
}

/**
 * How a merged entry is labelled.
 *
 * Deliberately returns data rather than a string: the badge is rendered with
 * the product's own type and colour, and a screen that received "Loyola Finance
 * +1" as text could not do that.
 */
export function describeEntryTeams(entry: MergedEntry<MergeableContent>): {
  isTeam: boolean;
  primary: TeamRef | null;
  extra: TeamRef[];
} {
  const [primary = null, ...extra] = entry.teams;

  return { isTeam: entry.teams.length > 0, primary, extra };
}
