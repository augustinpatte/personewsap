# Source Ingestion Notes

PersoNewsAP source ingestion is intentionally narrow: collect reputable feed metadata, rank it, and use it as source material for one daily drop. It is not a scraper and it is not an infinite news feed.

## Current Source Model

Curated sources live in `curatedSources.ts`. Each source includes:

- `publisher`
- `topic`
- `language`
- `credibility_tier`
- `credibility_score`
- `source_type`
- `url`
- optional `rssUrl`
- optional `usage_notes`

The RSS connector reads only feed-level fields: title, link, publication date, summary/description, publisher, language, topic, and retrieval time. It does not fetch full article pages and must not bypass paywalls, robots rules, or publisher licensing.

## Credibility Tiers

- `tier_1`: primary institutions, peer-reviewed journals, highly trusted public-service newsrooms, or specialist sources with strong editorial standards.
- `tier_2`: reputable specialist publishers, trade publications, or corporate/institutional blogs useful as primary source material.
- `tier_3`: narrower trade sources with useful signal but higher editorial or commercial bias risk.

Tier is not a truth label. It is an input to ranking and editorial review.

## Source Limitations

- RSS availability changes. Failed feeds are ignored by the connector so dry-run and scheduled jobs can continue.
- RSS summaries can be incomplete or promotional. Generation should cite sources conservatively and avoid unsupported claims.
- Some publishers permit RSS only for personal use. Keep those entries without `rssUrl` unless PersoNewsAP has permission.
- Institutional sources are often primary but self-interested. Use them for what an institution said or filed, not as independent analysis.
- Law, medicine, and finance sources need extra care: prefer primary documents and avoid personal legal, medical, or investment advice.

## Add Or Remove Sources

To add a source:

1. Add an entry to `CURATED_SOURCES` in `curatedSources.ts`.
2. Choose one approved `topic` from the product topic IDs.
3. Set `language`, `credibility_tier`, `credibility_score`, and `source_type`.
4. Add `rssUrl` only when the feed is public and its terms allow the intended use.
5. Add `usage_notes` when licensing, paywall, or editorial caveats matter.
6. Run `npm run check` from `services/content-engine`.

To remove or pause a source:

1. Remove `rssUrl` first if the source should remain as a curated reference but not be ingested.
2. Remove the whole entry only when it is no longer useful or reputable.
3. Keep topic coverage balanced so one publisher cannot dominate a daily drop.
