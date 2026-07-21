#!/usr/bin/env bash
set -euo pipefail

# Safely update only the deployed code for the X Monitor API, compose worker,
# and scheduler Lambdas. This intentionally leaves environment variables, IAM,
# VPC configuration, SQS mappings, EventBridge, and API Gateway untouched.
#
# Usage:
#   AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
#     ./scripts/aws/deploy_vpc_api_lambda_code_only.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAMBDA_DIR="$ROOT_DIR/services/vpc-api-lambda"
AWS_REGION="${AWS_REGION:-us-east-1}"
API_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-xmonitor-vpc-api}"
WORKER_FUNCTION_NAME="${COMPOSE_WORKER_FUNCTION_NAME:-xmonitor-vpc-compose-worker}"
SCHEDULER_FUNCTION_NAME="${EMAIL_SCHEDULER_FUNCTION_NAME:-xmonitor-vpc-email-scheduler}"

aws_cli() {
  AWS_REGION="$AWS_REGION" aws "$@"
}

BUILD_DIR="$(mktemp -d)"
cleanup_build_dir() {
  rm -rf "$BUILD_DIR"
}
trap cleanup_build_dir EXIT

cp "$LAMBDA_DIR/index.mjs" "$LAMBDA_DIR/package.json" "$LAMBDA_DIR/package-lock.json" "$BUILD_DIR/"
pushd "$BUILD_DIR" >/dev/null
npm ci --omit=dev >/dev/null
popd >/dev/null

mkdir -p "$BUILD_DIR/shared/xmonitor" "$BUILD_DIR/shared/cipherpay-test" "$BUILD_DIR/config/xmonitor" "$BUILD_DIR/db/migrations"
cp "$ROOT_DIR/shared/xmonitor/ingest-policy.mjs" "$BUILD_DIR/shared/xmonitor/ingest-policy.mjs"
cp "$ROOT_DIR/shared/xmonitor/summary-taxonomy.mjs" "$BUILD_DIR/shared/xmonitor/summary-taxonomy.mjs"
cp "$ROOT_DIR/shared/xmonitor/summary-trends.mjs" "$BUILD_DIR/shared/xmonitor/summary-trends.mjs"
cp "$ROOT_DIR/shared/xmonitor/text-filter.mjs" "$BUILD_DIR/shared/xmonitor/text-filter.mjs"
cp "$ROOT_DIR/shared/cipherpay-test/catalog.mjs" "$BUILD_DIR/shared/cipherpay-test/catalog.mjs"
cp "$ROOT_DIR/shared/cipherpay-test/webhook.mjs" "$BUILD_DIR/shared/cipherpay-test/webhook.mjs"
cp "$ROOT_DIR/config/xmonitor/omit-handles.json" "$BUILD_DIR/config/xmonitor/omit-handles.json"
cp "$ROOT_DIR/db/migrations/"*.sql "$BUILD_DIR/db/migrations/"

PACKAGE_ZIP="$BUILD_DIR/function.zip"
pushd "$BUILD_DIR" >/dev/null
zip -qr "$PACKAGE_ZIP" . -x 'function.zip'
popd >/dev/null

for function_name in "$API_FUNCTION_NAME" "$WORKER_FUNCTION_NAME" "$SCHEDULER_FUNCTION_NAME"; do
  echo "==> Updating code only: $function_name"
  aws_cli lambda get-function --function-name "$function_name" >/dev/null
  aws_cli lambda update-function-code \
    --function-name "$function_name" \
    --zip-file "fileb://$PACKAGE_ZIP" >/dev/null
  aws_cli lambda wait function-updated --function-name "$function_name"
done

echo "Code-only Lambda update complete; runtime configuration was not changed."
