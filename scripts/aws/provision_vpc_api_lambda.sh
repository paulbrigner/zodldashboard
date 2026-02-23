#!/usr/bin/env bash
set -euo pipefail

# Provision (or update) a VPC-attached Lambda + HTTP API backend for XMonitor.
#
# Usage:
#   AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 ./scripts/aws/provision_vpc_api_lambda.sh
#
# Optional env overrides:
#   VPC_ID=vpc-...
#   RDS_SG_ID=sg-...
#   DB_SECRET_ID=xmonitor/rds/app
#   INGEST_SHARED_SECRET=...
#   LAMBDA_FUNCTION_NAME=xmonitor-vpc-api
#   LAMBDA_ROLE_NAME=xmonitor-vpc-api-lambda-role
#   LAMBDA_SG_NAME=xmonitor-api-lambda-sg
#   API_NAME=xmonitor-vpc-api
#   SERVICE_NAME=xmonitor-api
#   API_VERSION=v1
#   DEFAULT_FEED_LIMIT=50
#   MAX_FEED_LIMIT=200

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAMBDA_DIR="$ROOT_DIR/services/vpc-api-lambda"

AWS_REGION="${AWS_REGION:-us-east-1}"
VPC_ID="${VPC_ID:-vpc-1ee66a65}"
RDS_SG_ID="${RDS_SG_ID:-sg-081e2d8e12101d117}"
DB_SECRET_ID="${DB_SECRET_ID:-xmonitor/rds/app}"

LAMBDA_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-xmonitor-vpc-api}"
LAMBDA_ROLE_NAME="${LAMBDA_ROLE_NAME:-xmonitor-vpc-api-lambda-role}"
LAMBDA_SG_NAME="${LAMBDA_SG_NAME:-xmonitor-api-lambda-sg}"
API_NAME="${API_NAME:-xmonitor-vpc-api}"

SERVICE_NAME="${SERVICE_NAME:-xmonitor-api}"
API_VERSION="${API_VERSION:-v1}"
DEFAULT_FEED_LIMIT="${DEFAULT_FEED_LIMIT:-50}"
MAX_FEED_LIMIT="${MAX_FEED_LIMIT:-200}"

aws_cli() {
  AWS_REGION="$AWS_REGION" aws "$@"
}

echo "==> Resolving account and network context"
ACCOUNT_ID="$(aws_cli sts get-caller-identity --query 'Account' --output text)"
SUBNETS_TEXT="$(
  aws_cli ec2 describe-subnets \
    --filters "Name=vpc-id,Values=$VPC_ID" "Name=state,Values=available" \
    --query 'Subnets[].SubnetId' \
    --output text | tr '\t' '\n' | sed '/^$/d' | sort
)"

SUBNET_1="$(printf '%s\n' "$SUBNETS_TEXT" | sed -n '1p')"
SUBNET_2="$(printf '%s\n' "$SUBNETS_TEXT" | sed -n '2p')"

if [[ -z "$SUBNET_1" || -z "$SUBNET_2" ]]; then
  echo "error: need at least 2 available subnets in VPC $VPC_ID" >&2
  exit 1
fi

SUBNET_CSV="${SUBNET_1},${SUBNET_2}"
echo "Using subnets: $SUBNET_CSV"

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
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON
  ROLE_ARN="$(aws_cli iam create-role \
    --role-name "$LAMBDA_ROLE_NAME" \
    --assume-role-policy-document "file://$TRUST_FILE" \
    --query 'Role.Arn' \
    --output text)"
  rm -f "$TRUST_FILE"
fi

aws_cli iam attach-role-policy \
  --role-name "$LAMBDA_ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null
aws_cli iam attach-role-policy \
  --role-name "$LAMBDA_ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole >/dev/null

echo "Waiting for IAM role propagation..."
sleep 10

echo "==> Ensuring Lambda security group: $LAMBDA_SG_NAME"
LAMBDA_SG_ID="$(aws_cli ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=$LAMBDA_SG_NAME" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
if [[ -z "$LAMBDA_SG_ID" || "$LAMBDA_SG_ID" == "None" ]]; then
  LAMBDA_SG_ID="$(aws_cli ec2 create-security-group \
    --group-name "$LAMBDA_SG_NAME" \
    --description "XMonitor VPC API Lambda SG" \
    --vpc-id "$VPC_ID" \
    --query 'GroupId' --output text)"
fi
echo "Lambda SG: $LAMBDA_SG_ID"

