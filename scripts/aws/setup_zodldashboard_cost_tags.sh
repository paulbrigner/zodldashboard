#!/usr/bin/env bash
set -euo pipefail

# Apply a cost-allocation tag across the ZodlDashboard/XMonitor AWS system
# and activate the tag in Cost Explorer. The script starts with canonical
# resource names, then discovers matching resources so newer system pieces are
# pulled into the reporting scope.
#
# Usage:
#   AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
#   ./scripts/aws/setup_zodldashboard_cost_tags.sh
#
# Optional env:
#   COST_TAG_KEY=Project
#   COST_TAG_VALUE=ZodlDashboard
#   RESOURCE_NAME_PREFIXES="xmonitor zodldashboard"
#   AMPLIFY_APP_ID=d2rgmein7vsf2e
#   RDS_DB_IDENTIFIER=xmonitor-pg-beta
#   API_NAME=xmonitor-vpc-api
#   VPC_ID=vpc-1ee66a65
#   HOSTED_ZONE_NAMES=zodldashboard.com
#   SES_IDENTITIES=zodldashboard.com
#   DRY_RUN=true

AWS_PROFILE="${AWS_PROFILE:-zodldashboard}"
AWS_REGION="${AWS_REGION:-us-east-1}"
COST_TAG_KEY="${COST_TAG_KEY:-Project}"
COST_TAG_VALUE="${COST_TAG_VALUE:-ZodlDashboard}"
DRY_RUN="${DRY_RUN:-false}"
RESOURCE_NAME_PREFIXES="${RESOURCE_NAME_PREFIXES:-xmonitor zodldashboard}"
AMPLIFY_APP_ID="${AMPLIFY_APP_ID:-d2rgmein7vsf2e}"
RDS_DB_IDENTIFIER="${RDS_DB_IDENTIFIER:-xmonitor-pg-beta}"
API_NAME="${API_NAME:-xmonitor-vpc-api}"
VPC_ID="${VPC_ID:-vpc-1ee66a65}"
HOSTED_ZONE_NAMES="${HOSTED_ZONE_NAMES:-zodldashboard.com}"
SES_IDENTITIES="${SES_IDENTITIES:-zodldashboard.com}"
VPC_ENDPOINT_SERVICE_KEYWORDS="${VPC_ENDPOINT_SERVICE_KEYWORDS:-sqs}"

IFS=' ' read -r -a RESOURCE_PREFIX_ARRAY <<<"$(printf '%s' "$RESOURCE_NAME_PREFIXES" | tr ',' ' ')"
IFS=' ' read -r -a HOSTED_ZONE_ARRAY <<<"$(printf '%s' "$HOSTED_ZONE_NAMES" | tr ',' ' ')"
IFS=' ' read -r -a SES_IDENTITY_ARRAY <<<"$(printf '%s' "$SES_IDENTITIES" | tr ',' ' ')"
IFS=' ' read -r -a VPC_ENDPOINT_SERVICE_ARRAY <<<"$(printf '%s' "$VPC_ENDPOINT_SERVICE_KEYWORDS" | tr ',' ' ')"

LAMBDA_FUNCTIONS=(
  "xmonitor-vpc-api"
  "xmonitor-vpc-compose-worker"
  "xmonitor-vpc-email-scheduler"
  "xmonitor-xapi-priority-collector"
  "xmonitor-xapi-discovery-collector"
  "xmonitor-x-significance-classifier"
)

EVENT_RULES=(
  "xmonitor-xapi-priority-collector-15m"
  "xmonitor-xapi-discovery-collector-30m"
  "xmonitor-xapi-discovery-collector-60m"
  "xmonitor-x-significance-classifier-5m"
  "xmonitor-email-schedule-dispatch"
)

SCHEDULER_SCHEDULES=(
  "xmonitor-xapi-weekly-summary-6am-et"
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
  "/aws/lambda/xmonitor-x-significance-classifier"
)

EC2_NAME_TAGS=(
  "xmonitor-lambda-nat"
  "xmonitor-lambda-nat-eip"
  "xmonitor-lambda-private-rt"
)

SECURITY_GROUP_NAMES=(
  "xmonitor-api-lambda-sg"
  "xmonitor-rds-sg"
  "xmonitor-sqs-vpce-sg"
)

