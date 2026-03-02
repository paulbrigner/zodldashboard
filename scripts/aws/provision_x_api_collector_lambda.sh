#!/usr/bin/env bash
set -euo pipefail

# Provision/update X API collector Lambda + EventBridge schedule.
#
# Usage:
#   AWS_PROFILE=zodldashboard AWS_REGION=us-east-1 \
#   X_API_BEARER_TOKEN='...' \
#   ./scripts/aws/provision_x_api_collector_lambda.sh
#
# Optional env:
#   LAMBDA_FUNCTION_NAME=xmonitor-xapi-priority-collector
#   LAMBDA_ROLE_NAME=xmonitor-xapi-priority-collector-role
#   EVENT_RULE_NAME=xmonitor-xapi-priority-collector-15m
#   SCHEDULE_EXPRESSION='rate(15 minutes)'
#   SCHEDULE_ENABLED=true
#   DB_SECRET_ID=xmonitor/rds/app
#   INGEST_API_BASE_URL=https://www.zodldashboard.com/api/v1
#   INGEST_API_KEY=...                         # fallback from DB secret ingest_shared_secret
#   X_API_BASE_URL=https://api.x.com/2
#   X_API_CONSUMER_KEY=...
#   X_API_CONSUMER_SECRET=...
#   X_API_REFRESH_BEARER_FROM_CONSUMER=true    # force refresh bearer from consumer key/secret
#   X_API_MAX_RESULTS_PER_QUERY=100
#   X_API_MAX_PAGES_PER_QUERY=2
#   X_API_HANDLE_CHUNK_SIZE=16
#   X_API_REPLY_CAPTURE_ENABLED=true
#   X_API_REPLY_MODE=term_constrained          # off|term_constrained|selected_handles
#   X_API_REPLY_TIERS=teammate,influencer,ecosystem
#   X_API_REPLY_SELECTED_HANDLES=
#   X_API_BASE_TERMS='Zcash OR ZEC OR Zodl OR #ZODL OR Zashi'
#   X_API_ENFORCE_LANG_ALLOWLIST=true
#   X_API_LANG_ALLOWLIST=en
#   X_API_EXCLUDE_RETWEETS=true
#   X_API_EXCLUDE_QUOTES=false
#   EMBEDDING_ENABLED=true
#   EMBEDDING_BASE_URL=https://api.venice.ai/api/v1
#   EMBEDDING_MODEL=text-embedding-bge-m3
#   EMBEDDING_DIMS=1024
#   EMBEDDING_TIMEOUT_MS=10000
#   EMBEDDING_API_KEY=...                      # fallback from DB secret embedding_api_key/venice_api_key
#   EMBEDDING_BATCH_SIZE=16
#   EMBEDDING_MAX_ITEMS_PER_RUN=0              # 0 = no cap
#   EMBEDDING_INCLUDE_UPDATED=false
#   EMBEDDING_FALLBACK_ALL_IF_NO_IDS=false
#   COLLECTOR_ENABLED=true
#   COLLECTOR_WRITE_ENABLED=true
#   COLLECTOR_DRY_RUN=false
#   COLLECTOR_SOURCE=aws-lambda-x-api
#   COLLECTOR_MODE=priority                  # priority|discovery
#   XMONITOR_INGEST_OMIT_HANDLES=...         # comma/space-separated handles (discovery omit gate)
#   SUMMARY_ENABLED=true                     # rolling 2h/12h summary generation (discovery mode)
#   SUMMARY_ALIGN_HOURS=2
#   SUMMARY_TOP_POSTS_2H=8
#   SUMMARY_TOP_POSTS_12H=8
#   SUMMARY_FEED_PAGE_LIMIT=20
#   SUMMARY_FEED_MAX_ITEMS_PER_WINDOW=2000
#   SUMMARY_LLM_BACKEND=auto                 # auto|openai|none
#   SUMMARY_LLM_URL=https://api.venice.ai/api/v1
#   SUMMARY_LLM_MODEL=zai-org-glm-5
#   SUMMARY_LLM_API_KEY=...                  # fallback from EMBEDDING_API_KEY
#   SUMMARY_LLM_TEMPERATURE=0.45
#   SUMMARY_LLM_MAX_TOKENS=420
#   SUMMARY_LLM_TIMEOUT_MS=120000
#   SUMMARY_LLM_MAX_ATTEMPTS=3
#   SUMMARY_LLM_INITIAL_BACKOFF_MS=1000
#   WATCHLIST_TIERS_JSON='{"handle":"tier"}'
#   WATCHLIST_INCLUDE_HANDLES='handle1,handle2'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAMBDA_DIR="$ROOT_DIR/services/x-api-collector-lambda"

