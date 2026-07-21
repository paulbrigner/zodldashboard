#!/usr/bin/env bash
set -euo pipefail

# Apply only migration 034 from a one-shot Lambda that clones the deployed API
# runtime, role, code, and VPC placement. The temporary function is never
# connected to API Gateway or an event source, so privileged migration
# credentials are not placed on a publicly reachable production function.
#
# Run the code-only deployment first so the deployed package contains migration
# 034. The one-shot function and all local secret-bearing files are removed by
# the EXIT trap whether the migration succeeds or fails.

AWS_REGION="${AWS_REGION:-us-east-1}"
SOURCE_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-xmonitor-vpc-api}"
MIGRATION_SECRET_ID="${XMONITOR_MIGRATION_SECRET_ID:-xmonitor/rds/master}"
MIGRATION_FILE="034_curated_topic_briefings.sql"
TEMP_FUNCTION_NAME="xmonitor-curated-briefing-migrate-$(date -u +%Y%m%d%H%M%S)-$$"

aws_cli() {
  AWS_REGION="$AWS_REGION" aws "$@"
}

WORK_DIR="$(mktemp -d)"
SOURCE_CONFIG_FILE="$WORK_DIR/source-function.json"
MASTER_SECRET_FILE="$WORK_DIR/master-secret.json"
CREATE_INPUT_FILE="$WORK_DIR/create-function.json"
FUNCTION_ZIP="$WORK_DIR/function.zip"
INVOKE_METADATA_FILE="$WORK_DIR/invoke-metadata.json"
INVOKE_RESPONSE_FILE="$WORK_DIR/invoke-response.json"
TEMP_FUNCTION_CREATED="false"

cleanup() {
  local exit_code=$?
  set +e
  if [[ "$TEMP_FUNCTION_CREATED" == "true" ]]; then
    echo "==> Deleting one-shot migration Lambda"
    aws_cli lambda delete-function --function-name "$TEMP_FUNCTION_NAME" >/dev/null
  fi
  rm -rf "$WORK_DIR"
  exit "$exit_code"
}
trap cleanup EXIT

chmod 700 "$WORK_DIR"

echo "==> Capturing the deployed API Lambda runtime and code"
aws_cli lambda get-function-configuration \
  --function-name "$SOURCE_FUNCTION_NAME" \
  --output json >"$SOURCE_CONFIG_FILE"
chmod 600 "$SOURCE_CONFIG_FILE"

CODE_LOCATION="$(aws_cli lambda get-function \
  --function-name "$SOURCE_FUNCTION_NAME" \
  --query 'Code.Location' \
  --output text)"
curl --fail --silent --show-error "$CODE_LOCATION" --output "$FUNCTION_ZIP"
chmod 600 "$FUNCTION_ZIP"

echo "==> Loading the database migration credential"
aws_cli secretsmanager get-secret-value \
  --secret-id "$MIGRATION_SECRET_ID" \
  --query SecretString \
  --output text >"$MASTER_SECRET_FILE"
chmod 600 "$MASTER_SECRET_FILE"

SOURCE_CONFIG_FILE="$SOURCE_CONFIG_FILE" \
MASTER_SECRET_FILE="$MASTER_SECRET_FILE" \
CREATE_INPUT_FILE="$CREATE_INPUT_FILE" \
TEMP_FUNCTION_NAME="$TEMP_FUNCTION_NAME" \
MIGRATION_FILE="$MIGRATION_FILE" \
python3 - <<'PY'
import json
import os

with open(os.environ["SOURCE_CONFIG_FILE"], encoding="utf-8") as handle:
    source = json.load(handle)
with open(os.environ["MASTER_SECRET_FILE"], encoding="utf-8") as handle:
    secret = json.load(handle)

required_secret_fields = ("host", "port", "dbname", "username", "password")
missing = [field for field in required_secret_fields if not secret.get(field)]
if missing:
    raise SystemExit(f"migration secret is missing required fields: {', '.join(missing)}")