SECRETS=(
  "xmonitor/rds/app"
  "xmonitor/rds/master"
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

is_truthy() {
  local normalized
  normalized="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$normalized" in
    1|true|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

is_mutating_aws_call() {
  local service="${1:-}"
  local operation="${2:-}"
  case "${service} ${operation}" in
    "amplify tag-resource" | \
    "apigatewayv2 tag-resource" | \
    "ce update-cost-allocation-tags-status" | \
    "cloudwatch tag-resource" | \
    "ec2 create-tags" | \
    "events tag-resource" | \
    "lambda tag-resource" | \
    "logs tag-log-group" | \
    "rds add-tags-to-resource" | \
    "route53 change-tags-for-resource" | \
    "scheduler tag-resource" | \
    "secretsmanager tag-resource" | \
    "sesv2 tag-resource" | \
    "sqs tag-queue")
      return 0
      ;;
  esac
  return 1
}

aws_cli() {
  if is_truthy "$DRY_RUN" && is_mutating_aws_call "${1:-}" "${2:-}"; then
    printf 'dry-run: aws --profile %s --region %s' "$AWS_PROFILE" "$AWS_REGION" >&2
    printf ' %q' "$@" >&2
    printf '\n' >&2
    return 0
  fi
  aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"
}

if is_truthy "$DRY_RUN"; then
  echo "==> dry-run mode: mutating AWS calls will be printed, not applied"
fi

append_unique() {
  local array_name="$1"
  local item="$2"
  local existing
  local shell_opts="$-"
  local current=()
  [[ -z "$item" || "$item" == "None" ]] && return
  set +u
  eval "current=(\"\${${array_name}[@]}\")"
  for existing in "${current[@]}"; do
    if [[ "$existing" == "$item" ]]; then
      case "$shell_opts" in
        *u*) set -u ;;
      esac
      return
    fi
  done
  case "$shell_opts" in
    *u*) set -u ;;
  esac
  eval "${array_name}+=(\"\$item\")"
}

array_count() {
  local array_name="$1"
  local shell_opts="$-"
  local count
  set +u
  count="$(eval "printf '%s\n' \"\${${array_name}[@]}\"" | sed '/^$/d' | wc -l | tr -d ' ')"
  case "$shell_opts" in
    *u*) set -u ;;
  esac
  printf '%s' "$count"
}

append_lines() {
  local array_name="$1"
  local lines="$2"
  local line
  while IFS= read -r line; do
    append_unique "$array_name" "$line"
  done <<<"$lines"
}

prefix_query_contains() {
  local name="$1"
  local prefix
  for prefix in "${RESOURCE_PREFIX_ARRAY[@]}"; do
    [[ -n "$prefix" && "$name" == "$prefix"* ]] && return 0
  done
  return 1
}

discover_by_prefix() {
  local label="$1"
  local command_output="$2"
  local target_array="$3"
  local item
  while IFS= read -r item; do
    if prefix_query_contains "$item"; then
      append_unique "$target_array" "$item"
    fi
  done <<<"$command_output"
  echo "discovered ${label}: $(array_count "$target_array")"
}