AWS_REGION="${AWS_REGION:-us-east-1}"
LAMBDA_FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-xmonitor-xapi-priority-collector}"
LAMBDA_ROLE_NAME="${LAMBDA_ROLE_NAME:-xmonitor-xapi-priority-collector-role}"
EVENT_RULE_NAME="${EVENT_RULE_NAME:-xmonitor-xapi-priority-collector-15m}"
SCHEDULE_EXPRESSION="${SCHEDULE_EXPRESSION:-rate(15 minutes)}"
SCHEDULE_ENABLED="${SCHEDULE_ENABLED:-true}"
DB_SECRET_ID="${DB_SECRET_ID:-xmonitor/rds/app}"

INGEST_API_BASE_URL="${INGEST_API_BASE_URL:-https://www.zodldashboard.com/api/v1}"
INGEST_API_KEY="${INGEST_API_KEY:-}"
X_API_BEARER_TOKEN="${X_API_BEARER_TOKEN:-}"
X_API_BASE_URL="${X_API_BASE_URL:-https://api.x.com/2}"
X_API_CONSUMER_KEY="${X_API_CONSUMER_KEY:-}"
X_API_CONSUMER_SECRET="${X_API_CONSUMER_SECRET:-}"
X_API_REFRESH_BEARER_FROM_CONSUMER="${X_API_REFRESH_BEARER_FROM_CONSUMER:-false}"
X_API_MAX_RESULTS_PER_QUERY="${X_API_MAX_RESULTS_PER_QUERY:-100}"
X_API_MAX_PAGES_PER_QUERY="${X_API_MAX_PAGES_PER_QUERY:-2}"
X_API_HANDLE_CHUNK_SIZE="${X_API_HANDLE_CHUNK_SIZE:-16}"
X_API_REPLY_CAPTURE_ENABLED="${X_API_REPLY_CAPTURE_ENABLED:-true}"
X_API_REPLY_MODE="${X_API_REPLY_MODE:-term_constrained}"
X_API_REPLY_TIERS="${X_API_REPLY_TIERS:-teammate,influencer,ecosystem}"
X_API_REPLY_SELECTED_HANDLES="${X_API_REPLY_SELECTED_HANDLES:-}"
X_API_BASE_TERMS="${X_API_BASE_TERMS:-Zcash OR ZEC OR Zodl OR #ZODL OR Zashi}"
X_API_ENFORCE_LANG_ALLOWLIST="${X_API_ENFORCE_LANG_ALLOWLIST:-true}"
X_API_LANG_ALLOWLIST="${X_API_LANG_ALLOWLIST:-en}"
X_API_EXCLUDE_RETWEETS="${X_API_EXCLUDE_RETWEETS:-true}"
X_API_EXCLUDE_QUOTES="${X_API_EXCLUDE_QUOTES:-false}"
X_API_QUERY_TIMEOUT_MS="${X_API_QUERY_TIMEOUT_MS:-15000}"
X_API_REQUEST_PAUSE_MS="${X_API_REQUEST_PAUSE_MS:-200}"
EMBEDDING_ENABLED="${EMBEDDING_ENABLED:-true}"
EMBEDDING_BASE_URL="${EMBEDDING_BASE_URL:-https://api.venice.ai/api/v1}"
EMBEDDING_MODEL="${EMBEDDING_MODEL:-text-embedding-bge-m3}"
EMBEDDING_DIMS="${EMBEDDING_DIMS:-1024}"
EMBEDDING_TIMEOUT_MS="${EMBEDDING_TIMEOUT_MS:-10000}"
EMBEDDING_API_KEY="${EMBEDDING_API_KEY:-}"
EMBEDDING_BATCH_SIZE="${EMBEDDING_BATCH_SIZE:-16}"
EMBEDDING_MAX_ITEMS_PER_RUN="${EMBEDDING_MAX_ITEMS_PER_RUN:-0}"
EMBEDDING_INCLUDE_UPDATED="${EMBEDDING_INCLUDE_UPDATED:-false}"
EMBEDDING_FALLBACK_ALL_IF_NO_IDS="${EMBEDDING_FALLBACK_ALL_IF_NO_IDS:-false}"

