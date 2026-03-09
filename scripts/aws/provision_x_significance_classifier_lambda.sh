#!/usr/bin/env bash
set -euo pipefail

# Provision/update async significance classifier Lambda + EventBridge schedule.
#
# Usage:
#   AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
#   ./scripts/aws/provision_x_significance_classifier_lambda.sh
#
# Optional env:
#   LAMBDA_FUNCTION_NAME=xmonitor-x-significance-classifier
#   LAMBDA_ROLE_NAME=xmonitor-x-significance-classifier-role
#   EVENT_RULE_NAME=xmonitor-x-significance-classifier-5m
#   SCHEDULE_EXPRESSION='rate(5 minutes)'
#   SCHEDULE_ENABLED=true
#   DB_SECRET_ID=xmonitor/rds/app
#   SIGNIFICANCE_ENABLED=true
#   SIGNIFICANCE_INGEST_API_BASE_URL=https://www.zodldashboard.com/api/v1
#   SIGNIFICANCE_INGEST_API_KEY=...            # fallback from DB secret ingest_shared_secret
#   SIGNIFICANCE_INGEST_TIMEOUT_MS=20000
#   SIGNIFICANCE_LLM_URL=https://api.venice.ai/api/v1
#   SIGNIFICANCE_LLM_MODEL=google-gemma-3-27b-it
#   SIGNIFICANCE_LLM_API_KEY=...               # fallback from DB secret embedding_api_key/venice_api_key
#   SIGNIFICANCE_LLM_TEMPERATURE=0
#   SIGNIFICANCE_LLM_MAX_TOKENS=1400
#   SIGNIFICANCE_LLM_TIMEOUT_MS=120000
#   SIGNIFICANCE_LLM_MAX_ATTEMPTS=3
#   SIGNIFICANCE_LLM_INITIAL_BACKOFF_MS=1000
#   SIGNIFICANCE_BATCH_SIZE=4
#   SIGNIFICANCE_MAX_POSTS_PER_RUN=24
#   SIGNIFICANCE_MAX_ATTEMPTS=3
#   SIGNIFICANCE_LEASE_SECONDS=300
#   SIGNIFICANCE_VERSION=ai_v1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAMBDA_DIR="$ROOT_DIR/services/x-significance-classifier-lambda"

AWS_REGION="${AWS_REGION:-us-east-1}"
LAMBDA_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-xmonitor-x-significance-classifier}"
LAMBDA_ROLE_NAME="${LAMBDA_ROLE_NAME:-xmonitor-x-significance-classifier-role}"
EVENT_RULE_NAME="${EVENT_RULE_NAME:-xmonitor-x-significance-classifier-5m}"
SCHEDULE_EXPRESSION="${SCHEDULE_EXPRESSION:-rate(5 minutes)}"
SCHEDULE_ENABLED="${SCHEDULE_ENABLED:-true}"
DB_SECRET_ID="${DB_SECRET_ID:-xmonitor/rds/app}"

SIGNIFICANCE_ENABLED="${SIGNIFICANCE_ENABLED:-true}"
SIGNIFICANCE_INGEST_API_BASE_URL="${SIGNIFICANCE_INGEST_API_BASE_URL:-https://www.zodldashboard.com/api/v1}"
SIGNIFICANCE_INGEST_API_KEY="${SIGNIFICANCE_INGEST_API_KEY:-}"
SIGNIFICANCE_INGEST_TIMEOUT_MS="${SIGNIFICANCE_INGEST_TIMEOUT_MS:-20000}"
SIGNIFICANCE_LLM_URL="${SIGNIFICANCE_LLM_URL:-https://api.venice.ai/api/v1}"
SIGNIFICANCE_LLM_MODEL="${SIGNIFICANCE_LLM_MODEL:-google-gemma-3-27b-it}"
SIGNIFICANCE_LLM_API_KEY="${SIGNIFICANCE_LLM_API_KEY:-}"
SIGNIFICANCE_LLM_TEMPERATURE="${SIGNIFICANCE_LLM_TEMPERATURE:-0}"
SIGNIFICANCE_LLM_MAX_TOKENS="${SIGNIFICANCE_LLM_MAX_TOKENS:-1400}"
SIGNIFICANCE_LLM_TIMEOUT_MS="${SIGNIFICANCE_LLM_TIMEOUT_MS:-120000}"
SIGNIFICANCE_LLM_MAX_ATTEMPTS="${SIGNIFICANCE_LLM_MAX_ATTEMPTS:-3}"
SIGNIFICANCE_LLM_INITIAL_BACKOFF_MS="${SIGNIFICANCE_LLM_INITIAL_BACKOFF_MS:-1000}"
SIGNIFICANCE_BATCH_SIZE="${SIGNIFICANCE_BATCH_SIZE:-4}"
SIGNIFICANCE_MAX_POSTS_PER_RUN="${SIGNIFICANCE_MAX_POSTS_PER_RUN:-24}"
SIGNIFICANCE_MAX_ATTEMPTS="${SIGNIFICANCE_MAX_ATTEMPTS:-3}"
SIGNIFICANCE_LEASE_SECONDS="${SIGNIFICANCE_LEASE_SECONDS:-300}"
SIGNIFICANCE_VERSION="${SIGNIFICANCE_VERSION:-ai_v1}"