echo "==> Ensuring RDS ingress from Lambda SG"
if ! aws_cli ec2 authorize-security-group-ingress \
  --group-id "$RDS_SG_ID" \
  --protocol tcp \
  --port 5432 \
  --source-group "$LAMBDA_SG_ID" >/dev/null 2>&1; then
  echo "RDS ingress rule already exists (or could not be added). Continuing."
fi

echo "==> Reading DB credentials from Secrets Manager: $DB_SECRET_ID"
DB_SECRET_JSON="$(aws_cli secretsmanager get-secret-value --secret-id "$DB_SECRET_ID" --query 'SecretString' --output text)"
if [[ -z "$DB_SECRET_JSON" || "$DB_SECRET_JSON" == "None" ]]; then
  echo "error: no secret payload returned from $DB_SECRET_ID" >&2
  exit 1
fi

DB_FIELDS="$(
  DB_SECRET_JSON="$DB_SECRET_JSON" python3 - <<'PY'
import json, os
d = json.loads(os.environ["DB_SECRET_JSON"])
print(d.get("host", ""))
print(str(d.get("port", 5432)))
print(d.get("dbname", ""))
print(d.get("username", ""))
print(d.get("password", ""))
print(d.get("ingest_shared_secret", d.get("api_key", "")))
PY
)"

DB_HOST="$(printf '%s\n' "$DB_FIELDS" | sed -n '1p')"
DB_PORT="$(printf '%s\n' "$DB_FIELDS" | sed -n '2p')"
DB_NAME="$(printf '%s\n' "$DB_FIELDS" | sed -n '3p')"
DB_USER="$(printf '%s\n' "$DB_FIELDS" | sed -n '4p')"
DB_PASS="$(printf '%s\n' "$DB_FIELDS" | sed -n '5p')"
DB_INGEST_SHARED_SECRET="$(printf '%s\n' "$DB_FIELDS" | sed -n '6p')"
INGEST_SHARED_SECRET="${INGEST_SHARED_SECRET:-$DB_INGEST_SHARED_SECRET}"

if [[ -z "$DB_HOST" || -z "$DB_NAME" || -z "$DB_USER" || -z "$DB_PASS" ]]; then
  echo "error: secret $DB_SECRET_ID is missing required fields (host/dbname/username/password)" >&2
  exit 1
fi

if [[ -z "$INGEST_SHARED_SECRET" ]]; then
  echo "error: ingest shared secret is required (set INGEST_SHARED_SECRET or include ingest_shared_secret in $DB_SECRET_ID)" >&2
  exit 1
fi

echo "==> Packaging Lambda code"
pushd "$LAMBDA_DIR" >/dev/null
npm install --omit=dev >/dev/null
rm -f function.zip
zip -rq function.zip index.mjs package.json package-lock.json node_modules
popd >/dev/null

ENV_JSON="$(
  DB_HOST="$DB_HOST" \
  DB_PORT="$DB_PORT" \
  DB_NAME="$DB_NAME" \
  DB_USER="$DB_USER" \
  DB_PASS="$DB_PASS" \
  INGEST_SHARED_SECRET="$INGEST_SHARED_SECRET" \
  SERVICE_NAME="$SERVICE_NAME" \
  API_VERSION="$API_VERSION" \
  DEFAULT_FEED_LIMIT="$DEFAULT_FEED_LIMIT" \
  MAX_FEED_LIMIT="$MAX_FEED_LIMIT" \
  python3 - <<'PY'
import json, os
print(json.dumps({
  "Variables": {
    "PGHOST": os.environ["DB_HOST"],
    "PGPORT": os.environ["DB_PORT"],
    "PGDATABASE": os.environ["DB_NAME"],
    "PGUSER": os.environ["DB_USER"],
    "PGPASSWORD": os.environ["DB_PASS"],
    "PGSSLMODE": "require",
    "XMONITOR_INGEST_SHARED_SECRET": os.environ["INGEST_SHARED_SECRET"],
    "XMONITOR_API_SERVICE_NAME": os.environ["SERVICE_NAME"],
    "XMONITOR_API_VERSION": os.environ["API_VERSION"],
    "XMONITOR_DEFAULT_FEED_LIMIT": os.environ["DEFAULT_FEED_LIMIT"],
    "XMONITOR_MAX_FEED_LIMIT": os.environ["MAX_FEED_LIMIT"],
  }
}))
PY
)"

