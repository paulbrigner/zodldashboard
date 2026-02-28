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
#   INGEST_OMIT_HANDLES=zec_88,zec__2
#   SEMANTIC_ENABLED=true
#   SEMANTIC_DEFAULT_LIMIT=25
#   SEMANTIC_MAX_LIMIT=100
#   SEMANTIC_MIN_SCORE=0
#   SEMANTIC_RETRIEVAL_FACTOR=4
#   EMBEDDING_BASE_URL=https://api.venice.ai/api/v1
#   EMBEDDING_MODEL=text-embedding-bge-m3
#   EMBEDDING_DIMS=1024
#   EMBEDDING_TIMEOUT_MS=10000
#   EMBEDDING_API_KEY=...
#   COMPOSE_ENABLED=true
#   COMPOSE_DEFAULT_RETRIEVAL_LIMIT=40
#   COMPOSE_MAX_RETRIEVAL_LIMIT=100
#   COMPOSE_DEFAULT_CONTEXT_LIMIT=12
#   COMPOSE_MAX_CONTEXT_LIMIT=24
#   COMPOSE_ASYNC_ENABLED=true
#   COMPOSE_JOB_POLL_MS=2500
#   COMPOSE_JOB_TTL_HOURS=24
#   COMPOSE_JOB_MAX_ATTEMPTS=3
#   COMPOSE_BASE_URL=https://api.venice.ai/api/v1
#   COMPOSE_MODEL=claude-sonnet-4-6
#   COMPOSE_TIMEOUT_MS=120000
#   COMPOSE_MAX_OUTPUT_TOKENS=1600  (leave empty to omit explicit max_tokens cap)
#   COMPOSE_MAX_DRAFT_CHARS=1200
#   COMPOSE_MAX_DRAFT_CHARS_X_POST=280
#   COMPOSE_MAX_CITATIONS=10
#   COMPOSE_USE_JSON_MODE=true
#   COMPOSE_DISABLE_THINKING=true
#   COMPOSE_STRIP_THINKING_RESPONSE=true
#   COMPOSE_API_KEY=...
#   COMPOSE_JOBS_QUEUE_NAME=xmonitor-compose-jobs
#   COMPOSE_JOBS_DLQ_NAME=xmonitor-compose-jobs-dlq
#   COMPOSE_WORKER_FUNCTION_NAME=xmonitor-vpc-compose-worker
#   COMPOSE_WORKER_TIMEOUT=300
#   COMPOSE_WORKER_MEMORY_MB=1024
#   COMPOSE_JOBS_SCHEMA_BOOTSTRAP=false
#   SUMMARY_SCHEMA_BOOTSTRAP=true
#   SUMMARY_SCHEMA_GRANT_ROLE=xmonitor_app
#   ENABLE_NAT_EGRESS=false
#   NAT_PUBLIC_SUBNET_ID=subnet-...
#   NAT_EIP_ALLOCATION_ID=eipalloc-...
#   NAT_GATEWAY_NAME=xmonitor-lambda-nat
#   LAMBDA_PRIVATE_ROUTE_TABLE_NAME=xmonitor-lambda-private-rt

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
COMPOSE_WORKER_FUNCTION_NAME="${COMPOSE_WORKER_FUNCTION_NAME:-xmonitor-vpc-compose-worker}"
COMPOSE_WORKER_TIMEOUT="${COMPOSE_WORKER_TIMEOUT:-300}"
COMPOSE_WORKER_MEMORY_MB="${COMPOSE_WORKER_MEMORY_MB:-1024}"
COMPOSE_JOBS_QUEUE_NAME="${COMPOSE_JOBS_QUEUE_NAME:-xmonitor-compose-jobs}"
COMPOSE_JOBS_DLQ_NAME="${COMPOSE_JOBS_DLQ_NAME:-xmonitor-compose-jobs-dlq}"
COMPOSE_JOBS_SCHEMA_BOOTSTRAP="${COMPOSE_JOBS_SCHEMA_BOOTSTRAP:-false}"
ENABLE_NAT_EGRESS="${ENABLE_NAT_EGRESS:-false}"
NAT_PUBLIC_SUBNET_ID="${NAT_PUBLIC_SUBNET_ID:-}"
NAT_EIP_ALLOCATION_ID="${NAT_EIP_ALLOCATION_ID:-}"
NAT_GATEWAY_NAME="${NAT_GATEWAY_NAME:-xmonitor-lambda-nat}"
LAMBDA_PRIVATE_ROUTE_TABLE_NAME="${LAMBDA_PRIVATE_ROUTE_TABLE_NAME:-xmonitor-lambda-private-rt}"

