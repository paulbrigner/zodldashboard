#!/usr/bin/env bash
set -euo pipefail

truthy() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

if ! truthy "${GUEST_MAGIC_LINK_ENABLED:-}"; then
  echo "Guest magic-link sign-in is disabled; backend smoke check skipped."
  exit 0
fi

if [[ -z "${XMONITOR_BACKEND_API_BASE_URL:-}" ]]; then
  echo "error: GUEST_MAGIC_LINK_ENABLED=true but XMONITOR_BACKEND_API_BASE_URL is not set." >&2
  exit 1
fi

if [[ -z "${XMONITOR_USER_PROXY_SECRET:-}" ]]; then
  echo "error: GUEST_MAGIC_LINK_ENABLED=true but XMONITOR_USER_PROXY_SECRET is not set." >&2
  exit 1
fi

base_url="${XMONITOR_BACKEND_API_BASE_URL%/}"
response_file="$(mktemp)"
timeout_seconds="${GUEST_MAGIC_LINK_SMOKE_TIMEOUT_SECONDS:-10}"

http_status="$(
  curl -sS \
    --connect-timeout "$timeout_seconds" \
    --max-time "$timeout_seconds" \
    -o "$response_file" \
    -w '%{http_code}' \
    -X POST "${base_url}/auth/guest-email/send-verification" \
    -H 'content-type: application/json' \
    -H "x-xmonitor-viewer-secret: ${XMONITOR_USER_PROXY_SECRET}" \
    --data '{}'
)"

if [[ "$http_status" == "400" ]] && grep -qi 'valid email address' "$response_file"; then
  echo "Guest magic-link backend smoke check passed."
  exit 0
fi

echo "error: guest magic-link backend smoke check failed with HTTP $http_status." >&2
sed 's/[[:cntrl:]]//g' "$response_file" >&2 || true
exit 1
