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

test("curated briefing Compose requires auditable inline status-ID markers", async () => {
  const api = await import(`${backendModuleUrl}?briefing-citation-contract=${Date.now()}`);
  const statusId = "2054924108299923836";
  const composeInput = api.briefingComposeInput({
    question: "What is Tachyon and its current status?",
    editorial_context: null,
    answer_style: "detailed",
    retrieval_config_json: {
      lookback_hours: 720,
      retrieval_limit: 10,
      context_limit: 10,
    },
  }, new Date("2026-07-21T12:00:00.000Z"));

  assert.equal(composeInput.inline_citation_markers, true);
  const prompt = api.buildComposePrompt(composeInput, {
    citations: [{
      status_id: statusId,
      author_handle: "tachyonzcash",
      discovered_at: "2026-07-20T12:00:00.000Z",
      score: 0.95,
      url: `https://x.com/i/status/${statusId}`,
      body_text: "Tachyon is in development.",
    }],
  });

  assert.match(prompt.systemPrompt, /exact format \[#<status_id>\]/);
  assert.match(prompt.systemPrompt, /never the evidence list number/);
  assert.match(prompt.systemPrompt, /every ID in citation_status_ids must appear in answer_text/);
  assert.match(prompt.userPrompt, new RegExp(`status_id: ${statusId}`));

  const parsed = api.parseComposeModelResult(JSON.stringify({
    answer_text: `Tachyon is in development. [#${statusId}]`,
    draft_text: null,
    email_draft: null,
    key_points: ["Tachyon is in development."],
    citation_status_ids: [statusId],
  }));
  assert.equal(parsed.answer_text, `Tachyon is in development. [#${statusId}]`);
  assert.deepEqual(parsed.citation_status_ids, [statusId]);

  const statusIds = Array.from({ length: 11 }, (_, index) => String(2054924108299923836n + BigInt(index)));
  const missingStatusId = "9999999999999999999";
  const answerText = [
    ...statusIds.map((citationStatusId, index) => `Claim ${index + 1}. [#${citationStatusId}]`),
    `Unsupported marker. [#${missingStatusId}]`,
  ].join("\n");
  const reconciliation = api.reconcileComposeInlineCitations(
    answerText,
    { citations: statusIds.map((citationStatusId) => ({ status_id: citationStatusId })) },
    statusIds.slice(0, 10)
  );

  assert.deepEqual(api.composeInlineCitationStatusIds(answerText), [...statusIds, missingStatusId]);
  assert.deepEqual(reconciliation.citations.map((citation) => citation.status_id), statusIds);
  assert.equal(
    reconciliation.answer_text,
    [
      ...statusIds.map((citationStatusId, index) => `Claim ${index + 1}. [#${citationStatusId}]`),
      "Unsupported marker. ",
    ].join("\n")
  );
  assert.deepEqual(api.unresolvedComposeInlineCitationStatusIds(
    reconciliation.answer_text,
    reconciliation.citations
  ), []);
  assert.deepEqual(api.unresolvedComposeInlineCitationStatusIds(
    `Missing source. [#${missingStatusId}]`,
    reconciliation.citations
  ), [missingStatusId]);
});

test("briefing persistence and worker flow preserve editorial and scheduling invariants", async () => {
  const [source, migration, api] = await Promise.all([
    readFile(backendPath, "utf8"),
    readFile(path.join(repositoryRoot, "db/migrations/034_curated_topic_briefings.sql"), "utf8"),
    import(`${backendModuleUrl}?briefing-persistence=${Date.now()}`),
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
  assert.match(source, /inline_citation_markers: true/);
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
  assert.match(source, /briefing answer must include at least one inline citation marker/);
  assert.match(source, /briefing answer includes citation markers that are missing from its source list/);
  assert.match(source, /new Set\(\["published", "superseded"\]\)/);
  assert.match(source, /discovered_at: \$\{citation\.discovered_at \|\| "unknown"\}/);
  assert.match(source, /discovered_at: item\.discovered_at/);

  const publicQuery = source.slice(
    source.indexOf("async function getPublishedBriefings"),
    source.indexOf("async function listAdminBriefingTopics")
  );
  assert.match(publicQuery, /t\.display_order AS display_order/);
  assert.match(publicQuery, /ORDER BY t\.display_order ASC, v\.question ASC, t\.topic_id ASC/);
  assert.doesNotMatch(publicQuery, /v\.display_order/);

  let capturedQuery = "";
  const published = await api.getPublishedBriefings(null, {
    async query(queryText, params) {
      capturedQuery = queryText;
      assert.deepEqual(params, []);
      return {
        rows: [{
          topic_id: "11111111-1111-4111-8111-111111111111",
          slug: "current-topic-order",
          question: "Does current topic order control presentation?",
          category: "Operations",
          display_order: 2,
          version_id: "22222222-2222-4222-8222-222222222222",
          answer_text: "Yes. [#2054924108299923836]",
          key_points_json: [],
          citations_json: [{ status_id: "2054924108299923836" }],
          source_count: 1,
          generated_at: "2026-07-21T12:00:00.000Z",
          corpus_through: "2026-07-21T11:00:00.000Z",
          reviewed_at: "2026-07-21T13:00:00.000Z",
          published_at: "2026-07-21T13:00:00.000Z",
        }],
      };
    },
  });
  assert.equal(published[0].order, 2);
  assert.match(capturedQuery, /t\.display_order AS display_order/);
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
  assert.match(migrationHelper, /xmonitor\/rds\/master/);
  assert.match(migrationHelper, /trap cleanup EXIT/);
  assert.match(migrationHelper, /lambda create-function/);
  assert.match(migrationHelper, /lambda delete-function/);
  assert.match(migrationHelper, /"Handler": "index\.handler"/);
  assert.match(migrationHelper, /"PGUSER": str\(secret\["username"\]\)/);
  assert.match(migrationHelper, /034_curated_topic_briefings\.sql/);
  assert.match(migrationHelper, /"XMONITOR_BRIEFINGS_ENABLED": "false"/);
  assert.doesNotMatch(migrationHelper, /update-function-configuration/);
});