SERVICE_NAME="${SERVICE_NAME:-xmonitor-api}"
API_VERSION="${API_VERSION:-v1}"
DEFAULT_FEED_LIMIT="${DEFAULT_FEED_LIMIT:-50}"
MAX_FEED_LIMIT="${MAX_FEED_LIMIT:-200}"
INGEST_OMIT_HANDLES="${INGEST_OMIT_HANDLES:-zec_88,zec__2,spaljeni_zec,juan_sanchez13,zeki82086538826,sucveceza_35,windymint1,usa_trader06,roger_welch1,cmscanner_bb,cmscanner_rsi,dexportal_,luckyvinod16}"
SEMANTIC_ENABLED="${SEMANTIC_ENABLED:-true}"
SEMANTIC_DEFAULT_LIMIT="${SEMANTIC_DEFAULT_LIMIT:-25}"
SEMANTIC_MAX_LIMIT="${SEMANTIC_MAX_LIMIT:-100}"
SEMANTIC_MIN_SCORE="${SEMANTIC_MIN_SCORE:-0}"
SEMANTIC_RETRIEVAL_FACTOR="${SEMANTIC_RETRIEVAL_FACTOR:-4}"
EMBEDDING_BASE_URL="${EMBEDDING_BASE_URL:-https://api.venice.ai/api/v1}"
EMBEDDING_MODEL="${EMBEDDING_MODEL:-text-embedding-bge-m3}"
EMBEDDING_DIMS="${EMBEDDING_DIMS:-1024}"
EMBEDDING_TIMEOUT_MS="${EMBEDDING_TIMEOUT_MS:-10000}"
EMBEDDING_API_KEY="${EMBEDDING_API_KEY:-}"
COMPOSE_ENABLED="${COMPOSE_ENABLED:-true}"
COMPOSE_DEFAULT_RETRIEVAL_LIMIT="${COMPOSE_DEFAULT_RETRIEVAL_LIMIT:-40}"
COMPOSE_MAX_RETRIEVAL_LIMIT="${COMPOSE_MAX_RETRIEVAL_LIMIT:-100}"
COMPOSE_DEFAULT_CONTEXT_LIMIT="${COMPOSE_DEFAULT_CONTEXT_LIMIT:-12}"
COMPOSE_MAX_CONTEXT_LIMIT="${COMPOSE_MAX_CONTEXT_LIMIT:-24}"
COMPOSE_ASYNC_ENABLED="${COMPOSE_ASYNC_ENABLED:-true}"
COMPOSE_JOB_POLL_MS="${COMPOSE_JOB_POLL_MS:-2500}"
COMPOSE_JOB_TTL_HOURS="${COMPOSE_JOB_TTL_HOURS:-24}"
COMPOSE_JOB_MAX_ATTEMPTS="${COMPOSE_JOB_MAX_ATTEMPTS:-3}"
COMPOSE_BASE_URL="${COMPOSE_BASE_URL:-https://api.venice.ai/api/v1}"
COMPOSE_MODEL="${COMPOSE_MODEL:-claude-sonnet-4-6}"
COMPOSE_TIMEOUT_MS="${COMPOSE_TIMEOUT_MS:-120000}"
COMPOSE_MAX_OUTPUT_TOKENS="${COMPOSE_MAX_OUTPUT_TOKENS:-}"
COMPOSE_MAX_DRAFT_CHARS="${COMPOSE_MAX_DRAFT_CHARS:-1200}"
COMPOSE_MAX_DRAFT_CHARS_X_POST="${COMPOSE_MAX_DRAFT_CHARS_X_POST:-280}"
COMPOSE_MAX_CITATIONS="${COMPOSE_MAX_CITATIONS:-10}"
COMPOSE_USE_JSON_MODE="${COMPOSE_USE_JSON_MODE:-true}"
COMPOSE_DISABLE_THINKING="${COMPOSE_DISABLE_THINKING:-true}"
COMPOSE_STRIP_THINKING_RESPONSE="${COMPOSE_STRIP_THINKING_RESPONSE:-true}"
COMPOSE_API_KEY="${COMPOSE_API_KEY:-}"
SUMMARY_SCHEMA_BOOTSTRAP="${SUMMARY_SCHEMA_BOOTSTRAP:-}"
SUMMARY_SCHEMA_GRANT_ROLE="${SUMMARY_SCHEMA_GRANT_ROLE:-xmonitor_app}"

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

