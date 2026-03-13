UPDATE posts
SET
  watch_tier = 'influencer',
  updated_at = now()
WHERE lower(author_handle) IN ('cipherscan_app', 'cipherpay_app')
  AND watch_tier IS DISTINCT FROM 'influencer';

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
          WHEN lower(COALESCE(item->>'author_handle', '')) IN ('cipherscan_app', 'cipherpay_app') THEN
            jsonb_set(item, '{watch_tier}', to_jsonb('influencer'::text), true)
          ELSE item
        END
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(COALESCE(ws.notable_posts_json, '[]'::jsonb)) AS item
  ),
  updated_at = now()
WHERE EXISTS (
    SELECT 1
    FROM posts p
    WHERE lower(p.author_handle) IN ('cipherscan_app', 'cipherpay_app')
      AND p.discovered_at >= ws.window_start
      AND p.discovered_at <= ws.window_end
  )
  OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(ws.notable_posts_json, '[]'::jsonb)) AS item
    WHERE lower(COALESCE(item->>'author_handle', '')) IN ('cipherscan_app', 'cipherpay_app')
  );