COLLECTOR_ENABLED="${COLLECTOR_ENABLED:-true}"
COLLECTOR_WRITE_ENABLED="${COLLECTOR_WRITE_ENABLED:-true}"
COLLECTOR_DRY_RUN="${COLLECTOR_DRY_RUN:-false}"
COLLECTOR_SOURCE="${COLLECTOR_SOURCE:-aws-lambda-x-api}"
COLLECTOR_MODE="${COLLECTOR_MODE:-priority}"
XMONITOR_INGEST_OMIT_HANDLES="${XMONITOR_INGEST_OMIT_HANDLES:-zec_88,zec__2,spaljeni_zec,juan_sanchez13,zeki82086538826,sucveceza_35,windymint1,usa_trader06,roger_welch1,cmscanner_bb,cmscanner_rsi,dexportal_,luckyvinod16,zecigr,disruqtion,zec8,cmscanner_sma,zeczinka,cryptodiane,sureblessing36,pafoslive1,sachin22049721,lovegds1lady,micheal_crypto0,ruth13900929210,michell82710798,kimberl97730856,fx220000,exnesst80805,sfurures_expart,felix__steven,vectorthehunter,forex47kin51201,bullbearcrypt,blacker6636,devendr34011988,dannym4u,scapenerhurst,duncannbaldwin,robertethan_,jamesharri45923,jxttreasury,dannnym4u}"
SUMMARY_ENABLED="${SUMMARY_ENABLED:-true}"
SUMMARY_ALIGN_HOURS="${SUMMARY_ALIGN_HOURS:-2}"
SUMMARY_TOP_POSTS_2H="${SUMMARY_TOP_POSTS_2H:-8}"
SUMMARY_TOP_POSTS_12H="${SUMMARY_TOP_POSTS_12H:-8}"
SUMMARY_FEED_PAGE_LIMIT="${SUMMARY_FEED_PAGE_LIMIT:-20}"
SUMMARY_FEED_MAX_ITEMS_PER_WINDOW="${SUMMARY_FEED_MAX_ITEMS_PER_WINDOW:-2000}"
SUMMARY_LLM_BACKEND="${SUMMARY_LLM_BACKEND:-auto}"
SUMMARY_LLM_URL="${SUMMARY_LLM_URL:-https://api.venice.ai/api/v1}"
SUMMARY_LLM_MODEL="${SUMMARY_LLM_MODEL:-zai-org-glm-5}"
SUMMARY_LLM_API_KEY="${SUMMARY_LLM_API_KEY:-}"
SUMMARY_LLM_TEMPERATURE="${SUMMARY_LLM_TEMPERATURE:-0.45}"
SUMMARY_LLM_MAX_TOKENS="${SUMMARY_LLM_MAX_TOKENS:-420}"
SUMMARY_LLM_TIMEOUT_MS="${SUMMARY_LLM_TIMEOUT_MS:-120000}"
SUMMARY_LLM_MAX_ATTEMPTS="${SUMMARY_LLM_MAX_ATTEMPTS:-3}"
SUMMARY_LLM_INITIAL_BACKOFF_MS="${SUMMARY_LLM_INITIAL_BACKOFF_MS:-1000}"
WATCHLIST_TIERS_JSON="${WATCHLIST_TIERS_JSON:-}"
WATCHLIST_INCLUDE_HANDLES="${WATCHLIST_INCLUDE_HANDLES:-}"

INGEST_TIMEOUT_MS="${INGEST_TIMEOUT_MS:-20000}"
INGEST_BATCH_SIZE="${INGEST_BATCH_SIZE:-200}"

LAMBDA_TIMEOUT="${LAMBDA_TIMEOUT:-120}"
LAMBDA_MEMORY_MB="${LAMBDA_MEMORY_MB:-512}"

COLLECTOR_MODE="$(printf '%s' "$COLLECTOR_MODE" | tr '[:upper:]' '[:lower:]')"
if [[ "$COLLECTOR_MODE" != "priority" && "$COLLECTOR_MODE" != "discovery" ]]; then
  echo "error: COLLECTOR_MODE must be one of: priority, discovery" >&2
  exit 1
