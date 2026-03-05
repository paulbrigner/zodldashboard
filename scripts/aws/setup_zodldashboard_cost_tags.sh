#!/usr/bin/env bash
set -euo pipefail

# Apply a cost-allocation tag across known ZodlDashboard/XMonitor AWS resources
# and activate the tag in Cost Explorer.
#
# Usage:
#   AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
#   ./scripts/aws/setup_zodldashboard_cost_tags.sh
#
# Optional env:
#   COST_TAG_KEY=Project
#   COST_TAG_VALUE=ZodlDashboard
#   AMPLIFY_APP_ID=d2rgmein7vsf2e
#   RDS_DB_IDENTIFIER=xmonitor-pg-beta
#   API_NAME=xmonitor-vpc-api

AWS_PROFILE="${AWS_PROFILE:-zodldashboard}"
AWS_REGION="${AWS_REGION:-us-east-1}"
COST_TAG_KEY="${COST_TAG_KEY:-Project}"
COST_TAG_VALUE="${COST_TAG_VALUE:-ZodlDashboard}"
AMPLIFY_APP_ID="${AMPLIFY_APP_ID:-d2rgmein7vsf2e}"
RDS_DB_IDENTIFIER="${RDS_DB_IDENTIFIER:-xmonitor-pg-beta}"
API_NAME="${API_NAME:-xmonitor-vpc-api}"

LAMBDA_FUNCTIONS=(
  "xmonitor-vpc-api"
  "xmonitor-vpc-compose-worker"
  "xmonitor-vpc-email-scheduler"
  "xmonitor-xapi-priority-collector"
  "xmonitor-xapi-discovery-collector"
)

EVENT_RULES=(
  "xmonitor-xapi-priority-collector-15m"
  "xmonitor-xapi-discovery-collector-60m"
  "xmonitor-email-schedule-dispatch"
)

SQS_QUEUES=(
  "xmonitor-compose-jobs"
  "xmonitor-compose-jobs-dlq"
)

LOG_GROUPS=(
  "/aws/lambda/xmonitor-vpc-api"
  "/aws/lambda/xmonitor-vpc-compose-worker"
  "/aws/lambda/xmonitor-vpc-email-scheduler"
  "/aws/lambda/xmonitor-xapi-priority-collector"
  "/aws/lambda/xmonitor-xapi-discovery-collector"
)

EC2_NAME_TAGS=(
  "xmonitor-lambda-nat"
  "xmonitor-lambda-nat-eip"
  "xmonitor-lambda-private-rt"
  "xmonitor-api-lambda-sg"
)

echo "==> profile=${AWS_PROFILE} region=${AWS_REGION}"
ACCOUNT_ID="$(
  aws --profile "$AWS_PROFILE" --region "$AWS_REGION" sts get-caller-identity \
    --query 'Account' --output text
)"
echo "==> account=${ACCOUNT_ID}"
echo "==> applying tag: ${COST_TAG_KEY}=${COST_TAG_VALUE}"

apply_success=0
apply_skipped=0

tag_lambda() {
  local fn="$1"
  local arn
  if ! arn="$(
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" lambda get-function \
      --function-name "$fn" --query 'Configuration.FunctionArn' --output text 2>/dev/null
  )"; then
    echo "skip lambda: ${fn} (not found)"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  aws --profile "$AWS_PROFILE" --region "$AWS_REGION" lambda tag-resource \
    --resource "$arn" --tags "${COST_TAG_KEY}=${COST_TAG_VALUE}" >/dev/null
  echo "tagged lambda: ${fn}"
  apply_success=$((apply_success + 1))
}

tag_event_rule() {
  local rule="$1"
  local arn
  if ! arn="$(
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" events describe-rule \
      --name "$rule" --query 'Arn' --output text 2>/dev/null
  )"; then
    echo "skip event rule: ${rule} (not found)"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  aws --profile "$AWS_PROFILE" --region "$AWS_REGION" events tag-resource \
    --resource-arn "$arn" --tags "Key=${COST_TAG_KEY},Value=${COST_TAG_VALUE}" >/dev/null
  echo "tagged event rule: ${rule}"
  apply_success=$((apply_success + 1))
}

tag_sqs_queue() {
  local q="$1"
  local url
  if ! url="$(
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" sqs get-queue-url \
      --queue-name "$q" --query 'QueueUrl' --output text 2>/dev/null
  )"; then
    echo "skip sqs queue: ${q} (not found)"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  aws --profile "$AWS_PROFILE" --region "$AWS_REGION" sqs tag-queue \
    --queue-url "$url" --tags "${COST_TAG_KEY}=${COST_TAG_VALUE}" >/dev/null
  echo "tagged sqs queue: ${q}"
  apply_success=$((apply_success + 1))
}

tag_log_group() {
  local lg="$1"
  if ! aws --profile "$AWS_PROFILE" --region "$AWS_REGION" logs describe-log-groups \
      --log-group-name-prefix "$lg" --query 'logGroups[?logGroupName==`'"$lg"'`]|length(@)' \
      --output text 2>/dev/null | grep -q '^1$'; then
    echo "skip log group: ${lg} (not found)"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  aws --profile "$AWS_PROFILE" --region "$AWS_REGION" logs tag-log-group \
    --log-group-name "$lg" --tags "${COST_TAG_KEY}=${COST_TAG_VALUE}" >/dev/null
  echo "tagged log group: ${lg}"
  apply_success=$((apply_success + 1))
}

for fn in "${LAMBDA_FUNCTIONS[@]}"; do
  tag_lambda "$fn"
done

for rule in "${EVENT_RULES[@]}"; do
  tag_event_rule "$rule"
done

for q in "${SQS_QUEUES[@]}"; do
  tag_sqs_queue "$q"
