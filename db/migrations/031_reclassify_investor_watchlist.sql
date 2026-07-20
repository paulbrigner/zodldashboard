-- The active watchlist is owned by the collector configuration. The import-era
-- watch_accounts table is deliberately restricted from the runtime app role.
WITH reclassifications(handle, tier) AS (
  VALUES
    ('a16zcrypto', 'influencer'),
    ('akshat_hk', 'influencer'),
    ('balajis', 'influencer'),
    ('cbventures', 'influencer'),
    ('chapterone', 'influencer'),
    ('cryptohayes', 'influencer'),
    ('cypherpunk', 'ecosystem'),
    ('davidlee', 'influencer'),
    ('friedberg', 'influencer'),
    ('hosseeb', 'influencer'),
    ('jmj', 'influencer'),
    ('maelstromfund', 'influencer'),
    ('paradigm', 'influencer'),
    ('will_mcevoy', 'influencer'),
    ('winklevosscap', 'influencer')
)
UPDATE posts p
SET
  watch_tier = r.tier,
  updated_at = now()
FROM reclassifications r
WHERE lower(p.author_handle) = r.handle
  AND p.watch_tier IS DISTINCT FROM r.tier;

WITH reclassifications(handle, tier) AS (
  VALUES
    ('a16zcrypto', 'influencer'),
    ('akshat_hk', 'influencer'),
    ('balajis', 'influencer'),
    ('cbventures', 'influencer'),
    ('chapterone', 'influencer'),
    ('cryptohayes', 'influencer'),
    ('cypherpunk', 'ecosystem'),
    ('davidlee', 'influencer'),
    ('friedberg', 'influencer'),
    ('hosseeb', 'influencer'),
    ('jmj', 'influencer'),
    ('maelstromfund', 'influencer'),
    ('paradigm', 'influencer'),
    ('will_mcevoy', 'influencer'),
    ('winklevosscap', 'influencer')
)
UPDATE window_summaries ws
SET
  tier_counts_json = (
    SELECT jsonb_build_object(
      'teammate', COUNT(*) FILTER (WHERE p.watch_tier = 'teammate'),
      'investor', COUNT(*) FILTER (WHERE p.watch_tier = 'investor'),
      'influencer', COUNT(*) FILTER (WHERE p.watch_tier = 'influencer'),
      'ecosystem', COUNT(*) FILTER (WHERE p.watch_tier = 'ecosystem'),
      'other', COUNT(*) FILTER (WHERE p.watch_tier IS NULL)
    )
    FROM posts p
    WHERE p.discovered_at >= ws.window_start
      AND p.discovered_at <= ws.window_end
  ),
  notable_posts_json = (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN r.tier IS NOT NULL THEN jsonb_set(item, '{watch_tier}', to_jsonb(r.tier), true)
          ELSE item
        END
        ORDER BY ordinal
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(COALESCE(ws.notable_posts_json, '[]'::jsonb))
      WITH ORDINALITY AS notable(item, ordinal)
    LEFT JOIN reclassifications r
      ON lower(COALESCE(item->>'author_handle', '')) = r.handle
  ),
  updated_at = now()
WHERE EXISTS (
    SELECT 1
    FROM posts p
    JOIN reclassifications r ON lower(p.author_handle) = r.handle
    WHERE p.discovered_at >= ws.window_start
      AND p.discovered_at <= ws.window_end
  )
  OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(ws.notable_posts_json, '[]'::jsonb)) AS item
    JOIN reclassifications r ON lower(COALESCE(item->>'author_handle', '')) = r.handle
  );