fi

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

if [[ -z "$INGEST_API_KEY" || -z "$X_API_BEARER_TOKEN" ]]; then
  echo "==> Reading fallback values from secret: $DB_SECRET_ID"
  DB_SECRET_JSON="$(aws_cli secretsmanager get-secret-value --secret-id "$DB_SECRET_ID" --query 'SecretString' --output text 2>/dev/null || true)"
  if [[ -n "$DB_SECRET_JSON" && "$DB_SECRET_JSON" != "None" ]]; then
    FIELDS="$(DB_SECRET_JSON="$DB_SECRET_JSON" python3 - <<'PY'
import json, os
payload = json.loads(os.environ['DB_SECRET_JSON'])
print(payload.get('ingest_shared_secret', payload.get('api_key', '')))
print(payload.get('x_api_bearer_token', payload.get('x_bearer_token', '')))
print(payload.get('embedding_api_key', payload.get('venice_api_key', '')))
PY
)"
    SECRET_INGEST_KEY="$(printf '%s\n' "$FIELDS" | sed -n '1p')"
    SECRET_X_BEARER="$(printf '%s\n' "$FIELDS" | sed -n '2p')"
    SECRET_EMBEDDING_KEY="$(printf '%s\n' "$FIELDS" | sed -n '3p')"
    if [[ -z "$INGEST_API_KEY" ]]; then
      INGEST_API_KEY="$SECRET_INGEST_KEY"
    fi
    if [[ -z "$X_API_BEARER_TOKEN" ]]; then
      X_API_BEARER_TOKEN="$SECRET_X_BEARER"
    fi
    if [[ -z "$EMBEDDING_API_KEY" ]]; then
      EMBEDDING_API_KEY="$SECRET_EMBEDDING_KEY"
    fi
  fi
fi

if [[ -z "$SUMMARY_LLM_API_KEY" ]]; then
  SUMMARY_LLM_API_KEY="$EMBEDDING_API_KEY"
fi

if [[ -n "$X_API_CONSUMER_KEY" && -n "$X_API_CONSUMER_SECRET" ]]; then
  if [[ -z "$X_API_BEARER_TOKEN" ]] || is_truthy "$X_API_REFRESH_BEARER_FROM_CONSUMER"; then
    echo "==> Minting X API bearer token from consumer key/secret"
    BASIC_AUTH="$(X_API_CONSUMER_KEY="$X_API_CONSUMER_KEY" X_API_CONSUMER_SECRET="$X_API_CONSUMER_SECRET" python3 - <<'PY'
import base64, os
token = f"{os.environ['X_API_CONSUMER_KEY']}:{os.environ['X_API_CONSUMER_SECRET']}"
print(base64.b64encode(token.encode('utf-8')).decode('ascii'))
PY
)"
    TOKEN_RESPONSE="$(
      curl -sS -X POST 'https://api.x.com/oauth2/token' \
        -H "Authorization: Basic $BASIC_AUTH" \
        -H 'Content-Type: application/x-www-form-urlencoded;charset=UTF-8' \
        --data 'grant_type=client_credentials'
    )"
    MINTED_TOKEN="$(TOKEN_RESPONSE="$TOKEN_RESPONSE" python3 - <<'PY'
import json, os
payload = json.loads(os.environ['TOKEN_RESPONSE'])
print(payload.get('access_token', ''))
PY
)"
    if [[ -z "$MINTED_TOKEN" ]]; then
      echo "error: failed to mint X bearer token from consumer key/secret" >&2
      exit 1
    fi
    X_API_BEARER_TOKEN="$MINTED_TOKEN"
  fi
fi

if [[ -z "$INGEST_API_KEY" ]]; then
  echo "error: INGEST_API_KEY is required (or set ingest_shared_secret in $DB_SECRET_ID)" >&2
  exit 1
fi
if [[ -z "$X_API_BEARER_TOKEN" ]]; then
  echo "error: X_API_BEARER_TOKEN is required (or set x_api_bearer_token in $DB_SECRET_ID)" >&2
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

echo "==> Packaging collector Lambda"
pushd "$LAMBDA_DIR" >/dev/null
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev >/dev/null
else
  npm install --omit=dev >/dev/null
fi
rm -f function.zip
zip -rq function.zip index.mjs package.json package-lock.json node_modules 2>/dev/null || zip -rq function.zip index.mjs package.json node_modules
popd >/dev/null