LAMBDA_TIMEOUT="${LAMBDA_TIMEOUT:-120}"
LAMBDA_MEMORY_MB="${LAMBDA_MEMORY_MB:-512}"

aws_cli() {
  AWS_REGION="$AWS_REGION" aws "$@"
}

is_truthy() {
  local normalized
  normalized="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$normalized" in
    1|true|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

echo "==> Resolving AWS account"
ACCOUNT_ID="$(aws_cli sts get-caller-identity --query 'Account' --output text)"

if [[ -z "$SIGNIFICANCE_INGEST_API_KEY" || -z "$SIGNIFICANCE_LLM_API_KEY" ]]; then
  echo "==> Reading fallback values from secret: $DB_SECRET_ID"
  DB_SECRET_JSON="$(aws_cli secretsmanager get-secret-value --secret-id "$DB_SECRET_ID" --query 'SecretString' --output text 2>/dev/null || true)"
  if [[ -n "$DB_SECRET_JSON" && "$DB_SECRET_JSON" != "None" ]]; then
    FIELDS="$(DB_SECRET_JSON="$DB_SECRET_JSON" python3 - <<'PY'
import json, os
payload = json.loads(os.environ['DB_SECRET_JSON'])
print(payload.get('ingest_shared_secret', payload.get('api_key', '')))
print(payload.get('embedding_api_key', payload.get('venice_api_key', '')))
PY
)"
    SECRET_INGEST_KEY="$(printf '%s\n' "$FIELDS" | sed -n '1p')"
    SECRET_LLM_KEY="$(printf '%s\n' "$FIELDS" | sed -n '2p')"
    if [[ -z "$SIGNIFICANCE_INGEST_API_KEY" ]]; then
      SIGNIFICANCE_INGEST_API_KEY="$SECRET_INGEST_KEY"
    fi
    if [[ -z "$SIGNIFICANCE_LLM_API_KEY" ]]; then
      SIGNIFICANCE_LLM_API_KEY="$SECRET_LLM_KEY"
    fi
  fi
fi

if [[ -z "$SIGNIFICANCE_INGEST_API_KEY" ]]; then
  echo "error: SIGNIFICANCE_INGEST_API_KEY is required (or set ingest_shared_secret in $DB_SECRET_ID)" >&2
  exit 1
fi
if [[ -z "$SIGNIFICANCE_LLM_API_KEY" ]]; then
  echo "error: SIGNIFICANCE_LLM_API_KEY is required (or set embedding_api_key/venice_api_key in $DB_SECRET_ID)" >&2
  exit 1
fi

echo "==> Ensuring IAM role: $LAMBDA_ROLE_NAME"
ROLE_ARN="$(aws_cli iam get-role --role-name "$LAMBDA_ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || true)"
if [[ -z "$ROLE_ARN" || "$ROLE_ARN" == "None" ]]; then
  TRUST_FILE="$(mktemp)"
  cat >"$TRUST_FILE" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON
  ROLE_ARN="$(aws_cli iam create-role \
    --role-name "$LAMBDA_ROLE_NAME" \
    --assume-role-policy-document "file://$TRUST_FILE" \
    --query 'Role.Arn' --output text)"
  rm -f "$TRUST_FILE"
fi

aws_cli iam attach-role-policy \
  --role-name "$LAMBDA_ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null

echo "Waiting for IAM propagation..."
sleep 8