first_matching_subnet() {
  local subnets_text="$1"
  local exclude_a="$2"
  local exclude_b="$3"
  while IFS= read -r subnet_id; do
    if [[ -n "$subnet_id" && "$subnet_id" != "$exclude_a" && "$subnet_id" != "$exclude_b" ]]; then
      printf '%s\n' "$subnet_id"
      return 0
    fi
  done <<<"$subnets_text"
  return 1
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

if is_truthy "$ENABLE_NAT_EGRESS"; then
  echo "==> Ensuring NAT egress for Lambda subnets"
  if [[ -z "$NAT_PUBLIC_SUBNET_ID" ]]; then
    NAT_PUBLIC_SUBNET_ID="$(first_matching_subnet "$SUBNETS_TEXT" "$SUBNET_1" "$SUBNET_2" || true)"
  fi

  if [[ -z "$NAT_PUBLIC_SUBNET_ID" ]]; then
    echo "error: could not determine NAT public subnet; set NAT_PUBLIC_SUBNET_ID explicitly" >&2
    exit 1
  fi

  if [[ -z "$NAT_EIP_ALLOCATION_ID" ]]; then
    NAT_EIP_ALLOCATION_ID="$(
      aws_cli ec2 describe-addresses \
        --filters "Name=domain,Values=vpc" "Name=tag:Name,Values=${NAT_GATEWAY_NAME}-eip" \
        --query 'Addresses[0].AllocationId' \
        --output text 2>/dev/null || true
    )"
  fi

  if [[ -z "$NAT_EIP_ALLOCATION_ID" || "$NAT_EIP_ALLOCATION_ID" == "None" ]]; then
    NAT_EIP_ALLOCATION_ID="$(
      aws_cli ec2 allocate-address \
        --domain vpc \
        --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${NAT_GATEWAY_NAME}-eip}]" \
        --query 'AllocationId' \
        --output text
    )"
  fi

  NAT_GW_ID="$(
    aws_cli ec2 describe-nat-gateways \
      --filter "Name=vpc-id,Values=$VPC_ID" "Name=state,Values=available,pending" \
      --query "NatGateways[?Tags[?Key=='Name' && Value=='$NAT_GATEWAY_NAME']]|[0].NatGatewayId" \
      --output text 2>/dev/null || true
  )"
  if [[ -z "$NAT_GW_ID" || "$NAT_GW_ID" == "None" ]]; then
    NAT_GW_ID="$(
      aws_cli ec2 create-nat-gateway \
        --subnet-id "$NAT_PUBLIC_SUBNET_ID" \
        --allocation-id "$NAT_EIP_ALLOCATION_ID" \
        --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=$NAT_GATEWAY_NAME}]" \
        --query 'NatGateway.NatGatewayId' \
        --output text
    )"
  fi

  aws_cli ec2 wait nat-gateway-available --nat-gateway-ids "$NAT_GW_ID"

  PRIVATE_RT_ID="$(
    aws_cli ec2 describe-route-tables \
      --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=$LAMBDA_PRIVATE_ROUTE_TABLE_NAME" \
      --query 'RouteTables[0].RouteTableId' \
      --output text 2>/dev/null || true
  )"
  if [[ -z "$PRIVATE_RT_ID" || "$PRIVATE_RT_ID" == "None" ]]; then
    PRIVATE_RT_ID="$(
      aws_cli ec2 create-route-table \
        --vpc-id "$VPC_ID" \
        --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$LAMBDA_PRIVATE_ROUTE_TABLE_NAME}]" \
        --query 'RouteTable.RouteTableId' \
        --output text
    )"
  fi

  if ! aws_cli ec2 replace-route \
    --route-table-id "$PRIVATE_RT_ID" \
    --destination-cidr-block 0.0.0.0/0 \
    --nat-gateway-id "$NAT_GW_ID" >/dev/null 2>&1; then
    aws_cli ec2 create-route \
      --route-table-id "$PRIVATE_RT_ID" \
      --destination-cidr-block 0.0.0.0/0 \
      --nat-gateway-id "$NAT_GW_ID" >/dev/null
  fi

  for subnet_id in "$SUBNET_1" "$SUBNET_2"; do
    CURRENT_RT_ID="$(
      aws_cli ec2 describe-route-tables \
        --filters "Name=association.subnet-id,Values=$subnet_id" \
        --query 'RouteTables[0].RouteTableId' \
        --output text 2>/dev/null || true
    )"
    if [[ "$CURRENT_RT_ID" != "$PRIVATE_RT_ID" ]]; then
      ASSOC_ID="$(
        aws_cli ec2 describe-route-tables \
          --filters "Name=association.subnet-id,Values=$subnet_id" \
          --query 'RouteTables[0].Associations[0].RouteTableAssociationId' \
          --output text 2>/dev/null || true
      )"
      if [[ -n "$ASSOC_ID" && "$ASSOC_ID" != "None" ]]; then
        aws_cli ec2 replace-route-table-association \
          --association-id "$ASSOC_ID" \
          --route-table-id "$PRIVATE_RT_ID" >/dev/null
      else
        aws_cli ec2 associate-route-table \
          --subnet-id "$subnet_id" \
          --route-table-id "$PRIVATE_RT_ID" >/dev/null
      fi
    fi
  done

  echo "NAT gateway: $NAT_GW_ID (public subnet: $NAT_PUBLIC_SUBNET_ID, private RT: $PRIVATE_RT_ID)"
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