ENV_JSON="$(
  INGEST_API_BASE_URL="$INGEST_API_BASE_URL" \
  INGEST_API_KEY="$INGEST_API_KEY" \
  X_API_BEARER_TOKEN="$X_API_BEARER_TOKEN" \
  X_API_BASE_URL="$X_API_BASE_URL" \
  X_API_MAX_RESULTS_PER_QUERY="$X_API_MAX_RESULTS_PER_QUERY" \
  X_API_MAX_PAGES_PER_QUERY="$X_API_MAX_PAGES_PER_QUERY" \
  X_API_HANDLE_CHUNK_SIZE="$X_API_HANDLE_CHUNK_SIZE" \
  X_API_REPLY_CAPTURE_ENABLED="$X_API_REPLY_CAPTURE_ENABLED" \
  X_API_REPLY_MODE="$X_API_REPLY_MODE" \
  X_API_REPLY_TIERS="$X_API_REPLY_TIERS" \
  X_API_REPLY_SELECTED_HANDLES="$X_API_REPLY_SELECTED_HANDLES" \
  X_API_BASE_TERMS="$X_API_BASE_TERMS" \
  X_API_ENFORCE_LANG_ALLOWLIST="$X_API_ENFORCE_LANG_ALLOWLIST" \
  X_API_LANG_ALLOWLIST="$X_API_LANG_ALLOWLIST" \
  X_API_EXCLUDE_RETWEETS="$X_API_EXCLUDE_RETWEETS" \
  X_API_EXCLUDE_QUOTES="$X_API_EXCLUDE_QUOTES" \
  X_API_QUERY_TIMEOUT_MS="$X_API_QUERY_TIMEOUT_MS" \
  X_API_REQUEST_PAUSE_MS="$X_API_REQUEST_PAUSE_MS" \
  EMBEDDING_ENABLED="$EMBEDDING_ENABLED" \
  EMBEDDING_BASE_URL="$EMBEDDING_BASE_URL" \
  EMBEDDING_MODEL="$EMBEDDING_MODEL" \
  EMBEDDING_DIMS="$EMBEDDING_DIMS" \
  EMBEDDING_TIMEOUT_MS="$EMBEDDING_TIMEOUT_MS" \
  EMBEDDING_API_KEY="$EMBEDDING_API_KEY" \
  EMBEDDING_BATCH_SIZE="$EMBEDDING_BATCH_SIZE" \
  EMBEDDING_MAX_ITEMS_PER_RUN="$EMBEDDING_MAX_ITEMS_PER_RUN" \
  EMBEDDING_INCLUDE_UPDATED="$EMBEDDING_INCLUDE_UPDATED" \
  EMBEDDING_FALLBACK_ALL_IF_NO_IDS="$EMBEDDING_FALLBACK_ALL_IF_NO_IDS" \
  COLLECTOR_ENABLED="$COLLECTOR_ENABLED" \
  COLLECTOR_WRITE_ENABLED="$COLLECTOR_WRITE_ENABLED" \
  COLLECTOR_DRY_RUN="$COLLECTOR_DRY_RUN" \
  COLLECTOR_SOURCE="$COLLECTOR_SOURCE" \
  COLLECTOR_MODE="$COLLECTOR_MODE" \
  XMONITOR_INGEST_OMIT_HANDLES="$XMONITOR_INGEST_OMIT_HANDLES" \
  SUMMARY_ENABLED="$SUMMARY_ENABLED" \
  SUMMARY_ALIGN_HOURS="$SUMMARY_ALIGN_HOURS" \
  SUMMARY_TOP_POSTS_2H="$SUMMARY_TOP_POSTS_2H" \
  SUMMARY_TOP_POSTS_12H="$SUMMARY_TOP_POSTS_12H" \
  SUMMARY_FEED_PAGE_LIMIT="$SUMMARY_FEED_PAGE_LIMIT" \
  SUMMARY_FEED_MAX_ITEMS_PER_WINDOW="$SUMMARY_FEED_MAX_ITEMS_PER_WINDOW" \
  SUMMARY_LLM_BACKEND="$SUMMARY_LLM_BACKEND" \
  SUMMARY_LLM_URL="$SUMMARY_LLM_URL" \
  SUMMARY_LLM_MODEL="$SUMMARY_LLM_MODEL" \
  SUMMARY_LLM_API_KEY="$SUMMARY_LLM_API_KEY" \
  SUMMARY_LLM_TEMPERATURE="$SUMMARY_LLM_TEMPERATURE" \
  SUMMARY_LLM_MAX_TOKENS="$SUMMARY_LLM_MAX_TOKENS" \
  SUMMARY_LLM_TIMEOUT_MS="$SUMMARY_LLM_TIMEOUT_MS" \
  SUMMARY_LLM_MAX_ATTEMPTS="$SUMMARY_LLM_MAX_ATTEMPTS" \
  SUMMARY_LLM_INITIAL_BACKOFF_MS="$SUMMARY_LLM_INITIAL_BACKOFF_MS" \
  WATCHLIST_TIERS_JSON="$WATCHLIST_TIERS_JSON" \
  WATCHLIST_INCLUDE_HANDLES="$WATCHLIST_INCLUDE_HANDLES" \
  INGEST_TIMEOUT_MS="$INGEST_TIMEOUT_MS" \
  INGEST_BATCH_SIZE="$INGEST_BATCH_SIZE" \
  python3 - <<'PY'
