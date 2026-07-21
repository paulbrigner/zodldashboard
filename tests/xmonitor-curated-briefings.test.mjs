import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendPath = path.join(repositoryRoot, "services/vpc-api-lambda/index.mjs");
const backendModuleUrl = pathToFileURL(backendPath).href;
const publishedSecret = "published-briefings-client-secret-at-least-32-characters";
const manageSecret = "manage-briefings-client-secret-at-least-32-characters";
const plainSecret = "plain-read-client-secret-at-least-32-characters";

function request(method, pathname, headers = {}, body) {
  return {
    rawPath: pathname,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method } },
  };
}

test("curated briefing capabilities are explicit and management stays separate", async () => {
  process.env.XMONITOR_BRIEFINGS_ENABLED = "false";
  process.env.XMONITOR_USER_PROXY_SECRET = "viewer-proxy-secret-at-least-32-characters";
  process.env.XMONITOR_READ_CLIENTS_JSON = JSON.stringify({
    read_clients: {
      plain: { secrets: [plainSecret], capabilities: ["read"] },
      "pgpz-community": {
        secrets: [publishedSecret],
        capabilities: ["read", "semantic:query", "briefings:read"],
      },
      "pgpz-community-admin": {
        secrets: [manageSecret],
        capabilities: ["briefings:read", "briefings:manage"],
      },
    },
  });
  const api = await import(`${backendModuleUrl}?briefing-auth=${Date.now()}`);
  const publishedHeaders = {
    "x-xmonitor-client-id": "pgpz-community",
    "x-xmonitor-client-secret": publishedSecret,
  };
  const manageHeaders = {
    "x-xmonitor-client-id": "pgpz-community-admin",
    "x-xmonitor-client-secret": manageSecret,
  };
  const plainHeaders = {
    "x-xmonitor-client-id": "plain",
    "x-xmonitor-client-secret": plainSecret,
  };

  assert.equal((await api.handler(request("GET", "/v1/curated-briefings"))).statusCode, 401);
  assert.equal((await api.handler(request("GET", "/v1/curated-briefings", plainHeaders))).statusCode, 403);
  assert.equal((await api.handler(request("GET", "/v1/curated-briefings", publishedHeaders))).statusCode, 503);
  assert.equal((await api.handler(request("GET", "/v1/admin/curated-briefings", publishedHeaders))).statusCode, 403);
  assert.equal((await api.handler(request("GET", "/v1/admin/curated-briefings", manageHeaders))).statusCode, 503);
  assert.equal((await api.handler(request("GET", "/v1/feed", manageHeaders))).statusCode, 403);
  assert.deepEqual(
    await api.authorizeSemanticQueryRequest(request("POST", "/v1/query/semantic", manageHeaders, {
      query_text: "quantum readiness",
    })),
    { ok: false, status: 403, error: "forbidden" }
  );
  assert.equal((await api.handler(request("GET", "/v1/feed", publishedHeaders))).statusCode, 503);

  const compose = await api.handler(request("POST", "/v1/query/compose", publishedHeaders, {
    task_text: "This must remain unavailable to the Community service client",
  }));
  assert.equal(compose.statusCode, 401);
  const adminCompose = await api.handler(request("POST", "/v1/query/compose", manageHeaders, {
    task_text: "Administrative credentials must not unlock free-form Compose",
  }));
  assert.equal(adminCompose.statusCode, 401);
});

test("manage capability is rejected unless the same client also has briefing read", async () => {
  process.env.XMONITOR_READ_CLIENTS_JSON = JSON.stringify({
    broken: { secrets: [manageSecret], capabilities: ["briefings:manage"] },
  });
  const api = await import(`${backendModuleUrl}?briefing-invalid-manage=${Date.now()}`);
  assert.deepEqual(
    await api.validateReadClientAuthorization(request("GET", "/v1/admin/curated-briefings", {
      "x-xmonitor-client-id": "broken",
      "x-xmonitor-client-secret": manageSecret,
    }), { requiredCapability: "briefings:manage" }),
    { ok: false, status: 503, error: "read client auth is not configured" }
  );
});

test("briefing persistence and worker flow preserve editorial and scheduling invariants", async () => {
  const [source, migration] = await Promise.all([
    readFile(backendPath, "utf8"),
    readFile(path.join(repositoryRoot, "db/migrations/034_curated_topic_briefings.sql"), "utf8"),
  ]);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS xmonitor_briefing_topics/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS xmonitor_briefing_runs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS xmonitor_briefing_versions/);
  assert.match(migration, /topic_snapshot_json JSONB NOT NULL/);
  assert.match(migration, /evidence_fingerprint TEXT NOT NULL/);
  assert.match(migration, /idx_xmonitor_briefing_versions_one_published_per_topic/);
  assert.match(migration, /idx_xmonitor_briefing_versions_unique_published_slug/);
  assert.match(migration, /idx_xmonitor_briefing_runs_one_active_per_topic/);
  assert.match(migration, /WHERE status IN \('queued', 'running'\)/);

  assert.match(source, /draft_format: "none"/);
  assert.match(source, /evidence_fingerprint = \$3/);
  assert.match(source, /WHERE previous\.evidence_fingerprint = \$3/);
  assert.match(source, /FOR UPDATE OF r, t/);
  assert.match(source, /WHERE topic_id = \$1 AND status IN \('queued', 'running'\)/);
  assert.match(source, /const topicSnapshot = briefingTopicSnapshot\(topic\)/);
  assert.match(source, /briefing run is missing its topic snapshot/);
  assert.match(source, /SELECT previous\.run_id[\s\S]*ORDER BY completed_at DESC[\s\S]*LIMIT 1/);
  assert.match(source, /AND v\.evidence_fingerprint = \$3/);
  assert.match(source, /async function reconcileStaleBriefingRuns/);
  assert.match(source, /compose_job_stale_running/);
  assert.match(source, /SET status = 'running', started_at = COALESCE\(started_at, now\(\)\)/);
  assert.match(source, /only a draft briefing version can be published/);
  assert.match(source, /new Set\(\["published", "superseded"\]\)/);
  assert.match(source, /discovered_at: \$\{citation\.discovered_at \|\| "unknown"\}/);
  assert.match(source, /discovered_at: item\.discovered_at/);
});

test("provisioning is staged off and targeted rollout helpers preserve configuration", async () => {
  const [provision, codeOnly, migrationHelper] = await Promise.all([
    readFile(path.join(repositoryRoot, "scripts/aws/provision_vpc_api_lambda.sh"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts/aws/deploy_vpc_api_lambda_code_only.sh"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts/aws/apply_curated_briefings_migration.sh"), "utf8"),
  ]);
  assert.match(provision, /BRIEFINGS_ENABLED="false"/);
  assert.match(provision, /"briefings:read", "briefings:manage"/);
  assert.match(provision, /briefings:manage clients must also define briefings:read/);
  assert.match(provision, /XMONITOR_BRIEFING_PROMPT_VERSION/);
  assert.match(codeOnly, /update-function-code/);
  assert.doesNotMatch(codeOnly, /update-function-configuration/);
  assert.doesNotMatch(codeOnly, /apigatewayv2|put-role-policy|events put-rule/);
  assert.match(migrationHelper, /--query Environment/);
  assert.match(migrationHelper, /trap cleanup EXIT/);
  assert.match(migrationHelper, /restore_api_environment/);
  assert.match(migrationHelper, /034_curated_topic_briefings\.sql/);
  assert.match(migrationHelper, /variables\["XMONITOR_BRIEFINGS_ENABLED"\] = "false"/);
});