echo "==> Ensuring SQS queues for async compose jobs"
COMPOSE_DLQ_URL="$(aws_cli sqs get-queue-url --queue-name "$COMPOSE_JOBS_DLQ_NAME" --query 'QueueUrl' --output text 2>/dev/null || true)"
if [[ -z "$COMPOSE_DLQ_URL" || "$COMPOSE_DLQ_URL" == "None" ]]; then
  COMPOSE_DLQ_URL="$(aws_cli sqs create-queue --queue-name "$COMPOSE_JOBS_DLQ_NAME" --query 'QueueUrl' --output text)"
fi
COMPOSE_DLQ_ARN="$(aws_cli sqs get-queue-attributes --queue-url "$COMPOSE_DLQ_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)"

COMPOSE_QUEUE_URL="$(aws_cli sqs get-queue-url --queue-name "$COMPOSE_JOBS_QUEUE_NAME" --query 'QueueUrl' --output text 2>/dev/null || true)"
if [[ -z "$COMPOSE_QUEUE_URL" || "$COMPOSE_QUEUE_URL" == "None" ]]; then
  COMPOSE_QUEUE_URL="$(aws_cli sqs create-queue --queue-name "$COMPOSE_JOBS_QUEUE_NAME" --query 'QueueUrl' --output text)"
fi
COMPOSE_QUEUE_ARN="$(aws_cli sqs get-queue-attributes --queue-url "$COMPOSE_QUEUE_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)"

VISIBILITY_TIMEOUT="$((COMPOSE_WORKER_TIMEOUT + 30))"
aws_cli sqs set-queue-attributes \
  --queue-url "$COMPOSE_QUEUE_URL" \
  --attributes "VisibilityTimeout=$VISIBILITY_TIMEOUT" >/dev/null