echo "==> Creating/updating Lambda function: $LAMBDA_FUNCTION_NAME"
LAMBDA_ARN="$(aws_cli lambda get-function --function-name "$LAMBDA_FUNCTION_NAME" --query 'Configuration.FunctionArn' --output text 2>/dev/null || true)"
if [[ -z "$LAMBDA_ARN" || "$LAMBDA_ARN" == "None" ]]; then
  LAMBDA_ARN="$(aws_cli lambda create-function \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --runtime nodejs22.x \
    --handler index.handler \
    --role "$ROLE_ARN" \
    --zip-file "fileb://$LAMBDA_DIR/function.zip" \
    --timeout 30 \
    --memory-size 512 \
    --vpc-config "SubnetIds=$SUBNET_CSV,SecurityGroupIds=$LAMBDA_SG_ID" \
    --environment "$ENV_JSON" \
    --query 'FunctionArn' --output text)"
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
    --timeout 30 \
    --memory-size 512 \
    --vpc-config "SubnetIds=$SUBNET_CSV,SecurityGroupIds=$LAMBDA_SG_ID" \
    --environment "$ENV_JSON" >/dev/null
fi

aws_cli lambda wait function-active-v2 --function-name "$LAMBDA_FUNCTION_NAME"
LAMBDA_ARN="$(aws_cli lambda get-function --function-name "$LAMBDA_FUNCTION_NAME" --query 'Configuration.FunctionArn' --output text)"

echo "==> Creating/updating API Gateway HTTP API: $API_NAME"
API_ID="$(aws_cli apigatewayv2 get-apis --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)"
if [[ -z "$API_ID" || "$API_ID" == "None" ]]; then
  API_ID="$(aws_cli apigatewayv2 create-api \
    --name "$API_NAME" \
    --protocol-type HTTP \
    --query 'ApiId' --output text)"
fi

INTEGRATION_ID="$(aws_cli apigatewayv2 get-integrations --api-id "$API_ID" --query 'Items[0].IntegrationId' --output text 2>/dev/null || true)"
if [[ -z "$INTEGRATION_ID" || "$INTEGRATION_ID" == "None" ]]; then
  INTEGRATION_ID="$(aws_cli apigatewayv2 create-integration \
    --api-id "$API_ID" \
    --integration-type AWS_PROXY \
    --integration-uri "$LAMBDA_ARN" \
    --payload-format-version 2.0 \
    --integration-method POST \
    --query 'IntegrationId' \
    --output text)"
else
  aws_cli apigatewayv2 update-integration \
    --api-id "$API_ID" \
    --integration-id "$INTEGRATION_ID" \
    --integration-uri "$LAMBDA_ARN" \
    --payload-format-version 2.0 \
    --integration-method POST >/dev/null
fi

ROUTE_ID="$(aws_cli apigatewayv2 get-routes --api-id "$API_ID" --query 'Items[?RouteKey==`$default`].RouteId | [0]' --output text)"
if [[ -z "$ROUTE_ID" || "$ROUTE_ID" == "None" ]]; then
  aws_cli apigatewayv2 create-route \
    --api-id "$API_ID" \
    --route-key '$default' \
    --target "integrations/$INTEGRATION_ID" >/dev/null
else
  aws_cli apigatewayv2 update-route \
    --api-id "$API_ID" \
    --route-id "$ROUTE_ID" \
    --target "integrations/$INTEGRATION_ID" >/dev/null
fi

if ! aws_cli apigatewayv2 get-stage --api-id "$API_ID" --stage-name '$default' >/dev/null 2>&1; then
  aws_cli apigatewayv2 create-stage \
    --api-id "$API_ID" \
    --stage-name '$default' \
    --auto-deploy >/dev/null
else
  aws_cli apigatewayv2 update-stage \
    --api-id "$API_ID" \
    --stage-name '$default' \
    --auto-deploy >/dev/null
fi

echo "==> Granting API Gateway invoke permission on Lambda"
SOURCE_ARN="arn:aws:execute-api:$AWS_REGION:$ACCOUNT_ID:$API_ID/*"
if ! aws_cli lambda add-permission \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --statement-id "apigw-invoke-$API_ID-broad" \
  --action "lambda:InvokeFunction" \
  --principal apigateway.amazonaws.com \
  --source-arn "$SOURCE_ARN" >/dev/null 2>&1; then
  echo "Lambda invoke permission already exists (or could not be added). Continuing."
fi

API_ENDPOINT="$(aws_cli apigatewayv2 get-api --api-id "$API_ID" --query 'ApiEndpoint' --output text)"

echo ""
echo "Provisioning complete:"
echo "  Lambda function: $LAMBDA_FUNCTION_NAME"
echo "  Lambda ARN:      $LAMBDA_ARN"
echo "  Lambda SG:       $LAMBDA_SG_ID"
echo "  API ID:          $API_ID"
echo "  API endpoint:    $API_ENDPOINT"
echo "  API base URL:    ${API_ENDPOINT%/}/v1"
