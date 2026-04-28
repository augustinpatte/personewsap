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
- `region`
- `url`
- optional `rssUrl`
- optional `usage_notes`

The registry is grouped conceptually by the eight PersoNewsAP topics and exports `CURATED_SOURCE_COVERAGE` so live runs can log source count, RSS count, tier-1 count, and region coverage per topic. Source entries without `rssUrl` are deliberate curated references: they may be reputable, but they are not pulled during `LIVE_RSS=true` until licensing and feed stability are clear.

The RSS connector reads only feed-level fields: title, link, publication date, summary/description, publisher, language, topic, and retrieval time. It does not fetch full article pages and must not bypass paywalls, robots rules, or publisher licensing. Long feed bodies from `content:encoded` are treated as short snippets only.

## Topic Strategy

- `business`: mix broad business news, public-service explainers, and university/business-school research.
- `finance`: prioritize primary regulators and central banks, then accessible economic explainers.
- `tech_ai`: balance independent tech reporting, institutional AI research, corporate primary-source blogs, and cautious preprint trend signals.
- `law`: prioritize courts, regulators, and high-quality legal/digital-rights specialists.
- `medicine`: prioritize journals and public-health institutions; generation must avoid personal medical advice.
- `engineering`: combine applied engineering media, aerospace/agency sources, university research, and cautious preprint trend signals.
- `sport_business`: use specialist trade sources, because high-quality public RSS coverage is thinner than other topics.
- `culture_media`: combine media-industry reporting, journalism research, and entertainment business trades.

## Live RSS Behavior

`LIVE_RSS=false` is the default. When `LIVE_RSS=true`, the engine adds the RSS connector beside the safe sample/curated path. Each source is isolated:

- `rss_source_attempted` logs before a fetch.
- `rss_source_health` logs success or failure with duration, kept count, and skipped count.
- `rss_source_succeeded` logs item counts, kept/skipped counts, stale skips, invalid URL skips, and configured max age.
- `rss_source_failed` logs per-source failures after `Promise.allSettled`.
- `rss_connector_health` logs source-level rollups with attempted, succeeded, failed, article count, and sampled errors.
- `rss_items_skipped_stale` and `rss_items_skipped_before_since` explain recency-filter drops.

One broken feed should never crash the whole source run.

## Credibility Tiers

- `tier_1`: primary institutions, peer-reviewed journals, highly trusted public-service newsrooms, or specialist sources with strong editorial standards.
- `tier_2`: reputable specialist publishers, trade publications, or corporate/institutional blogs useful as primary source material.
- `tier_3`: narrower trade sources with useful signal but higher editorial or commercial bias risk.

Tier is not a truth label. It is an input to ranking and editorial review.

## Source Limitations

- RSS availability changes. Failed feeds are ignored by the connector so dry-run and scheduled jobs can continue.
- Live RSS is opt-in. Keep `LIVE_RSS=false` or unset for sample-only dry-runs. Use `LIVE_RSS=true` only when intentionally testing external feeds.
- RSS fetches are capped and timed out. Tune with `RSS_ARTICLES_PER_SOURCE`, `RSS_TIMEOUT_MS`, and `RSS_MAX_AGE_DAYS`.
- Stale RSS items are rejected by default. Use `RSS_ALLOW_STALE=true` only when diagnosing a source whose feed dates are known to lag.
- RSS summaries can be incomplete or promotional. Generation should cite sources conservatively and avoid unsupported claims.
- Some publishers permit RSS only for personal use. Keep those entries without `rssUrl` unless PersoNewsAP has permission.
- Institutional sources are often primary but self-interested. Use them for what an institution said or filed, not as independent analysis.
- Law, medicine, and finance sources need extra care: prefer primary documents and avoid personal legal, medical, or investment advice.
- Weak sources to replace later: sport business has fewer open, stable, high-quality feeds; preprint feeds in AI/engineering are trend inputs only; some EU/French institutional references remain paused until stable RSS endpoints are confirmed.

## Add Or Remove Sources

To add a source:

1. Add an entry to `CURATED_SOURCES` in `curatedSources.ts`.
2. Choose one approved `topic` from the product topic IDs.
3. Set `language`, `credibility_tier`, `credibility_score`, and `source_type`.
4. Set `region` when the source is jurisdiction-specific. The registry can infer common regions, but explicit is better for law, medicine, finance, and sport business.
5. Add `rssUrl` only when the feed is public and its terms allow the intended use.
6. Add `usage_notes` when licensing, paywall, or editorial caveats matter.
7. Run `npm run check` from `services/content-engine`.

To remove or pause a source:

1. Remove `rssUrl` first if the source should remain as a curated reference but not be ingested.
2. Remove the whole entry only when it is no longer useful or reputable.
3. Keep topic coverage balanced so one publisher cannot dominate a daily drop.