echo "==> Ensuring IAM SQS permissions on role: $LAMBDA_ROLE_NAME"
SQS_POLICY_FILE="$(mktemp)"
cat >"$SQS_POLICY_FILE" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:ChangeMessageVisibility",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl"
      ],
      "Resource": [
        "$COMPOSE_QUEUE_ARN",
        "$COMPOSE_DLQ_ARN"
      ]
    }
  ]
}
JSON
aws_cli iam put-role-policy \
  --role-name "$LAMBDA_ROLE_NAME" \
  --policy-name "${LAMBDA_ROLE_NAME}-sqs-access" \
  --policy-document "file://$SQS_POLICY_FILE" >/dev/null
rm -f "$SQS_POLICY_FILE"

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
print(d.get("embedding_api_key", d.get("venice_api_key", "")))
print(d.get("compose_api_key", d.get("venice_api_key", "")))
PY
)"

DB_HOST="$(printf '%s\n' "$DB_FIELDS" | sed -n '1p')"
DB_PORT="$(printf '%s\n' "$DB_FIELDS" | sed -n '2p')"
DB_NAME="$(printf '%s\n' "$DB_FIELDS" | sed -n '3p')"
DB_USER="$(printf '%s\n' "$DB_FIELDS" | sed -n '4p')"
DB_PASS="$(printf '%s\n' "$DB_FIELDS" | sed -n '5p')"
DB_INGEST_SHARED_SECRET="$(printf '%s\n' "$DB_FIELDS" | sed -n '6p')"
DB_EMBEDDING_API_KEY="$(printf '%s\n' "$DB_FIELDS" | sed -n '7p')"
DB_COMPOSE_API_KEY="$(printf '%s\n' "$DB_FIELDS" | sed -n '8p')"
INGEST_SHARED_SECRET="${INGEST_SHARED_SECRET:-$DB_INGEST_SHARED_SECRET}"
EMBEDDING_API_KEY="${EMBEDDING_API_KEY:-$DB_EMBEDDING_API_KEY}"
COMPOSE_API_KEY="${COMPOSE_API_KEY:-$DB_COMPOSE_API_KEY}"

CURRENT_LAMBDA_ENV_JSON="$(
  aws_cli lambda get-function-configuration \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --query 'Environment.Variables' \
    --output json 2>/dev/null || printf '{}'
)"

existing_lambda_var() {
  local var_name="$1"
  CURRENT_LAMBDA_ENV_JSON="$CURRENT_LAMBDA_ENV_JSON" TARGET_VAR="$var_name" python3 - <<'PY'
import json, os
payload = json.loads(os.environ.get("CURRENT_LAMBDA_ENV_JSON", "{}") or "{}")
print(payload.get(os.environ["TARGET_VAR"], ""))
PY
}

if [[ -z "$EMBEDDING_API_KEY" ]]; then
  EMBEDDING_API_KEY="$(existing_lambda_var "XMONITOR_EMBEDDING_API_KEY")"
fi
if [[ -z "$COMPOSE_API_KEY" ]]; then
  COMPOSE_API_KEY="$(existing_lambda_var "XMONITOR_COMPOSE_API_KEY")"