discover_resources() {
  local names
  names="$(aws_cli lambda list-functions --query 'Functions[].FunctionName' --output text 2>/dev/null | tr '\t' '\n' || true)"
  discover_by_prefix "lambda functions" "$names" LAMBDA_FUNCTIONS

  names="$(aws_cli events list-rules --query 'Rules[].Name' --output text 2>/dev/null | tr '\t' '\n' || true)"
  discover_by_prefix "event rules" "$names" EVENT_RULES

  names="$(aws_cli scheduler list-schedules --query 'Schedules[].Name' --output text 2>/dev/null | tr '\t' '\n' || true)"
  discover_by_prefix "scheduler schedules" "$names" SCHEDULER_SCHEDULES

  names="$(aws_cli sqs list-queues --query 'QueueUrls[]' --output text 2>/dev/null | tr '\t' '\n' | sed 's#.*/##' || true)"
  discover_by_prefix "sqs queues" "$names" SQS_QUEUES

  names="$(aws_cli logs describe-log-groups --log-group-name-prefix /aws/lambda/xmonitor --query 'logGroups[].logGroupName' --output text 2>/dev/null | tr '\t' '\n' || true)"
  append_lines LOG_GROUPS "$names"
  names="$(aws_cli logs describe-log-groups --log-group-name-prefix /aws/lambda/zodldashboard --query 'logGroups[].logGroupName' --output text 2>/dev/null | tr '\t' '\n' || true)"
  append_lines LOG_GROUPS "$names"

  names="$(aws_cli cloudwatch describe-alarms --query 'MetricAlarms[].AlarmName' --output text 2>/dev/null | tr '\t' '\n' || true)"
  discover_by_prefix "cloudwatch alarms" "$names" CLOUDWATCH_ALARMS

  names="$(aws_cli cloudwatch list-dashboards --query 'DashboardEntries[].DashboardName' --output text 2>/dev/null | tr '\t' '\n' || true)"
  discover_by_prefix "cloudwatch dashboards" "$names" CLOUDWATCH_DASHBOARDS

  names="$(aws_cli secretsmanager list-secrets --query 'SecretList[].Name' --output text 2>/dev/null | tr '\t' '\n' || true)"
  discover_by_prefix "secrets" "$names" SECRETS

  names="$(aws_cli apigatewayv2 get-apis --query 'Items[].Name' --output text 2>/dev/null | tr '\t' '\n' || true)"
  discover_by_prefix "http apis" "$names" API_NAMES

  names="$(aws_cli rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier' --output text 2>/dev/null | tr '\t' '\n' || true)"
  discover_by_prefix "rds db instances" "$names" RDS_DB_IDENTIFIERS

  names="$(aws_cli sesv2 list-email-identities --query 'EmailIdentities[].IdentityName' --output text 2>/dev/null | tr '\t' '\n' || true)"
  while IFS= read -r item; do
    [[ "$item" == *zodl* || "$item" == *Zodl* ]] && append_unique SES_IDENTITY_ARRAY "$item"
  done <<<"$names"
  return 0
}

tag_lambda() {
  local fn="$1"
  local arn
  if ! arn="$(
    aws_cli lambda get-function \
      --function-name "$fn" --query 'Configuration.FunctionArn' --output text 2>/dev/null
  )"; then
    echo "skip lambda: ${fn} (not found)"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  aws_cli lambda tag-resource \
    --resource "$arn" --tags "${COST_TAG_KEY}=${COST_TAG_VALUE}" >/dev/null
  echo "tagged lambda: ${fn}"
  apply_success=$((apply_success + 1))
}

tag_event_rule() {
  local rule="$1"
  local arn
  if ! arn="$(
    aws_cli events describe-rule \
      --name "$rule" --query 'Arn' --output text 2>/dev/null
  )"; then
    echo "skip event rule: ${rule} (not found)"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  aws_cli events tag-resource \
    --resource-arn "$arn" --tags "Key=${COST_TAG_KEY},Value=${COST_TAG_VALUE}" >/dev/null
  echo "tagged event rule: ${rule}"
  apply_success=$((apply_success + 1))
}

tag_scheduler_schedule() {
  local schedule="$1"
  local group_name
  group_name="$(
    aws_cli scheduler get-schedule \
      --name "$schedule" --group-name default --query 'GroupName' --output text 2>/dev/null || true
  )"
  if [[ -z "$group_name" || "$group_name" == "None" ]]; then
    echo "skip scheduler schedule: ${schedule} (not found)"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  local arn="arn:aws:scheduler:${AWS_REGION}:${ACCOUNT_ID}:schedule-group/${group_name}"
  aws_cli scheduler tag-resource \
    --resource-arn "$arn" --tags "Key=${COST_TAG_KEY},Value=${COST_TAG_VALUE}" >/dev/null
  echo "tagged scheduler schedule group: ${group_name} (via ${schedule})"
  apply_success=$((apply_success + 1))
}

tag_sqs_queue() {
  local q="$1"
  local url
  if ! url="$(
    aws_cli sqs get-queue-url \
      --queue-name "$q" --query 'QueueUrl' --output text 2>/dev/null
  )"; then
    echo "skip sqs queue: ${q} (not found)"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  aws_cli sqs tag-queue \
    --queue-url "$url" --tags "${COST_TAG_KEY}=${COST_TAG_VALUE}" >/dev/null
  echo "tagged sqs queue: ${q}"
  apply_success=$((apply_success + 1))
}

