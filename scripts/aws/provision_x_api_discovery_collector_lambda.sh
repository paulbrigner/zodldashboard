#!/usr/bin/env bash
set -euo pipefail

# Provision/update discovery-mode X API collector Lambda + EventBridge schedule.
#
# Defaults are tuned for continuous discovery ingestion (no shadow mode).
# Override any value by exporting env vars before invoking this script.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AWS_REGION="${AWS_REGION:-us-east-1}"

export LAMBDA_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-xmonitor-xapi-discovery-collector}"
export LAMBDA_ROLE_NAME="${LAMBDA_ROLE_NAME:-xmonitor-xapi-discovery-collector-role}"
export EVENT_RULE_NAME="${EVENT_RULE_NAME:-xmonitor-xapi-discovery-collector-30m}"
export SCHEDULE_EXPRESSION="${SCHEDULE_EXPRESSION:-rate(30 minutes)}"
export COLLECTOR_MODE="${COLLECTOR_MODE:-discovery}"
export COLLECTOR_SOURCE="${COLLECTOR_SOURCE:-aws-lambda-x-api-discovery}"
export X_API_REPLY_CAPTURE_ENABLED="${X_API_REPLY_CAPTURE_ENABLED:-false}"
export LEGACY_EVENT_RULE_NAME="${LEGACY_EVENT_RULE_NAME:-xmonitor-xapi-discovery-collector-60m}"
export WEEKLY_SUMMARY_SCHEDULE_NAME="${WEEKLY_SUMMARY_SCHEDULE_NAME:-xmonitor-xapi-weekly-summary-6am-et}"
export WEEKLY_SUMMARY_ROLE_NAME="${WEEKLY_SUMMARY_ROLE_NAME:-xmonitor-xapi-weekly-summary-scheduler-role}"
export WEEKLY_SUMMARY_CRON="${WEEKLY_SUMMARY_CRON:-cron(0 6 * * ? *)}"
export WEEKLY_SUMMARY_TIMEZONE="${WEEKLY_SUMMARY_TIMEZONE:-America/New_York}"
export WEEKLY_SUMMARY_ENABLED="${WEEKLY_SUMMARY_ENABLED:-true}"

"$ROOT_DIR/scripts/aws/provision_x_api_collector_lambda.sh"

FUNCTION_ARN="$(aws --region "$AWS_REGION" lambda get-function --function-name "$LAMBDA_FUNCTION_NAME" --query 'Configuration.FunctionArn' --output text)"

ROLE_ARN="$(aws --region "$AWS_REGION" iam get-role --role-name "$WEEKLY_SUMMARY_ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || true)"
if [[ -z "$ROLE_ARN" || "$ROLE_ARN" == "None" ]]; then
  TRUST_FILE="$(mktemp)"
  cat >"$TRUST_FILE" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "scheduler.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON
  ROLE_ARN="$(aws --region "$AWS_REGION" iam create-role \
    --role-name "$WEEKLY_SUMMARY_ROLE_NAME" \
    --assume-role-policy-document "file://$TRUST_FILE" \
    --query 'Role.Arn' \
    --output text)"
  rm -f "$TRUST_FILE"
fi

POLICY_FILE="$(mktemp)"
cat >"$POLICY_FILE" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "$FUNCTION_ARN"
    }
  ]
}
JSON
aws --region "$AWS_REGION" iam put-role-policy \
  --role-name "$WEEKLY_SUMMARY_ROLE_NAME" \
  --policy-name "${WEEKLY_SUMMARY_ROLE_NAME}-invoke" \
  --policy-document "file://$POLICY_FILE" >/dev/null
rm -f "$POLICY_FILE"
sleep 5

TARGET_JSON="$(
  FUNCTION_ARN="$FUNCTION_ARN" ROLE_ARN="$ROLE_ARN" python3 - <<'PY'
import json
import os

print(json.dumps({
    "Arn": os.environ["FUNCTION_ARN"],
    "RoleArn": os.environ["ROLE_ARN"],
    "Input": json.dumps({
        "source": "scheduler",
        "mode": "discovery",
        "summary_only": True,
        "forceWindowSummaries": True,
        "summary_window_types": ["rolling_7d_daily"],
    }),
}))
PY
)"

WEEKLY_SUMMARY_ENABLED_NORMALIZED="$(printf '%s' "$WEEKLY_SUMMARY_ENABLED" | tr '[:upper:]' '[:lower:]')"
if [[ "$WEEKLY_SUMMARY_ENABLED_NORMALIZED" == "true" || "$WEEKLY_SUMMARY_ENABLED_NORMALIZED" == "1" || "$WEEKLY_SUMMARY_ENABLED_NORMALIZED" == "yes" || "$WEEKLY_SUMMARY_ENABLED_NORMALIZED" == "on" ]]; then
  WEEKLY_SUMMARY_STATE="ENABLED"
else
  WEEKLY_SUMMARY_STATE="DISABLED"
fi

if aws --region "$AWS_REGION" scheduler get-schedule --name "$WEEKLY_SUMMARY_SCHEDULE_NAME" >/dev/null 2>&1; then
  echo "==> Updating weekly summary schedule: $WEEKLY_SUMMARY_SCHEDULE_NAME"
  aws --region "$AWS_REGION" scheduler update-schedule \
    --name "$WEEKLY_SUMMARY_SCHEDULE_NAME" \
    --schedule-expression "$WEEKLY_SUMMARY_CRON" \
    --schedule-expression-timezone "$WEEKLY_SUMMARY_TIMEZONE" \
    --flexible-time-window '{"Mode":"OFF"}' \
    --target "$TARGET_JSON" \
    --state "$WEEKLY_SUMMARY_STATE" >/dev/null
else
  echo "==> Creating weekly summary schedule: $WEEKLY_SUMMARY_SCHEDULE_NAME"
  aws --region "$AWS_REGION" scheduler create-schedule \
    --name "$WEEKLY_SUMMARY_SCHEDULE_NAME" \
    --schedule-expression "$WEEKLY_SUMMARY_CRON" \
    --schedule-expression-timezone "$WEEKLY_SUMMARY_TIMEZONE" \
    --flexible-time-window '{"Mode":"OFF"}' \
    --target "$TARGET_JSON" \
    --state "$WEEKLY_SUMMARY_STATE" >/dev/null
fi

if [[ "$LEGACY_EVENT_RULE_NAME" != "$EVENT_RULE_NAME" ]]; then
  if aws --region "$AWS_REGION" events describe-rule --name "$LEGACY_EVENT_RULE_NAME" >/dev/null 2>&1; then
    echo "==> Disabling legacy EventBridge rule: $LEGACY_EVENT_RULE_NAME"
    aws --region "$AWS_REGION" events disable-rule --name "$LEGACY_EVENT_RULE_NAME" >/dev/null
    aws --region "$AWS_REGION" events remove-targets --rule "$LEGACY_EVENT_RULE_NAME" --ids 1 >/dev/null 2>&1 || true
  fi
fi