vpc = source.get("VpcConfig") or {}
create_input = {
    "FunctionName": os.environ["TEMP_FUNCTION_NAME"],
    "Runtime": source["Runtime"],
    "Role": source["Role"],
    "Handler": "index.handler",
    "Description": "One-shot curated briefing database migration",
    "Timeout": max(int(source.get("Timeout") or 30), 30),
    "MemorySize": int(source.get("MemorySize") or 512),
    "Publish": False,
    "PackageType": "Zip",
    "Environment": {
        "Variables": {
            "PGHOST": str(secret["host"]),
            "PGPORT": str(secret["port"]),
            "PGDATABASE": str(secret["dbname"]),
            "PGUSER": str(secret["username"]),
            "PGPASSWORD": str(secret["password"]),
            "PGSSLMODE": "require",
            "XMONITOR_BRIEFINGS_ENABLED": "false",
            "XMONITOR_ENABLE_DB_MIGRATIONS_BOOTSTRAP": "true",
            "XMONITOR_DB_MIGRATIONS_FROM_FILE": os.environ["MIGRATION_FILE"],
        }
    },
    "VpcConfig": {
        "SubnetIds": list(vpc.get("SubnetIds") or []),
        "SecurityGroupIds": list(vpc.get("SecurityGroupIds") or []),
        "Ipv6AllowedForDualStack": bool(vpc.get("Ipv6AllowedForDualStack", False)),
    },
    "Architectures": list(source.get("Architectures") or ["x86_64"]),
}

if source.get("EphemeralStorage"):
    create_input["EphemeralStorage"] = source["EphemeralStorage"]
if source.get("TracingConfig"):
    create_input["TracingConfig"] = source["TracingConfig"]
if source.get("LoggingConfig"):
    create_input["LoggingConfig"] = source["LoggingConfig"]
if source.get("KMSKeyArn"):
    create_input["KMSKeyArn"] = source["KMSKeyArn"]
if source.get("Layers"):
    create_input["Layers"] = [layer["Arn"] for layer in source["Layers"]]

with open(os.environ["CREATE_INPUT_FILE"], "w", encoding="utf-8") as handle:
    json.dump(create_input, handle)
PY
chmod 600 "$CREATE_INPUT_FILE"

echo "==> Creating isolated one-shot migration Lambda"
aws_cli lambda create-function \
  --cli-input-json "file://$CREATE_INPUT_FILE" \
  --zip-file "fileb://$FUNCTION_ZIP" >/dev/null
TEMP_FUNCTION_CREATED="true"
aws_cli lambda wait function-active-v2 --function-name "$TEMP_FUNCTION_NAME"

echo "==> Applying $MIGRATION_FILE"
aws_cli lambda invoke \
  --function-name "$TEMP_FUNCTION_NAME" \
  --cli-binary-format raw-in-base64-out \
  --payload '{"rawPath":"/v1/health","requestContext":{"http":{"method":"GET"}}}' \
  "$INVOKE_RESPONSE_FILE" >"$INVOKE_METADATA_FILE"
chmod 600 "$INVOKE_METADATA_FILE" "$INVOKE_RESPONSE_FILE"

INVOKE_METADATA_FILE="$INVOKE_METADATA_FILE" \
INVOKE_RESPONSE_FILE="$INVOKE_RESPONSE_FILE" \
python3 - <<'PY'
import json
import os

with open(os.environ["INVOKE_METADATA_FILE"], encoding="utf-8") as handle:
    metadata = json.load(handle)
with open(os.environ["INVOKE_RESPONSE_FILE"], encoding="utf-8") as handle:
    response = json.load(handle)

if metadata.get("FunctionError"):
    error_type = response.get("errorType") or "LambdaFunctionError"
    error_message = response.get("errorMessage") or "migration invocation failed"
    raise SystemExit(f"{error_type}: {error_message}")
if response.get("statusCode") != 200:
    raise SystemExit(f"migration invocation failed with status {response.get('statusCode')}")
body = json.loads(response.get("body") or "{}")
if body.get("ok") is not True:
    raise SystemExit("migration health response was not ok")
PY

echo "Migration applied successfully through an isolated one-shot Lambda."