tag_log_group() {
  local lg="$1"
  if ! aws_cli logs describe-log-groups \
      --log-group-name-prefix "$lg" --query 'logGroups[?logGroupName==`'"$lg"'`]|length(@)' \
      --output text 2>/dev/null | grep -q '^1$'; then
    echo "skip log group: ${lg} (not found)"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  aws_cli logs tag-log-group \
    --log-group-name "$lg" --tags "${COST_TAG_KEY}=${COST_TAG_VALUE}" >/dev/null
  echo "tagged log group: ${lg}"
  apply_success=$((apply_success + 1))
}

tag_cloudwatch_alarm() {
  local alarm="$1"
  local arn
  arn="$(
    aws_cli cloudwatch describe-alarms \
      --alarm-names "$alarm" --query 'MetricAlarms[0].AlarmArn' --output text 2>/dev/null || true
  )"
  if [[ -z "$arn" || "$arn" == "None" ]]; then
    echo "skip cloudwatch alarm: ${alarm} (not found)"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  aws_cli cloudwatch tag-resource \
    --resource-arn "$arn" --tags "Key=${COST_TAG_KEY},Value=${COST_TAG_VALUE}" >/dev/null
  echo "tagged cloudwatch alarm: ${alarm}"
  apply_success=$((apply_success + 1))
}

tag_cloudwatch_dashboard() {
  local dashboard="$1"
  if ! aws_cli cloudwatch get-dashboard --dashboard-name "$dashboard" >/dev/null 2>&1; then
    echo "skip cloudwatch dashboard: ${dashboard} (not found)"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  aws_cli cloudwatch tag-resource \
    --resource-arn "arn:aws:cloudwatch::${ACCOUNT_ID}:dashboard/${dashboard}" \
    --tags "Key=${COST_TAG_KEY},Value=${COST_TAG_VALUE}" >/dev/null
  echo "tagged cloudwatch dashboard: ${dashboard}"
  apply_success=$((apply_success + 1))
}

tag_amplify_app() {
  local app_id="$1"
  local arn="arn:aws:amplify:${AWS_REGION}:${ACCOUNT_ID}:apps/${app_id}"
  if aws_cli amplify get-app --app-id "$app_id" >/dev/null 2>&1; then
    aws_cli amplify tag-resource \
      --resource-arn "$arn" --tags "${COST_TAG_KEY}=${COST_TAG_VALUE}" >/dev/null
    echo "tagged amplify app: ${app_id}"
    apply_success=$((apply_success + 1))
  else
    echo "skip amplify app: ${app_id} (not found)"
    apply_skipped=$((apply_skipped + 1))
  fi
}

tag_http_api() {
  local api_name="$1"
  local api_id stage_names stage
  api_id="$(
    aws_cli apigatewayv2 get-apis \
      --query "Items[?Name=='${api_name}']|[0].ApiId" --output text 2>/dev/null || true
  )"
  if [[ -z "${api_id}" || "${api_id}" == "None" ]]; then
    echo "skip http api: ${api_name} (not found)"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  aws_cli apigatewayv2 tag-resource \
    --resource-arn "arn:aws:apigateway:${AWS_REGION}::/apis/${api_id}" \
    --tags "${COST_TAG_KEY}=${COST_TAG_VALUE}" >/dev/null
  echo "tagged http api: ${api_name} (${api_id})"
  apply_success=$((apply_success + 1))

  stage_names="$(aws_cli apigatewayv2 get-stages --api-id "$api_id" --query 'Items[].StageName' --output text 2>/dev/null | tr '\t' '\n' || true)"
  while IFS= read -r stage; do
    [[ -z "$stage" || "$stage" == "None" ]] && continue
    aws_cli apigatewayv2 tag-resource \
      --resource-arn "arn:aws:apigateway:${AWS_REGION}::/apis/${api_id}/stages/${stage}" \
      --tags "${COST_TAG_KEY}=${COST_TAG_VALUE}" >/dev/null || true
    echo "tagged http api stage: ${api_name}/${stage}"
  done <<<"$stage_names"
}

