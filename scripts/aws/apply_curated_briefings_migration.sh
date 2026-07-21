#!/usr/bin/env bash
set -euo pipefail

# Apply only migration 034 through the already-deployed VPC API Lambda, then
# restore its complete environment map even when invocation fails.
# Run the code-only deployment first so the packaged migration exists.

AWS_REGION="${AWS_REGION:-us-east-1}"
API_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-xmonitor-vpc-api}"
MIGRATION_FILE="034_curated_topic_briefings.sql"

aws_cli() {
  AWS_REGION="$AWS_REGION" aws "$@"
}

WORK_DIR="$(mktemp -d)"
ORIGINAL_ENV_FILE="$WORK_DIR/original-environment.json"
MIGRATION_ENV_FILE="$WORK_DIR/migration-environment.json"
INVOKE_RESPONSE_FILE="$WORK_DIR/invoke-response.json"
RESTORE_REQUIRED="false"

restore_api_environment() {
  if [[ "$RESTORE_REQUIRED" != "true" ]]; then
    return 0
  fi
  echo "==> Restoring the complete API Lambda environment"
  aws_cli lambda update-function-configuration \
    --function-name "$API_FUNCTION_NAME" \
    --environment "file://$ORIGINAL_ENV_FILE" >/dev/null
  aws_cli lambda wait function-updated --function-name "$API_FUNCTION_NAME"
  RESTORE_REQUIRED="false"
}

cleanup() {
  local exit_code=$?
  set +e
  restore_api_environment
  local restore_code=$?
  rm -rf "$WORK_DIR"
  if [[ $restore_code -ne 0 ]]; then
    echo "error: failed to restore the API Lambda environment; use the saved AWS configuration history immediately" >&2
    exit "$restore_code"
  fi
  exit "$exit_code"
}
trap cleanup EXIT

echo "==> Capturing the complete API Lambda environment"
aws_cli lambda get-function-configuration \
  --function-name "$API_FUNCTION_NAME" \
  --query Environment \
  --output json >"$ORIGINAL_ENV_FILE"
chmod 600 "$ORIGINAL_ENV_FILE"

ORIGINAL_ENV_FILE="$ORIGINAL_ENV_FILE" MIGRATION_ENV_FILE="$MIGRATION_ENV_FILE" MIGRATION_FILE="$MIGRATION_FILE" python3 - <<'PY'
import json
import os

with open(os.environ["ORIGINAL_ENV_FILE"], encoding="utf-8") as handle:
    environment = json.load(handle)
variables = dict(environment.get("Variables") or {})
variables["XMONITOR_BRIEFINGS_ENABLED"] = "false"
variables["XMONITOR_ENABLE_DB_MIGRATIONS_BOOTSTRAP"] = "true"
variables["XMONITOR_DB_MIGRATIONS_FROM_FILE"] = os.environ["MIGRATION_FILE"]
with open(os.environ["MIGRATION_ENV_FILE"], "w", encoding="utf-8") as handle:
    json.dump({"Variables": variables}, handle)
PY
chmod 600 "$MIGRATION_ENV_FILE"

echo "==> Temporarily enabling the one-shot migration bootstrap"
aws_cli lambda update-function-configuration \
  --function-name "$API_FUNCTION_NAME" \
  --environment "file://$MIGRATION_ENV_FILE" >/dev/null
RESTORE_REQUIRED="true"
aws_cli lambda wait function-updated --function-name "$API_FUNCTION_NAME"

echo "==> Invoking health route to apply $MIGRATION_FILE"
aws_cli lambda invoke \
  --function-name "$API_FUNCTION_NAME" \
  --cli-binary-format raw-in-base64-out \
  --payload '{"rawPath":"/v1/health","requestContext":{"http":{"method":"GET"}}}' \
  "$INVOKE_RESPONSE_FILE" >/dev/null

INVOKE_RESPONSE_FILE="$INVOKE_RESPONSE_FILE" python3 - <<'PY'
import json
import os

with open(os.environ["INVOKE_RESPONSE_FILE"], encoding="utf-8") as handle:
    response = json.load(handle)
if response.get("statusCode") != 200:
    raise SystemExit(f"migration invocation failed with status {response.get('statusCode')}")
body = json.loads(response.get("body") or "{}")
if body.get("ok") is not True:
    raise SystemExit("migration health response was not ok")
PY

restore_api_environment
echo "Migration applied and the original API Lambda environment restored."
