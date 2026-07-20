UPDATE window_summaries
SET
  summary_text = replace(
    summary_text,
    'Electric Coin Company’s ebfull, Zooko, and others stressed',
    '@ebfull of Project Tachyon, Zooko, and others stressed'
  ),
  updated_at = now()
WHERE summary_key = 'rolling_7d_daily:2026-07-13T10:00:00.000+00:00:2026-07-20T10:00:00.000+00:00'
  AND summary_text LIKE '%Electric Coin Company’s ebfull, Zooko, and others stressed%';
