#!/usr/bin/env bash
set -euo pipefail

# Provision/update discovery-mode X API collector Lambda + EventBridge schedule.
#
# Defaults are tuned for continuous discovery ingestion (no shadow mode).
# Override any value by exporting env vars before invoking this script.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

export LAMBDA_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-xmonitor-xapi-discovery-collector}"
export LAMBDA_ROLE_NAME="${LAMBDA_ROLE_NAME:-xmonitor-xapi-discovery-collector-role}"
export EVENT_RULE_NAME="${EVENT_RULE_NAME:-xmonitor-xapi-discovery-collector-60m}"
export SCHEDULE_EXPRESSION="${SCHEDULE_EXPRESSION:-rate(60 minutes)}"
export COLLECTOR_MODE="${COLLECTOR_MODE:-discovery}"
export COLLECTOR_SOURCE="${COLLECTOR_SOURCE:-aws-lambda-x-api-discovery}"
export X_API_REPLY_CAPTURE_ENABLED="${X_API_REPLY_CAPTURE_ENABLED:-false}"

exec "$ROOT_DIR/scripts/aws/provision_x_api_collector_lambda.sh"
