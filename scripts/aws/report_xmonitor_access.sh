#!/usr/bin/env bash
set -euo pipefail

# Generate a DB-backed report of X Monitor page accesses.
#
# This script invokes the existing xmonitor-vpc-api Lambda, which queries the
# xmonitor_access_events table from inside the deployed AWS environment. It does
# not read Amplify access logs or CloudWatch logs.

AWS_PROFILE="${AWS_PROFILE-zodldashboard}"
AWS_REGION="${AWS_REGION:-us-east-1}"
LAMBDA_FUNCTION_NAME="${XMONITOR_REPORT_LAMBDA_FUNCTION_NAME:-xmonitor-vpc-api}"
XMONITOR_PATH="${XMONITOR_PATH:-/x-monitor}"
DAYS="7"
START_TIME=""
END_TIME=""
LIMIT="50"
OUTPUT_FORMAT="text"
INCLUDE_NETWORK="false"

usage() {
  cat <<'EOF'
Usage:
  scripts/aws/report_xmonitor_access.sh [options]

Options:
  --days N              Look back N days from end time. Default: 7.
  --start-time ISO      Inclusive UTC start time, e.g. 2026-05-13T00:00:00Z.
  --end-time ISO        Exclusive UTC end time. Default: now.
  --path PATH           Route path to report. Default: /x-monitor.
  --limit N             Number of recent access rows to print. Default: 50.
  --include-network     Include client IP, referrer, and user agent in recent rows.
  --json                Print machine-readable JSON instead of text.
  --lambda-function FN  Lambda function to invoke. Default: xmonitor-vpc-api.
  --profile NAME        AWS CLI profile. Default: zodldashboard.
  --no-profile          Do not pass --profile; use the AWS CLI default credential chain.
  --region REGION       AWS region. Default: us-east-1.
  -h, --help            Show this help.

Environment overrides:
  AWS_PROFILE, AWS_REGION, XMONITOR_REPORT_LAMBDA_FUNCTION_NAME, XMONITOR_PATH

Dependencies:
  AWS CLI v2, python3

Required AWS permission:
  lambda:InvokeFunction on the xmonitor-vpc-api Lambda.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --days)
      DAYS="${2:?--days requires a value}"
      shift 2
      ;;
    --start-time)
      START_TIME="${2:?--start-time requires a value}"
      shift 2
      ;;
    --end-time)
      END_TIME="${2:?--end-time requires a value}"
      shift 2
      ;;
    --path)
      XMONITOR_PATH="${2:?--path requires a value}"
      shift 2
      ;;
    --limit)
      LIMIT="${2:?--limit requires a value}"
      shift 2
      ;;
    --include-network)
      INCLUDE_NETWORK="true"
      shift
      ;;
    --json)
      OUTPUT_FORMAT="json"
      shift
      ;;
    --lambda-function)
      LAMBDA_FUNCTION_NAME="${2:?--lambda-function requires a value}"
      shift 2
      ;;
    --profile)
      AWS_PROFILE="${2:?--profile requires a value}"
      shift 2
      ;;
    --no-profile)
      AWS_PROFILE=""
      shift
      ;;
    --region)
      AWS_REGION="${2:?--region requires a value}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

command -v aws >/dev/null 2>&1 || { echo "aws CLI is required" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 1; }

AWS_ARGS=(--region "$AWS_REGION")
if [[ -n "$AWS_PROFILE" ]]; then
  AWS_ARGS+=(--profile "$AWS_PROFILE")
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

PAYLOAD_FILE="$TMP_DIR/payload.json"
RESPONSE_FILE="$TMP_DIR/response.json"
REPORT_FILE="$TMP_DIR/report.json"

python3 - "$PAYLOAD_FILE" "$DAYS" "$START_TIME" "$END_TIME" "$XMONITOR_PATH" "$LIMIT" "$INCLUDE_NETWORK" <<'PY'
import json
import sys

output_path, days, start_time, end_time, path, limit, include_network = sys.argv[1:8]
body = {
    "days": int(days),
    "path": path,
    "limit": int(limit),
    "include_network": include_network == "true",
}
if start_time:
    body["start_time"] = start_time
if end_time:
    body["end_time"] = end_time

payload = {
    "source": "zodldashboard.xmonitor.report",
    "requestContext": {
        "http": {
            "method": "POST",
            "path": "/v1/x-monitor/access-report",
        }
    },
    "rawPath": "/v1/x-monitor/access-report",
    "body": json.dumps(body),
    "isBase64Encoded": False,
}

with open(output_path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh)
PY

aws "${AWS_ARGS[@]}" lambda invoke \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --cli-binary-format raw-in-base64-out \
  --payload "file://$PAYLOAD_FILE" \
  "$RESPONSE_FILE" >/dev/null

python3 - "$RESPONSE_FILE" "$REPORT_FILE" <<'PY'
import json
import sys

response_path, report_path = sys.argv[1:3]
with open(response_path, encoding="utf-8") as fh:
    response = json.load(fh)

status_code = int(response.get("statusCode", 200))
if "errorType" in response:
    message = response.get("errorMessage") or response.get("errorType") or response
    raise SystemExit(f"Lambda report request failed: {message}")

body_raw = response.get("body", "{}")
try:
    body = json.loads(body_raw) if isinstance(body_raw, str) else body_raw
except json.JSONDecodeError:
    body = {"raw_body": body_raw}

if status_code >= 400:
    message = body.get("error") or body.get("message") or body_raw
    raise SystemExit(f"Lambda report request failed ({status_code}): {message}")

report = body.get("report", body)
if not isinstance(report, dict) or "summary" not in report:
    raise SystemExit(f"Lambda report response did not include a report: {body}")

with open(report_path, "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=2, sort_keys=True)
PY

if [[ "$OUTPUT_FORMAT" == "json" ]]; then
  cat "$REPORT_FILE"
  printf '\n'
  exit 0
fi

python3 - "$REPORT_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    report = json.load(fh)

summary = report["summary"]
source = report["source"]
window = report["window"]

print("X Monitor DB Access Report")
print("==========================")
print(f"Window: {window['start']} to {window['end']}")
print(f"Table: {source['table']}")
print(f"Path: {source['path']}")
print("")
print("Summary")
print("-------")
print(f"Accesses: {summary['accesses']}")
print(f"Unique users: {summary['unique_users']}")
print(f"First seen: {summary['first_seen'] or '-'}")
print(f"Last seen: {summary['last_seen'] or '-'}")

def print_rows(label, rows, key):
    print("")
    print(label)
    if not rows:
        print("  -")
        return
    for row in rows:
        value = str(row.get(key) or row.get("value") or "unknown")
        print(f"{row['count']:>5}  {value:<34} {row['last_seen']}")

print_rows("By email:", report["by_email"], "email")

recent = report["recent_accesses"]
print("")
print(f"Recent accesses (latest {len(recent)})")
print("--------------------------------")
if not recent:
    print("  -")
else:
    include_network = report.get("options", {}).get("include_network", False)
    for item in recent:
        print(f"{item['accessed_at']}  {item['email']}")
        if include_network:
            print(f"       ip={item.get('client_ip') or '-'} referer={item.get('referer') or '-'}")
            print(f"       ua={item.get('user_agent') or '-'}")
PY