echo "==> Packaging significance classifier Lambda"
pushd "$LAMBDA_DIR" >/dev/null
rm -f function.zip
zip -rq function.zip index.mjs
popd >/dev/null

ENV_JSON="$(
  SIGNIFICANCE_ENABLED="$SIGNIFICANCE_ENABLED" \
  SIGNIFICANCE_INGEST_API_BASE_URL="$SIGNIFICANCE_INGEST_API_BASE_URL" \
  SIGNIFICANCE_INGEST_API_KEY="$SIGNIFICANCE_INGEST_API_KEY" \
  SIGNIFICANCE_INGEST_TIMEOUT_MS="$SIGNIFICANCE_INGEST_TIMEOUT_MS" \
  SIGNIFICANCE_LLM_URL="$SIGNIFICANCE_LLM_URL" \
  SIGNIFICANCE_LLM_MODEL="$SIGNIFICANCE_LLM_MODEL" \
  SIGNIFICANCE_LLM_API_KEY="$SIGNIFICANCE_LLM_API_KEY" \
  SIGNIFICANCE_LLM_TEMPERATURE="$SIGNIFICANCE_LLM_TEMPERATURE" \
  SIGNIFICANCE_LLM_MAX_TOKENS="$SIGNIFICANCE_LLM_MAX_TOKENS" \
  SIGNIFICANCE_LLM_TIMEOUT_MS="$SIGNIFICANCE_LLM_TIMEOUT_MS" \
  SIGNIFICANCE_LLM_MAX_ATTEMPTS="$SIGNIFICANCE_LLM_MAX_ATTEMPTS" \
  SIGNIFICANCE_LLM_INITIAL_BACKOFF_MS="$SIGNIFICANCE_LLM_INITIAL_BACKOFF_MS" \
  SIGNIFICANCE_BATCH_SIZE="$SIGNIFICANCE_BATCH_SIZE" \
  SIGNIFICANCE_MAX_POSTS_PER_RUN="$SIGNIFICANCE_MAX_POSTS_PER_RUN" \
  SIGNIFICANCE_MAX_ATTEMPTS="$SIGNIFICANCE_MAX_ATTEMPTS" \
  SIGNIFICANCE_LEASE_SECONDS="$SIGNIFICANCE_LEASE_SECONDS" \
  SIGNIFICANCE_VERSION="$SIGNIFICANCE_VERSION" \
  python3 - <<'PY'
import json, os
print(json.dumps({
  "Variables": {
    "XMON_SIGNIFICANCE_ENABLED": os.environ["SIGNIFICANCE_ENABLED"],
    "XMON_SIGNIFICANCE_INGEST_API_BASE_URL": os.environ["SIGNIFICANCE_INGEST_API_BASE_URL"],
    "XMON_SIGNIFICANCE_INGEST_API_KEY": os.environ["SIGNIFICANCE_INGEST_API_KEY"],
    "XMON_SIGNIFICANCE_INGEST_TIMEOUT_MS": os.environ["SIGNIFICANCE_INGEST_TIMEOUT_MS"],
    "XMON_SIGNIFICANCE_LLM_URL": os.environ["SIGNIFICANCE_LLM_URL"],
    "XMON_SIGNIFICANCE_LLM_MODEL": os.environ["SIGNIFICANCE_LLM_MODEL"],
    "XMON_SIGNIFICANCE_LLM_API_KEY": os.environ["SIGNIFICANCE_LLM_API_KEY"],
    "XMON_SIGNIFICANCE_LLM_TEMPERATURE": os.environ["SIGNIFICANCE_LLM_TEMPERATURE"],
    "XMON_SIGNIFICANCE_LLM_MAX_TOKENS": os.environ["SIGNIFICANCE_LLM_MAX_TOKENS"],
    "XMON_SIGNIFICANCE_LLM_TIMEOUT_MS": os.environ["SIGNIFICANCE_LLM_TIMEOUT_MS"],
    "XMON_SIGNIFICANCE_LLM_MAX_ATTEMPTS": os.environ["SIGNIFICANCE_LLM_MAX_ATTEMPTS"],
    "XMON_SIGNIFICANCE_LLM_INITIAL_BACKOFF_MS": os.environ["SIGNIFICANCE_LLM_INITIAL_BACKOFF_MS"],
    "XMON_SIGNIFICANCE_BATCH_SIZE": os.environ["SIGNIFICANCE_BATCH_SIZE"],
    "XMON_SIGNIFICANCE_MAX_POSTS_PER_RUN": os.environ["SIGNIFICANCE_MAX_POSTS_PER_RUN"],
    "XMON_SIGNIFICANCE_MAX_ATTEMPTS": os.environ["SIGNIFICANCE_MAX_ATTEMPTS"],
    "XMON_SIGNIFICANCE_LEASE_SECONDS": os.environ["SIGNIFICANCE_LEASE_SECONDS"],
    "XMON_SIGNIFICANCE_VERSION": os.environ["SIGNIFICANCE_VERSION"],
  }
}))
PY
)"

