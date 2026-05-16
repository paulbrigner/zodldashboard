# X Monitor Executive Graphics Runbook

This runbook describes how to regenerate the executive PNG graphics produced by
`scripts/ops/render_xmonitor_graphics.py`.

The script produces two graphics by default:

- `ZODL Team X Traction ... .png`: 7-day ZODL team traction, including team totals, top posts, handle leaderboard, engagement mix, and daily momentum.
- `X Monitor 90D Activity Trend with ZEC Price ... .png`: 90-day X Monitor activity trend with a ZEC-USD price overlay.

By default, output files are written to `~/Downloads`.

## Prerequisites

Run commands from the repository root:

```bash
cd "/Users/paulbrigner/Library/Mobile Documents/com~apple~CloudDocs/Dev/zodldashboard"
```

Required local tools:

- Python 3.10+
- Pillow for PNG rendering
- AWS CLI configured with the `zodldashboard` profile if live X metrics should be refreshed from the X API token stored in Secrets Manager
- Network access to `https://www.zodldashboard.com/api/v1` and Yahoo Finance price data

If Pillow is missing:

```bash
python3 -m pip install pillow
```

## Recommended Command

Generate both graphics with live X public metrics:

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
python3 scripts/ops/render_xmonitor_graphics.py
```

The script prints a JSON summary containing the output paths and basic counts.

## Lower-Cost Command

Generate both graphics without calling the X API:

```bash
python3 scripts/ops/render_xmonitor_graphics.py --skip-live-metrics
```

This uses the latest metrics already stored in X Monitor. It is useful for draft
runs, layout checks, or quick internal refreshes. The tradeoff is that post
engagement totals may lag current public X metrics.

## Single-Graphic Runs

Team traction only:

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
python3 scripts/ops/render_xmonitor_graphics.py --team-only
```

90-day activity trend only:

```bash
python3 scripts/ops/render_xmonitor_graphics.py --trend-only
```

The trend graphic does not require the X API. It pulls X Monitor trend data and
ZEC-USD daily prices.

## Useful Options

Set an explicit output directory:

```bash
python3 scripts/ops/render_xmonitor_graphics.py --out-dir ~/Downloads
```

Use explicit output file paths:

```bash
python3 scripts/ops/render_xmonitor_graphics.py \
  --team-output ~/Downloads/zodl-team-x-traction.png \
  --trend-output ~/Downloads/xmonitor-90d-zec-overlay.png
```

Anchor the reporting window to a specific time:

```bash
python3 scripts/ops/render_xmonitor_graphics.py --now 2026-05-15T18:55:00Z
```

Override the team handle list for a one-off run:

```bash
python3 scripts/ops/render_xmonitor_graphics.py \
  --team-handles "bostonzcash,jswihart,paulbrigner,zodl_app,zodl_co"
```

Fail if live X metric refresh cannot complete:

```bash
AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
python3 scripts/ops/render_xmonitor_graphics.py --strict-live-metrics
```

## Data Sources

The team traction graphic uses:

- X Monitor feed API: `GET /api/v1/feed`
- X API post lookup: `GET /2/tweets`, unless `--skip-live-metrics` is passed
- X API bearer token from `XMON_X_API_BEARER_TOKEN`, `X_API_BEARER_TOKEN`, or AWS Secrets Manager secret `xmonitor/rds/app`

The 90-day trend graphic uses:

- X Monitor trends API: `GET /api/v1/trends?trend_range=90d`
- Yahoo Finance chart data for `ZEC-USD`

## X API Cost Estimate

The team graphic batches post IDs into lookup calls of up to 100 IDs, but X bills
read operations per post returned, not per HTTP request.

Current public X API pricing lists `Posts: Read` at `$0.005` per resource. The
rough cost for the live-metrics refresh is therefore:

```text
unique team posts refreshed * $0.005
```

Example: the May 15, 2026 article-refresh graphic contained 133 team posts, so
the upper-bound cost for the live metric refresh was approximately:

```text
133 * $0.005 = $0.665
```

X also documents daily resource deduplication. If the same posts were already
returned by the collector or another lookup during the same UTC day, the
incremental cost may be lower.

The 90-day trend graphic should add no X API cost because it does not call the X
API.

## Post-Run Checks

After the script finishes:

1. Confirm the JSON summary lists both expected output paths.
2. Open the PNG files from `~/Downloads`.
3. Check the team graphic subtitle for the reporting date, post count, and live-metric refresh time.
4. Check the trend graphic for the ZEC price overlay and post-count scale.

If the team graphic says live metrics were refreshed but totals look stale, rerun
with `--strict-live-metrics` so token or X API failures fail loudly.

