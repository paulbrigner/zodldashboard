#!/usr/bin/env bash
set -euo pipefail

# On-demand AWS Cost Explorer report for ZodlDashboard/XMonitor tagged spend.
#
# Usage:
#   AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
#   ./scripts/aws/report_zodldashboard_costs.sh
#
# Optional env:
#   COST_TAG_KEY=Project
#   COST_TAG_VALUE=ZodlDashboard
#   START_DATE=2026-03-01      # inclusive, YYYY-MM-DD
#   END_DATE=2026-03-06         # exclusive, YYYY-MM-DD
#   TOP_N_SERVICES=15

AWS_PROFILE="${AWS_PROFILE:-zodldashboard}"
AWS_REGION="${AWS_REGION:-us-east-1}"
COST_TAG_KEY="${COST_TAG_KEY:-Project}"
COST_TAG_VALUE="${COST_TAG_VALUE:-ZodlDashboard}"
TOP_N_SERVICES="${TOP_N_SERVICES:-15}"

read -r START_DATE END_DATE <<<"$(
  python3 - <<'PY'
from datetime import datetime, timedelta, timezone
import os

start = os.environ.get("START_DATE", "").strip()
end = os.environ.get("END_DATE", "").strip()
today = datetime.now(timezone.utc).date()

if not start:
    start = (today - timedelta(days=30)).isoformat()
if not end:
    end = (today + timedelta(days=1)).isoformat()

print(start, end)
PY
)"

OUT_DIR="data/reports/aws-cost"
mkdir -p "$OUT_DIR"
STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
RAW_FILE="${OUT_DIR}/zodldashboard_cost_raw_${STAMP}.json"
SUMMARY_FILE="${OUT_DIR}/zodldashboard_cost_summary_${STAMP}.json"

echo "==> profile=${AWS_PROFILE} region=${AWS_REGION}"
echo "==> tag filter: ${COST_TAG_KEY}=${COST_TAG_VALUE}"
echo "==> time period: ${START_DATE} (inclusive) to ${END_DATE} (exclusive)"

FILTER_JSON=$(cat <<EOF
{"Tags":{"Key":"${COST_TAG_KEY}","Values":["${COST_TAG_VALUE}"],"MatchOptions":["EQUALS"]}}
EOF
)

aws --profile "$AWS_PROFILE" --region "$AWS_REGION" ce get-cost-and-usage \
  --time-period "Start=${START_DATE},End=${END_DATE}" \
  --granularity DAILY \
  --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --filter "$FILTER_JSON" \
  --output json >"$RAW_FILE"

python3 - <<'PY' "$RAW_FILE" "$SUMMARY_FILE" "$TOP_N_SERVICES" "$COST_TAG_KEY" "$COST_TAG_VALUE" "$START_DATE" "$END_DATE"
import json
import sys
from decimal import Decimal

raw_path, summary_path, top_n_raw, tag_key, tag_value, start_date, end_date = sys.argv[1:]
top_n = max(1, int(top_n_raw))

with open(raw_path, "r", encoding="utf-8") as fh:
    payload = json.load(fh)

service_totals = {}
daily_totals = []
currency = "USD"

for period in payload.get("ResultsByTime", []):
    day = period.get("TimePeriod", {}).get("Start")
    groups = period.get("Groups", [])
    day_total = Decimal("0")
    for group in groups:
        service = (group.get("Keys") or ["Unknown"])[0]
        amount_text = group.get("Metrics", {}).get("UnblendedCost", {}).get("Amount", "0")
        unit = group.get("Metrics", {}).get("UnblendedCost", {}).get("Unit", "USD")
        currency = unit or currency
        amount = Decimal(amount_text)
        day_total += amount
        service_totals[service] = service_totals.get(service, Decimal("0")) + amount
    daily_totals.append({"date": day, "cost": f"{day_total:.6f}", "currency": currency})

overall = sum(service_totals.values(), Decimal("0"))
top_services = sorted(service_totals.items(), key=lambda kv: kv[1], reverse=True)

summary = {
    "scope": {
        "tag_key": tag_key,
        "tag_value": tag_value,
        "start_date_inclusive": start_date,
        "end_date_exclusive": end_date,
        "currency": currency,
    },
    "overall_cost": f"{overall:.6f}",
    "services": [
        {"service": service, "cost": f"{cost:.6f}", "currency": currency}
        for service, cost in top_services
    ],
    "daily_totals": daily_totals,
}

with open(summary_path, "w", encoding="utf-8") as fh:
    json.dump(summary, fh, indent=2)

print()
print("ZodlDashboard AWS Cost Report")
print(f"Tag: {tag_key}={tag_value}")
print(f"Period: {start_date} to {end_date} (end exclusive)")
print(f"Total: {overall:.2f} {currency}")
print()
print(f"Top {top_n} services:")
for service, cost in top_services[:top_n]:
    print(f"- {service}: {cost:.2f} {currency}")
print()
print("Daily totals:")
for row in daily_totals:
    print(f"- {row['date']}: {Decimal(row['cost']):.2f} {currency}")
print()
print(f"Summary JSON: {summary_path}")
print(f"Raw CE JSON:  {raw_path}")
PY
