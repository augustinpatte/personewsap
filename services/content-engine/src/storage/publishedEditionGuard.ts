/**
 * A published edition is immutable.
 *
 * Once an edition date exists in `public.editions`, the readers who received it
 * have read it, answered its questions and scored on it. The database refuses
 * to rewrite its drops (20261005130000_published_edition_immutability); this is
 * the same rule one layer up, so the legacy daily job and the break-glass
 * publisher stop BEFORE generating and writing anything, with an error that
 * says what to do instead, rather than failing halfway on a trigger.
 */

export const PUBLISHED_EDITION_RECOVERY_HINT =
  "To complete or retry the canonical edition, re-run the scheduled publisher for its own batch " +
  "(staging SQL editor: select public.run_scheduled_publication_tick(true);). " +
  "An intentional repair of a published edition is an operator SQL change made inside one transaction with " +
  "`set local personews.allow_edition_rewrite = 'on'` (docs/SCHEDULED_PUBLICATION.md, \"Published editions are immutable\").";

export class PublishedEditionError extends Error {
  readonly code = "published_edition_immutable";

  constructor(
    readonly dropDate: string,
    readonly publishedAt: string | null,
    readonly path: string
  ) {
    super(
      `Edition ${dropDate} is already published${publishedAt ? ` (registered ${publishedAt})` : ""}. ` +
        `${path} refuses to rewrite a published edition. ${PUBLISHED_EDITION_RECOVERY_HINT}`
    );
    this.name = "PublishedEditionError";
  }
}

export type PublishedEdition = {
  editionDate: string;
  publishedAt: string | null;
};

export function isPublishedEditionError(error: unknown): error is PublishedEditionError {
  return error instanceof PublishedEditionError;
}