tag_rds_instance() {
  local db_identifier="$1"
  local arn
  arn="$(
    aws_cli rds describe-db-instances \
      --db-instance-identifier "$db_identifier" \
      --query 'DBInstances[0].DBInstanceArn' --output text 2>/dev/null || true
  )"
  if [[ -z "${arn}" || "${arn}" == "None" ]]; then
    echo "skip rds: ${db_identifier} (not found)"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  aws_cli rds add-tags-to-resource \
    --resource-name "$arn" \
    --tags "Key=${COST_TAG_KEY},Value=${COST_TAG_VALUE}" >/dev/null
  echo "tagged rds: ${db_identifier}"
  apply_success=$((apply_success + 1))
}

tag_secret() {
  local secret_id="$1"
  if aws_cli secretsmanager describe-secret --secret-id "$secret_id" >/dev/null 2>&1; then
    aws_cli secretsmanager tag-resource \
      --secret-id "$secret_id" \
      --tags "Key=${COST_TAG_KEY},Value=${COST_TAG_VALUE}" >/dev/null
    echo "tagged secret: ${secret_id}"
    apply_success=$((apply_success + 1))
  else
    echo "skip secret: ${secret_id} (not found)"
    apply_skipped=$((apply_skipped + 1))
  fi
}

tag_ses_identity() {
  local identity="$1"
  local arn="arn:aws:ses:${AWS_REGION}:${ACCOUNT_ID}:identity/${identity}"
  if aws_cli sesv2 get-email-identity --email-identity "$identity" >/dev/null 2>&1; then
    aws_cli sesv2 tag-resource \
      --resource-arn "$arn" \
      --tags "Key=${COST_TAG_KEY},Value=${COST_TAG_VALUE}" >/dev/null
    echo "tagged ses identity: ${identity}"
    apply_success=$((apply_success + 1))
  else
    echo "skip ses identity: ${identity} (not found)"
    apply_skipped=$((apply_skipped + 1))
  fi
}

tag_hosted_zone() {
  local zone_name="$1"
  local zone_id
  zone_name="${zone_name%.}."
  zone_id="$(
    aws_cli route53 list-hosted-zones-by-name \
      --dns-name "$zone_name" \
      --query "HostedZones[?Name=='${zone_name}']|[0].Id" --output text 2>/dev/null || true
  )"
  if [[ -z "$zone_id" || "$zone_id" == "None" ]]; then
    echo "skip hosted zone: ${zone_name} (not found)"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  zone_id="${zone_id#/hostedzone/}"
  aws_cli route53 change-tags-for-resource \
    --resource-type hostedzone \
    --resource-id "$zone_id" \
    --add-tags "Key=${COST_TAG_KEY},Value=${COST_TAG_VALUE}" >/dev/null
  echo "tagged hosted zone: ${zone_name}"
  apply_success=$((apply_success + 1))
}

tag_ec2_resource_ids() {
  local label="$1"
  shift
  local ids=("$@")
  if [[ ${#ids[@]} -eq 0 ]]; then
    echo "skip ${label} (none found)"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  aws_cli ec2 create-tags \
    --resources "${ids[@]}" \
    --tags "Key=${COST_TAG_KEY},Value=${COST_TAG_VALUE}" >/dev/null
  echo "tagged ${label} (${#ids[@]} resources)"
  apply_success=$((apply_success + 1))
}

tag_ec2_resources_by_name() {
  local names="$1"
  local ids
  ids="$(
    aws_cli ec2 describe-tags \
      --filters "Name=key,Values=Name" "Name=value,Values=${names}" \
      --query 'Tags[].ResourceId' --output text 2>/dev/null || true
  )"
  if [[ -z "${ids}" || "${ids}" == "None" ]]; then
    echo "skip ec2 named resources (${names})"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  # shellcheck disable=SC2206
  local ids_array=(${ids})
  tag_ec2_resource_ids "ec2 resources by Name match" "${ids_array[@]}"
}

tag_security_groups() {
  local group_names="$1"
  local ids
  ids="$(
    aws_cli ec2 describe-security-groups \
      --filters "Name=group-name,Values=${group_names}" \
      --query 'SecurityGroups[].GroupId' --output text 2>/dev/null || true
  )"
  if [[ -z "${ids}" || "${ids}" == "None" ]]; then
    echo "skip security groups (${group_names})"
    apply_skipped=$((apply_skipped + 1))
    return
  fi
  # shellcheck disable=SC2206
  local ids_array=(${ids})
  tag_ec2_resource_ids "security groups" "${ids_array[@]}"
}

tag_vpc_endpoints() {
  local keyword query ids
  for keyword in "${VPC_ENDPOINT_SERVICE_ARRAY[@]}"; do
    [[ -z "$keyword" ]] && continue
    query="VpcEndpoints[?contains(ServiceName, \`${keyword}\`)].VpcEndpointId"
    ids="$(
      aws_cli ec2 describe-vpc-endpoints \
        --filters "Name=vpc-id,Values=${VPC_ID}" \
        --query "$query" --output text 2>/dev/null || true
    )"
    if [[ -z "${ids}" || "${ids}" == "None" ]]; then
      echo "skip vpc endpoints for service keyword: ${keyword}"
      apply_skipped=$((apply_skipped + 1))
      continue
    fi
    # shellcheck disable=SC2206
    local ids_array=(${ids})
    tag_ec2_resource_ids "vpc endpoints (${keyword})" "${ids_array[@]}"
  done
}