fi

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
  INGEST_OMIT_HANDLES="$INGEST_OMIT_HANDLES" \
  SEMANTIC_ENABLED="$SEMANTIC_ENABLED" \
  SEMANTIC_DEFAULT_LIMIT="$SEMANTIC_DEFAULT_LIMIT" \
  SEMANTIC_MAX_LIMIT="$SEMANTIC_MAX_LIMIT" \
  SEMANTIC_MIN_SCORE="$SEMANTIC_MIN_SCORE" \
  SEMANTIC_RETRIEVAL_FACTOR="$SEMANTIC_RETRIEVAL_FACTOR" \
  EMBEDDING_BASE_URL="$EMBEDDING_BASE_URL" \
  EMBEDDING_MODEL="$EMBEDDING_MODEL" \
  EMBEDDING_DIMS="$EMBEDDING_DIMS" \
  EMBEDDING_TIMEOUT_MS="$EMBEDDING_TIMEOUT_MS" \
  EMBEDDING_API_KEY="$EMBEDDING_API_KEY" \
  COMPOSE_ENABLED="$COMPOSE_ENABLED" \
  COMPOSE_DEFAULT_RETRIEVAL_LIMIT="$COMPOSE_DEFAULT_RETRIEVAL_LIMIT" \
  COMPOSE_MAX_RETRIEVAL_LIMIT="$COMPOSE_MAX_RETRIEVAL_LIMIT" \
  COMPOSE_DEFAULT_CONTEXT_LIMIT="$COMPOSE_DEFAULT_CONTEXT_LIMIT" \
  COMPOSE_MAX_CONTEXT_LIMIT="$COMPOSE_MAX_CONTEXT_LIMIT" \
  COMPOSE_ASYNC_ENABLED="$COMPOSE_ASYNC_ENABLED" \
  COMPOSE_JOB_POLL_MS="$COMPOSE_JOB_POLL_MS" \
  COMPOSE_JOB_TTL_HOURS="$COMPOSE_JOB_TTL_HOURS" \
  COMPOSE_JOB_MAX_ATTEMPTS="$COMPOSE_JOB_MAX_ATTEMPTS" \
  COMPOSE_BASE_URL="$COMPOSE_BASE_URL" \
  COMPOSE_MODEL="$COMPOSE_MODEL" \
  COMPOSE_TIMEOUT_MS="$COMPOSE_TIMEOUT_MS" \
  COMPOSE_MAX_OUTPUT_TOKENS="$COMPOSE_MAX_OUTPUT_TOKENS" \
  COMPOSE_MAX_DRAFT_CHARS="$COMPOSE_MAX_DRAFT_CHARS" \
  COMPOSE_MAX_DRAFT_CHARS_X_POST="$COMPOSE_MAX_DRAFT_CHARS_X_POST" \
  COMPOSE_MAX_CITATIONS="$COMPOSE_MAX_CITATIONS" \
  COMPOSE_USE_JSON_MODE="$COMPOSE_USE_JSON_MODE" \
  COMPOSE_DISABLE_THINKING="$COMPOSE_DISABLE_THINKING" \
  COMPOSE_STRIP_THINKING_RESPONSE="$COMPOSE_STRIP_THINKING_RESPONSE" \
  COMPOSE_API_KEY="$COMPOSE_API_KEY" \
  COMPOSE_QUEUE_URL="$COMPOSE_QUEUE_URL" \
  COMPOSE_JOBS_SCHEMA_BOOTSTRAP="$COMPOSE_JOBS_SCHEMA_BOOTSTRAP" \
  SUMMARY_SCHEMA_BOOTSTRAP="$SUMMARY_SCHEMA_BOOTSTRAP" \
  SUMMARY_SCHEMA_GRANT_ROLE="$SUMMARY_SCHEMA_GRANT_ROLE" \
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
    "XMONITOR_INGEST_OMIT_HANDLES": os.environ.get("INGEST_OMIT_HANDLES", ""),
    "XMONITOR_SEMANTIC_ENABLED": os.environ.get("SEMANTIC_ENABLED", ""),
    "XMONITOR_SEMANTIC_DEFAULT_LIMIT": os.environ.get("SEMANTIC_DEFAULT_LIMIT", ""),
    "XMONITOR_SEMANTIC_MAX_LIMIT": os.environ.get("SEMANTIC_MAX_LIMIT", ""),
    "XMONITOR_SEMANTIC_MIN_SCORE": os.environ.get("SEMANTIC_MIN_SCORE", ""),
    "XMONITOR_SEMANTIC_RETRIEVAL_FACTOR": os.environ.get("SEMANTIC_RETRIEVAL_FACTOR", ""),
    "XMONITOR_EMBEDDING_BASE_URL": os.environ.get("EMBEDDING_BASE_URL", ""),
    "XMONITOR_EMBEDDING_MODEL": os.environ.get("EMBEDDING_MODEL", ""),
    "XMONITOR_EMBEDDING_DIMS": os.environ.get("EMBEDDING_DIMS", ""),
    "XMONITOR_EMBEDDING_TIMEOUT_MS": os.environ.get("EMBEDDING_TIMEOUT_MS", ""),
    "XMONITOR_EMBEDDING_API_KEY": os.environ.get("EMBEDDING_API_KEY", ""),
    "XMONITOR_COMPOSE_ENABLED": os.environ.get("COMPOSE_ENABLED", ""),
    "XMONITOR_COMPOSE_DEFAULT_RETRIEVAL_LIMIT": os.environ.get("COMPOSE_DEFAULT_RETRIEVAL_LIMIT", ""),
    "XMONITOR_COMPOSE_MAX_RETRIEVAL_LIMIT": os.environ.get("COMPOSE_MAX_RETRIEVAL_LIMIT", ""),
    "XMONITOR_COMPOSE_DEFAULT_CONTEXT_LIMIT": os.environ.get("COMPOSE_DEFAULT_CONTEXT_LIMIT", ""),
    "XMONITOR_COMPOSE_MAX_CONTEXT_LIMIT": os.environ.get("COMPOSE_MAX_CONTEXT_LIMIT", ""),
    "XMONITOR_COMPOSE_ASYNC_ENABLED": os.environ.get("COMPOSE_ASYNC_ENABLED", ""),
    "XMONITOR_COMPOSE_JOB_POLL_MS": os.environ.get("COMPOSE_JOB_POLL_MS", ""),
    "XMONITOR_COMPOSE_JOB_TTL_HOURS": os.environ.get("COMPOSE_JOB_TTL_HOURS", ""),
    "XMONITOR_COMPOSE_JOB_MAX_ATTEMPTS": os.environ.get("COMPOSE_JOB_MAX_ATTEMPTS", ""),
    "XMONITOR_COMPOSE_JOBS_QUEUE_URL": os.environ.get("COMPOSE_QUEUE_URL", ""),
    "XMONITOR_COMPOSE_BASE_URL": os.environ.get("COMPOSE_BASE_URL", ""),
    "XMONITOR_COMPOSE_MODEL": os.environ.get("COMPOSE_MODEL", ""),
    "XMONITOR_COMPOSE_TIMEOUT_MS": os.environ.get("COMPOSE_TIMEOUT_MS", ""),
    "XMONITOR_COMPOSE_MAX_OUTPUT_TOKENS": os.environ.get("COMPOSE_MAX_OUTPUT_TOKENS", ""),
    "XMONITOR_COMPOSE_MAX_DRAFT_CHARS": os.environ.get("COMPOSE_MAX_DRAFT_CHARS", ""),
    "XMONITOR_COMPOSE_MAX_DRAFT_CHARS_X_POST": os.environ.get("COMPOSE_MAX_DRAFT_CHARS_X_POST", ""),
    "XMONITOR_COMPOSE_MAX_CITATIONS": os.environ.get("COMPOSE_MAX_CITATIONS", ""),
    "XMONITOR_COMPOSE_USE_JSON_MODE": os.environ.get("COMPOSE_USE_JSON_MODE", ""),
    "XMONITOR_COMPOSE_DISABLE_THINKING": os.environ.get("COMPOSE_DISABLE_THINKING", ""),
    "XMONITOR_COMPOSE_STRIP_THINKING_RESPONSE": os.environ.get("COMPOSE_STRIP_THINKING_RESPONSE", ""),
    "XMONITOR_COMPOSE_API_KEY": os.environ.get("COMPOSE_API_KEY", ""),
    "XMONITOR_ENABLE_COMPOSE_JOBS_SCHEMA_BOOTSTRAP": os.environ.get("COMPOSE_JOBS_SCHEMA_BOOTSTRAP", ""),
    "XMONITOR_ENABLE_SUMMARY_SCHEMA_BOOTSTRAP": os.environ.get("SUMMARY_SCHEMA_BOOTSTRAP", ""),
    "XMONITOR_SUMMARY_SCHEMA_GRANT_ROLE": os.environ.get("SUMMARY_SCHEMA_GRANT_ROLE", ""),
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