done

for lg in "${LOG_GROUPS[@]}"; do
  tag_log_group "$lg"
done

# Amplify app
AMPLIFY_ARN="arn:aws:amplify:${AWS_REGION}:${ACCOUNT_ID}:apps/${AMPLIFY_APP_ID}"
if aws --profile "$AWS_PROFILE" --region "$AWS_REGION" amplify get-app \
  --app-id "$AMPLIFY_APP_ID" >/dev/null 2>&1; then
  aws --profile "$AWS_PROFILE" --region "$AWS_REGION" amplify tag-resource \
    --resource-arn "$AMPLIFY_ARN" --tags "${COST_TAG_KEY}=${COST_TAG_VALUE}" >/dev/null
  echo "tagged amplify app: ${AMPLIFY_APP_ID}"
  apply_success=$((apply_success + 1))
else
  echo "skip amplify app: ${AMPLIFY_APP_ID} (not found)"
  apply_skipped=$((apply_skipped + 1))
fi

# API Gateway HTTP API
API_ID="$(
  aws --profile "$AWS_PROFILE" --region "$AWS_REGION" apigatewayv2 get-apis \
    --query "Items[?Name=='${API_NAME}']|[0].ApiId" --output text 2>/dev/null || true
)"
if [[ -n "${API_ID}" && "${API_ID}" != "None" ]]; then
  API_ARN="arn:aws:apigateway:${AWS_REGION}::/apis/${API_ID}"
  aws --profile "$AWS_PROFILE" --region "$AWS_REGION" apigatewayv2 tag-resource \
    --resource-arn "$API_ARN" --tags "${COST_TAG_KEY}=${COST_TAG_VALUE}" >/dev/null
  echo "tagged http api: ${API_NAME} (${API_ID})"
  apply_success=$((apply_success + 1))
else
  echo "skip http api: ${API_NAME} (not found)"
  apply_skipped=$((apply_skipped + 1))
fi

# RDS instance
RDS_ARN="$(
  aws --profile "$AWS_PROFILE" --region "$AWS_REGION" rds describe-db-instances \
    --db-instance-identifier "$RDS_DB_IDENTIFIER" \
    --query 'DBInstances[0].DBInstanceArn' --output text 2>/dev/null || true
)"
if [[ -n "${RDS_ARN}" && "${RDS_ARN}" != "None" ]]; then
  aws --profile "$AWS_PROFILE" --region "$AWS_REGION" rds add-tags-to-resource \
    --resource-name "$RDS_ARN" \
    --tags "Key=${COST_TAG_KEY},Value=${COST_TAG_VALUE}" >/dev/null
  echo "tagged rds: ${RDS_DB_IDENTIFIER}"
  apply_success=$((apply_success + 1))
else
  echo "skip rds: ${RDS_DB_IDENTIFIER} (not found)"
  apply_skipped=$((apply_skipped + 1))
fi

# Secret
if aws --profile "$AWS_PROFILE" --region "$AWS_REGION" secretsmanager describe-secret \
  --secret-id "xmonitor/rds/app" >/dev/null 2>&1; then
  aws --profile "$AWS_PROFILE" --region "$AWS_REGION" secretsmanager tag-resource \
    --secret-id "xmonitor/rds/app" \
    --tags "Key=${COST_TAG_KEY},Value=${COST_TAG_VALUE}" >/dev/null
  echo "tagged secret: xmonitor/rds/app"
  apply_success=$((apply_success + 1))
else
  echo "skip secret: xmonitor/rds/app (not found)"
  apply_skipped=$((apply_skipped + 1))
fi

# EC2 network resources by Name tag
EC2_IDS="$(
  aws --profile "$AWS_PROFILE" --region "$AWS_REGION" ec2 describe-tags \
    --filters "Name=key,Values=Name" "Name=value,Values=$(IFS=,; echo "${EC2_NAME_TAGS[*]}")" \
    --query 'Tags[].ResourceId' --output text 2>/dev/null || true
)"
if [[ -n "${EC2_IDS}" && "${EC2_IDS}" != "None" ]]; then
  # shellcheck disable=SC2206
  IDS_ARRAY=(${EC2_IDS})
  if [[ ${#IDS_ARRAY[@]} -gt 0 ]]; then
    aws --profile "$AWS_PROFILE" --region "$AWS_REGION" ec2 create-tags \
      --resources "${IDS_ARRAY[@]}" \
      --tags "Key=${COST_TAG_KEY},Value=${COST_TAG_VALUE}" >/dev/null
    echo "tagged ec2 resources by Name match (${#IDS_ARRAY[@]} resources)"
    apply_success=$((apply_success + 1))
  fi
else
  echo "skip ec2 named resources (none found)"
  apply_skipped=$((apply_skipped + 1))
fi

echo "==> activating cost allocation tag in Cost Explorer: ${COST_TAG_KEY}"
aws --profile "$AWS_PROFILE" --region "$AWS_REGION" ce update-cost-allocation-tags-status \
  --cost-allocation-tags-status "TagKey=${COST_TAG_KEY},Status=Active" >/dev/null

echo "==> current cost allocation tag status:"
aws --profile "$AWS_PROFILE" --region "$AWS_REGION" ce list-cost-allocation-tags \
  --tag-keys "${COST_TAG_KEY}" \
  --type UserDefined \
  --query 'CostAllocationTags[].{TagKey:TagKey,Type:Type,Status:Status,LastUpdatedDate:LastUpdatedDate}' \
  --output table

echo
echo "Done."
echo "Tagged/updated: ${apply_success}"
echo "Skipped/not found: ${apply_skipped}"
echo "Note: newly activated cost-allocation tags can take up to 24 hours to appear in Cost Explorer reports."