import json, os
print(json.dumps({
  "Variables": {
    "XMONITOR_API_BASE_URL": os.environ["INGEST_API_BASE_URL"],
    "XMONITOR_API_KEY": os.environ["INGEST_API_KEY"],
    "XMON_X_API_BEARER_TOKEN": os.environ["X_API_BEARER_TOKEN"],
    "XMON_X_API_BASE_URL": os.environ["X_API_BASE_URL"],
    "XMON_X_API_MAX_RESULTS_PER_QUERY": os.environ["X_API_MAX_RESULTS_PER_QUERY"],
    "XMON_X_API_MAX_PAGES_PER_QUERY": os.environ["X_API_MAX_PAGES_PER_QUERY"],
    "XMON_X_API_HANDLE_CHUNK_SIZE": os.environ["X_API_HANDLE_CHUNK_SIZE"],
    "XMON_X_API_REPLY_CAPTURE_ENABLED": os.environ["X_API_REPLY_CAPTURE_ENABLED"],
    "XMON_X_API_REPLY_MODE": os.environ["X_API_REPLY_MODE"],
    "XMON_X_API_REPLY_TIERS": os.environ["X_API_REPLY_TIERS"],
    "XMON_X_API_REPLY_SELECTED_HANDLES": os.environ["X_API_REPLY_SELECTED_HANDLES"],
    "XMON_X_API_BASE_TERMS": os.environ["X_API_BASE_TERMS"],
    "XMON_X_API_ENFORCE_LANG_ALLOWLIST": os.environ["X_API_ENFORCE_LANG_ALLOWLIST"],
    "XMON_X_API_LANG_ALLOWLIST": os.environ["X_API_LANG_ALLOWLIST"],
    "XMON_X_API_EXCLUDE_RETWEETS": os.environ["X_API_EXCLUDE_RETWEETS"],
    "XMON_X_API_EXCLUDE_QUOTES": os.environ["X_API_EXCLUDE_QUOTES"],
    "XMON_X_API_QUERY_TIMEOUT_MS": os.environ["X_API_QUERY_TIMEOUT_MS"],
    "XMON_X_API_REQUEST_PAUSE_MS": os.environ["X_API_REQUEST_PAUSE_MS"],
    "XMON_EMBEDDING_ENABLED": os.environ["EMBEDDING_ENABLED"],
    "XMONITOR_EMBEDDING_BASE_URL": os.environ["EMBEDDING_BASE_URL"],
    "XMONITOR_EMBEDDING_MODEL": os.environ["EMBEDDING_MODEL"],
    "XMONITOR_EMBEDDING_DIMS": os.environ["EMBEDDING_DIMS"],
    "XMONITOR_EMBEDDING_TIMEOUT_MS": os.environ["EMBEDDING_TIMEOUT_MS"],
    "XMONITOR_EMBEDDING_API_KEY": os.environ["EMBEDDING_API_KEY"],
    "XMON_EMBEDDING_BATCH_SIZE": os.environ["EMBEDDING_BATCH_SIZE"],
    "XMON_EMBEDDING_MAX_ITEMS_PER_RUN": os.environ["EMBEDDING_MAX_ITEMS_PER_RUN"],
    "XMON_EMBEDDING_INCLUDE_UPDATED": os.environ["EMBEDDING_INCLUDE_UPDATED"],
    "XMON_EMBEDDING_FALLBACK_ALL_IF_NO_IDS": os.environ["EMBEDDING_FALLBACK_ALL_IF_NO_IDS"],
    "XMON_COLLECTOR_ENABLED": os.environ["COLLECTOR_ENABLED"],
    "XMON_COLLECTOR_WRITE_ENABLED": os.environ["COLLECTOR_WRITE_ENABLED"],
    "XMON_COLLECTOR_DRY_RUN": os.environ["COLLECTOR_DRY_RUN"],
    "XMON_COLLECTOR_SOURCE": os.environ["COLLECTOR_SOURCE"],
    "XMON_COLLECTOR_MODE": os.environ["COLLECTOR_MODE"],
    "XMONITOR_INGEST_OMIT_HANDLES": os.environ["XMONITOR_INGEST_OMIT_HANDLES"],
    "XMON_SUMMARY_ENABLED": os.environ["SUMMARY_ENABLED"],
    "XMON_SUMMARY_ALIGN_HOURS": os.environ["SUMMARY_ALIGN_HOURS"],
    "XMON_SUMMARY_TOP_POSTS_2H": os.environ["SUMMARY_TOP_POSTS_2H"],
    "XMON_SUMMARY_TOP_POSTS_12H": os.environ["SUMMARY_TOP_POSTS_12H"],
    "XMON_SUMMARY_FEED_PAGE_LIMIT": os.environ["SUMMARY_FEED_PAGE_LIMIT"],
    "XMON_SUMMARY_FEED_MAX_ITEMS_PER_WINDOW": os.environ["SUMMARY_FEED_MAX_ITEMS_PER_WINDOW"],
    "XMON_SUMMARY_LLM_BACKEND": os.environ["SUMMARY_LLM_BACKEND"],
    "XMON_SUMMARY_LLM_URL": os.environ["SUMMARY_LLM_URL"],
    "XMON_SUMMARY_LLM_MODEL": os.environ["SUMMARY_LLM_MODEL"],
    "XMON_SUMMARY_LLM_API_KEY": os.environ["SUMMARY_LLM_API_KEY"],
    "XMON_SUMMARY_LLM_TEMPERATURE": os.environ["SUMMARY_LLM_TEMPERATURE"],
    "XMON_SUMMARY_LLM_MAX_TOKENS": os.environ["SUMMARY_LLM_MAX_TOKENS"],
    "XMON_SUMMARY_LLM_TIMEOUT_MS": os.environ["SUMMARY_LLM_TIMEOUT_MS"],
    "XMON_SUMMARY_LLM_MAX_ATTEMPTS": os.environ["SUMMARY_LLM_MAX_ATTEMPTS"],
    "XMON_SUMMARY_LLM_INITIAL_BACKOFF_MS": os.environ["SUMMARY_LLM_INITIAL_BACKOFF_MS"],
    "XMON_X_API_WATCHLIST_TIERS_JSON": os.environ["WATCHLIST_TIERS_JSON"],
    "XMON_X_API_WATCHLIST_INCLUDE_HANDLES": os.environ["WATCHLIST_INCLUDE_HANDLES"],
    "XMON_INGEST_TIMEOUT_MS": os.environ["INGEST_TIMEOUT_MS"],
    "XMON_INGEST_BATCH_SIZE": os.environ["INGEST_BATCH_SIZE"],
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
    "Input": "{\"source\":\"eventbridge\",\"mode\":\"$COLLECTOR_MODE\"}"
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
echo "  Collector Lambda:  $LAMBDA_FUNCTION_NAME"
echo "  Function ARN:      $FUNCTION_ARN"
echo "  Event rule:        $EVENT_RULE_NAME"
echo "  Schedule:          $SCHEDULE_EXPRESSION"
echo "  Rule state:        $RULE_STATE"
echo "  Collector mode:    $COLLECTOR_MODE"
echo ""
echo "Manual invoke test:"
echo "  aws --region $AWS_REGION lambda invoke --function-name $LAMBDA_FUNCTION_NAME --payload '{\"dryRun\":true}' /tmp/xmon_xapi_collector_test.json && cat /tmp/xmon_xapi_collector_test.json"
