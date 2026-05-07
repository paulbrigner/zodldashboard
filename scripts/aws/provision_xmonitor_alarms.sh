#!/usr/bin/env bash
set -euo pipefail

# Provision CloudWatch alarms for the X Monitor scheduled ingestion pipeline.
#
# Usage:
#   AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
#   ./scripts/aws/provision_xmonitor_alarms.sh
#
# Optional env:
#   ALERT_TOPIC_NAME=xmonitor-alerts
#   ALERT_EMAIL=aws-alarm@mail.zyprpnk.com  # SNS email subscriptions require recipient confirmation
#   EXTRA_ALARM_ACTION_ARNS=arn:aws:sns:...    # comma-separated additional action ARNs

AWS_REGION="${AWS_REGION:-us-east-1}"
ALERT_TOPIC_NAME="${ALERT_TOPIC_NAME:-xmonitor-alerts}"
ALERT_EMAIL="${ALERT_EMAIL:-aws-alarm@mail.zyprpnk.com}"
EXTRA_ALARM_ACTION_ARNS="${EXTRA_ALARM_ACTION_ARNS:-}"

PRIORITY_FUNCTION_NAME="${PRIORITY_FUNCTION_NAME:-xmonitor-xapi-priority-collector}"
DISCOVERY_FUNCTION_NAME="${DISCOVERY_FUNCTION_NAME:-xmonitor-xapi-discovery-collector}"
CLASSIFIER_FUNCTION_NAME="${CLASSIFIER_FUNCTION_NAME:-xmonitor-x-significance-classifier}"

aws_cli() {
  AWS_REGION="$AWS_REGION" aws "$@"
}

echo "==> Ensuring SNS topic: $ALERT_TOPIC_NAME"
ALERT_TOPIC_ARN="$(aws_cli sns create-topic --name "$ALERT_TOPIC_NAME" --query 'TopicArn' --output text)"

if [[ -n "$ALERT_EMAIL" ]]; then
  echo "==> Ensuring SNS email subscription for $ALERT_EMAIL"
  aws_cli sns subscribe \
    --topic-arn "$ALERT_TOPIC_ARN" \
    --protocol email \
    --notification-endpoint "$ALERT_EMAIL" >/dev/null
fi

ALARM_ACTIONS=("$ALERT_TOPIC_ARN")
if [[ -n "$EXTRA_ALARM_ACTION_ARNS" ]]; then
  IFS=',' read -r -a EXTRA_ACTIONS <<<"$EXTRA_ALARM_ACTION_ARNS"
  for action_arn in "${EXTRA_ACTIONS[@]}"; do
    if [[ -n "$action_arn" ]]; then
      ALARM_ACTIONS+=("$action_arn")
    fi
  done
fi

put_lambda_error_alarm() {
  local function_name="$1"
  local alarm_name="$2"
  local description="$3"

  aws_cli cloudwatch put-metric-alarm \
    --alarm-name "$alarm_name" \
    --alarm-description "$description" \
    --namespace AWS/Lambda \
    --metric-name Errors \
    --dimensions "Name=FunctionName,Value=$function_name" \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 1 \
    --datapoints-to-alarm 1 \
    --threshold 0 \
    --comparison-operator GreaterThanThreshold \
    --treat-missing-data notBreaching \
    --alarm-actions "${ALARM_ACTIONS[@]}"
}

put_lambda_throttle_alarm() {
  local function_name="$1"
  local alarm_name="$2"
  local description="$3"

  aws_cli cloudwatch put-metric-alarm \
    --alarm-name "$alarm_name" \
    --alarm-description "$description" \
    --namespace AWS/Lambda \
    --metric-name Throttles \
    --dimensions "Name=FunctionName,Value=$function_name" \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 1 \
    --datapoints-to-alarm 1 \
    --threshold 0 \
    --comparison-operator GreaterThanThreshold \
    --treat-missing-data notBreaching \
    --alarm-actions "${ALARM_ACTIONS[@]}"
}

put_lambda_heartbeat_alarm() {
  local function_name="$1"
  local alarm_name="$2"
  local period_seconds="$3"
  local description="$4"

  aws_cli cloudwatch put-metric-alarm \
    --alarm-name "$alarm_name" \
    --alarm-description "$description" \
    --namespace AWS/Lambda \
    --metric-name Invocations \
    --dimensions "Name=FunctionName,Value=$function_name" \
    --statistic Sum \
    --period "$period_seconds" \
    --evaluation-periods 1 \
    --datapoints-to-alarm 1 \
    --threshold 1 \
    --comparison-operator LessThanThreshold \
    --treat-missing-data breaching \
    --alarm-actions "${ALARM_ACTIONS[@]}"
}

echo "==> Creating/updating Lambda error alarms"
put_lambda_error_alarm \
  "$PRIORITY_FUNCTION_NAME" \
  "xmonitor-xapi-priority-collector-errors" \
  "$PRIORITY_FUNCTION_NAME reported Lambda Errors. This can stop watched-handle ingestion."

put_lambda_error_alarm \
  "$DISCOVERY_FUNCTION_NAME" \
  "xmonitor-xapi-discovery-collector-errors" \
  "$DISCOVERY_FUNCTION_NAME reported Lambda Errors. This can stop discovery ingestion."

put_lambda_error_alarm \
  "$CLASSIFIER_FUNCTION_NAME" \
  "xmonitor-x-significance-classifier-errors" \
  "$CLASSIFIER_FUNCTION_NAME reported Lambda Errors. This can delay significance classification."

echo "==> Creating/updating Lambda throttle alarms"
put_lambda_throttle_alarm \
  "$PRIORITY_FUNCTION_NAME" \
  "xmonitor-xapi-priority-collector-throttles" \
  "$PRIORITY_FUNCTION_NAME was throttled."

put_lambda_throttle_alarm \
  "$DISCOVERY_FUNCTION_NAME" \
  "xmonitor-xapi-discovery-collector-throttles" \
  "$DISCOVERY_FUNCTION_NAME was throttled."

put_lambda_throttle_alarm \
  "$CLASSIFIER_FUNCTION_NAME" \
  "xmonitor-x-significance-classifier-throttles" \
  "$CLASSIFIER_FUNCTION_NAME was throttled."

echo "==> Creating/updating scheduled collector heartbeat alarms"
put_lambda_heartbeat_alarm \
  "$PRIORITY_FUNCTION_NAME" \
  "xmonitor-xapi-priority-collector-no-invocations" \
  1800 \
  "$PRIORITY_FUNCTION_NAME had no Lambda invocations in 30 minutes. The 15-minute EventBridge schedule may be disabled or broken."

put_lambda_heartbeat_alarm \
  "$DISCOVERY_FUNCTION_NAME" \
  "xmonitor-xapi-discovery-collector-no-invocations" \
  3600 \
  "$DISCOVERY_FUNCTION_NAME had no Lambda invocations in 60 minutes. The 30-minute EventBridge schedule may be disabled or broken."

echo ""
echo "Provisioned X Monitor alarms."
echo "  SNS topic: $ALERT_TOPIC_ARN"
printf '  Actions:   %s\n' "${ALARM_ACTIONS[*]}"