echo "==> Creating/updating Lambda function: $LAMBDA_FUNCTION_NAME"
FUNCTION_ARN="$(aws_cli lambda get-function --function-name "$LAMBDA_FUNCTION_NAME" --query 'Configuration.FunctionArn' --output text 2>/dev/null || true)"
if [[ -z "$FUNCTION_ARN" || "$FUNCTION_ARN" == "None" ]]; then
  FUNCTION_ARN="$(aws_cli lambda create-function \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --runtime nodejs22.x \
    --handler index.handler \
    --role "$ROLE_ARN" \
    --zip-file "fileb://$LAMBDA_DIR/function.zip" \
    --timeout "$LAMBDA_TIMEOUT" \
    --memory-size "$LAMBDA_MEMORY_MB" \
    --environment "$ENV_JSON" \
    --query 'FunctionArn' \
    --output text)"
else
  aws_cli lambda update-function-code \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --zip-file "fileb://$LAMBDA_DIR/function.zip" >/dev/null

  aws_cli lambda wait function-updated --function-name "$LAMBDA_FUNCTION_NAME"

  aws_cli lambda update-function-configuration \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --runtime nodejs22.x \
    --handler index.handler \
    --role "$ROLE_ARN" \
    --timeout "$LAMBDA_TIMEOUT" \
    --memory-size "$LAMBDA_MEMORY_MB" \
    --environment "$ENV_JSON" >/dev/null
fi

aws_cli lambda wait function-active-v2 --function-name "$LAMBDA_FUNCTION_NAME"
FUNCTION_ARN="$(aws_cli lambda get-function --function-name "$LAMBDA_FUNCTION_NAME" --query 'Configuration.FunctionArn' --output text)"

echo "==> Creating/updating EventBridge rule: $EVENT_RULE_NAME"
if is_truthy "$SCHEDULE_ENABLED"; then
  RULE_STATE="ENABLED"
else
  RULE_STATE="DISABLED"
fi

aws_cli events put-rule \
  --name "$EVENT_RULE_NAME" \
  --schedule-expression "$SCHEDULE_EXPRESSION" \
  --state "$RULE_STATE" >/dev/null

TARGETS_FILE="$(mktemp)"
cat >"$TARGETS_FILE" <<JSON
[
  {
    "Id": "1",
    "Arn": "$FUNCTION_ARN",
    "Input": "{\"source\":\"eventbridge\"}"
  }
]
JSON
aws_cli events put-targets \
  --rule "$EVENT_RULE_NAME" \
  --targets "file://$TARGETS_FILE" >/dev/null
rm -f "$TARGETS_FILE"

echo "==> Granting EventBridge invoke permission on Lambda"
SOURCE_ARN="arn:aws:events:$AWS_REGION:$ACCOUNT_ID:rule/$EVENT_RULE_NAME"
if ! aws_cli lambda add-permission \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --statement-id "events-invoke-$EVENT_RULE_NAME" \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "$SOURCE_ARN" >/dev/null 2>&1; then
  echo "Lambda invoke permission already exists (or could not be added). Continuing."
fi

echo ""
echo "Provisioning complete:"
echo "  Classifier Lambda: $LAMBDA_FUNCTION_NAME"
echo "  Function ARN:      $FUNCTION_ARN"
echo "  Event rule:        $EVENT_RULE_NAME"
echo "  Schedule:          $SCHEDULE_EXPRESSION"
echo "  Rule state:        $RULE_STATE"
echo ""
echo "Manual invoke test:"
echo "  aws --region $AWS_REGION lambda invoke --function-name $LAMBDA_FUNCTION_NAME --payload '{\"max_posts_per_run\":8}' /tmp/xmon_significance_classifier_test.json && cat /tmp/xmon_significance_classifier_test.json"