echo "==> Creating/updating compose worker Lambda: $COMPOSE_WORKER_FUNCTION_NAME"
WORKER_ARN="$(aws_cli lambda get-function --function-name "$COMPOSE_WORKER_FUNCTION_NAME" --query 'Configuration.FunctionArn' --output text 2>/dev/null || true)"
if [[ -z "$WORKER_ARN" || "$WORKER_ARN" == "None" ]]; then
  WORKER_ARN="$(aws_cli lambda create-function \
    --function-name "$COMPOSE_WORKER_FUNCTION_NAME" \
    --runtime nodejs22.x \
    --handler index.sqsHandler \
    --role "$ROLE_ARN" \
    --zip-file "fileb://$LAMBDA_DIR/function.zip" \
    --timeout "$COMPOSE_WORKER_TIMEOUT" \
    --memory-size "$COMPOSE_WORKER_MEMORY_MB" \
    --vpc-config "SubnetIds=$SUBNET_CSV,SecurityGroupIds=$LAMBDA_SG_ID" \
    --environment "$ENV_JSON" \
    --query 'FunctionArn' --output text)"
else
  aws_cli lambda update-function-code \
    --function-name "$COMPOSE_WORKER_FUNCTION_NAME" \
    --zip-file "fileb://$LAMBDA_DIR/function.zip" >/dev/null

  aws_cli lambda wait function-updated --function-name "$COMPOSE_WORKER_FUNCTION_NAME"

  aws_cli lambda update-function-configuration \
    --function-name "$COMPOSE_WORKER_FUNCTION_NAME" \
    --runtime nodejs22.x \
    --handler index.sqsHandler \
    --role "$ROLE_ARN" \
    --timeout "$COMPOSE_WORKER_TIMEOUT" \
    --memory-size "$COMPOSE_WORKER_MEMORY_MB" \
    --vpc-config "SubnetIds=$SUBNET_CSV,SecurityGroupIds=$LAMBDA_SG_ID" \
    --environment "$ENV_JSON" >/dev/null
