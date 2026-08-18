/**
 * What an archive module shows when it has nothing to list.
 *
 * "No item of this type" and "no item of this type *in the editions loaded so
 * far*" are different statements, and the second one used to be told as the
 * first. The archive is paginated: a reader whose last 25 editions happen to
 * carry no Business Story would be told their archive is empty, with no way to
 * look further back — even though older editions hold several.
 *
 * The rule is decided here, as a pure function, so the three module lists all
 * answer it the same way and it can be tested without rendering.
 */
export type ArchiveEmptyStateKind =
  /** Rows to render. */
  | "list"
  /** The archive itself failed to load: offer a retry, not an empty state. */
  | "error"
  /** Nothing of this type yet, but older editions exist and can be fetched. */
  | "load-earlier"
  /** Genuinely nothing: the whole archive has been walked. */
  | "empty";

export function resolveArchiveEmptyState(input: {
  itemCount: number;
  isSearchActive: boolean;
  hasError: boolean;
  /** True while the archive still has older, unfetched pages. */
  hasMore: boolean;
}): ArchiveEmptyStateKind {
  // A search draws its own empty state (no match), and it already covers the
  // whole history server-side, so paging the browse archive is irrelevant.
  if (input.isSearchActive || input.itemCount > 0) {
    return "list";
  }

  if (input.hasError) {
    return "error";
  }

  // Only ever one more page, and only on an explicit tap: no auto-retry loop,
  // no recursion until something is found.
  return input.hasMore ? "load-earlier" : "empty";
}