API_NAMES=("$API_NAME")
RDS_DB_IDENTIFIERS=("$RDS_DB_IDENTIFIER")
CLOUDWATCH_ALARMS=()
CLOUDWATCH_DASHBOARDS=()
discover_resources

for fn in "${LAMBDA_FUNCTIONS[@]}"; do
  tag_lambda "$fn"
done

for rule in "${EVENT_RULES[@]}"; do
  tag_event_rule "$rule"
done

for schedule in "${SCHEDULER_SCHEDULES[@]}"; do
  tag_scheduler_schedule "$schedule"
done

for q in "${SQS_QUEUES[@]}"; do
  tag_sqs_queue "$q"
done

for lg in "${LOG_GROUPS[@]}"; do
  tag_log_group "$lg"
done

if [[ "$(array_count CLOUDWATCH_ALARMS)" != "0" ]]; then
  for alarm in "${CLOUDWATCH_ALARMS[@]}"; do
    tag_cloudwatch_alarm "$alarm"
  done
fi

if [[ "$(array_count CLOUDWATCH_DASHBOARDS)" != "0" ]]; then
  for dashboard in "${CLOUDWATCH_DASHBOARDS[@]}"; do
    tag_cloudwatch_dashboard "$dashboard"
  done
fi

tag_amplify_app "$AMPLIFY_APP_ID"

for api_name in "${API_NAMES[@]}"; do
  tag_http_api "$api_name"
done

for db_identifier in "${RDS_DB_IDENTIFIERS[@]}"; do
  tag_rds_instance "$db_identifier"
done

for secret_id in "${SECRETS[@]}"; do
  tag_secret "$secret_id"
done

for identity in "${SES_IDENTITY_ARRAY[@]}"; do
  tag_ses_identity "$identity"
done

for hosted_zone in "${HOSTED_ZONE_ARRAY[@]}"; do
  tag_hosted_zone "$hosted_zone"
done

tag_ec2_resources_by_name "$(IFS=,; echo "${EC2_NAME_TAGS[*]}")"
tag_security_groups "$(IFS=,; echo "${SECURITY_GROUP_NAMES[*]}")"
tag_vpc_endpoints

echo "==> activating cost allocation tag in Cost Explorer: ${COST_TAG_KEY}"
aws_cli ce update-cost-allocation-tags-status \
  --cost-allocation-tags-status "TagKey=${COST_TAG_KEY},Status=Active" >/dev/null

echo "==> current cost allocation tag status:"
aws_cli ce list-cost-allocation-tags \
  --tag-keys "${COST_TAG_KEY}" \
  --type UserDefined \
  --query 'CostAllocationTags[].{TagKey:TagKey,Type:Type,Status:Status,LastUpdatedDate:LastUpdatedDate}' \
  --output table

echo
echo "Done."
if is_truthy "$DRY_RUN"; then
  echo "Dry-run planned tag/update operations: ${apply_success}"
else
  echo "Tagged/updated: ${apply_success}"
fi
echo "Skipped/not found: ${apply_skipped}"
echo "Note: newly activated cost-allocation tags can take up to 24 hours to appear in Cost Explorer reports."