fi

aws_cli lambda wait function-active-v2 --function-name "$COMPOSE_WORKER_FUNCTION_NAME"
WORKER_ARN="$(aws_cli lambda get-function --function-name "$COMPOSE_WORKER_FUNCTION_NAME" --query 'Configuration.FunctionArn' --output text)"

echo "==> Ensuring SQS event source mapping for compose worker"
EVENT_SOURCE_UUID="$(aws_cli lambda list-event-source-mappings \
  --function-name "$COMPOSE_WORKER_FUNCTION_NAME" \
  --event-source-arn "$COMPOSE_QUEUE_ARN" \
  --query 'EventSourceMappings[0].UUID' \
  --output text 2>/dev/null || true)"
if [[ -z "$EVENT_SOURCE_UUID" || "$EVENT_SOURCE_UUID" == "None" ]]; then
  aws_cli lambda create-event-source-mapping \
    --function-name "$COMPOSE_WORKER_FUNCTION_NAME" \
    --event-source-arn "$COMPOSE_QUEUE_ARN" \
    --batch-size 1 \
    --maximum-batching-window-in-seconds 0 \
    --function-response-types ReportBatchItemFailures \
    --enabled >/dev/null
else
  aws_cli lambda update-event-source-mapping \
    --uuid "$EVENT_SOURCE_UUID" \
    --batch-size 1 \
    --maximum-batching-window-in-seconds 0 \
    --function-response-types ReportBatchItemFailures \
    --enabled >/dev/null
fi

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
echo "  Worker function: $COMPOSE_WORKER_FUNCTION_NAME"
echo "  Worker ARN:      $WORKER_ARN"
echo "  Lambda SG:       $LAMBDA_SG_ID"
echo "  Compose queue:   $COMPOSE_QUEUE_URL"
echo "  Compose DLQ:     $COMPOSE_DLQ_URL"
echo "  API ID:          $API_ID"
echo "  API endpoint:    $API_ENDPOINT"
echo "  API base URL:    ${API_ENDPOINT%/}/v1"
