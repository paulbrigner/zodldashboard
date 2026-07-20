import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendModuleUrl = pathToFileURL(
  path.join(repositoryRoot, "services/vpc-api-lambda/index.mjs")
).href;
const clientAuthModuleUrl = pathToFileURL(
  path.join(repositoryRoot, "lib/xmonitor/read-client-auth.ts")
).href;
const clientSecret = "read-client-secret-with-at-least-32-characters";

const readRoutes = [
  "app/api/v1/feed/route.ts",
  "app/api/v1/author-locations/route.ts",
  "app/api/v1/engagement/route.ts",
  "app/api/v1/trends/route.ts",
  "app/api/v1/window-summaries/latest/route.ts",
  "app/api/v1/posts/[statusId]/route.ts",
];

function apiGatewayGet(pathname, headers = {}) {
  return {
    rawPath: pathname,
    headers,
    requestContext: { http: { method: "GET" } },
  };
}

function apiGatewayPost(pathname, headers = {}, body = {}) {
  return {
    rawPath: pathname,
    headers,
    body: JSON.stringify(body),
    requestContext: { http: { method: "POST" } },
  };
}

test("backend read boundary rejects every protected read before database access", async () => {
  process.env.XMONITOR_READ_CLIENTS_JSON = JSON.stringify({
    read_clients: {
      zodldashboard: [clientSecret],
    },
  });

  const api = await import(`${backendModuleUrl}?read-auth-test=${Date.now()}`);
  const protectedPaths = [
    "/v1/feed",
    "/v1/author-locations",
    "/v1/engagement",
    "/v1/trends",
    "/v1/window-summaries/latest",
    "/v1/posts/12345",
    "/api/v1/feed",
    "/api/v1/posts/12345",
  ];

  for (const pathname of protectedPaths) {
    const response = await api.handler(apiGatewayGet(pathname));
    assert.equal(response.statusCode, 401, pathname);
    assert.deepEqual(JSON.parse(response.body), { error: "unauthorized" }, pathname);
  }
});

test("backend read credential validation supports per-client rotation and fails closed", async () => {
  process.env.XMONITOR_READ_CLIENTS_JSON = JSON.stringify({
    zodldashboard: [clientSecret, "rotated-read-client-secret-with-32-characters"],
  });

  const api = await import(`${backendModuleUrl}?read-auth-validation=${Date.now()}`);
  assert.equal(typeof api.validateReadClientAuthorization, "function");

  assert.deepEqual(
    await api.validateReadClientAuthorization(apiGatewayGet("/v1/feed", {
      "x-xmonitor-client-id": "zodldashboard",
      "x-xmonitor-client-secret": clientSecret,
    })),
    { ok: true, clientId: "zodldashboard" }
  );
  assert.deepEqual(
    await api.validateReadClientAuthorization(apiGatewayGet("/v1/feed", {
      "x-xmonitor-client-id": "zodldashboard",
      "x-xmonitor-client-secret": "wrong-read-client-secret-with-32-characters",
    })),
    { ok: false, status: 401, error: "unauthorized" }
  );

  process.env.XMONITOR_READ_CLIENTS_JSON = "{}";
  assert.deepEqual(
    await api.validateReadClientAuthorization(apiGatewayGet("/v1/feed", {
      "x-xmonitor-client-id": "zodldashboard",
      "x-xmonitor-client-secret": clientSecret,
    })),
    { ok: false, status: 503, error: "read client auth is not configured" }
  );
});

test("semantic query capability is explicit and does not unlock privileged endpoints", async () => {
  const semanticSecret = "semantic-client-secret-with-at-least-32-characters";
  process.env.XMONITOR_USER_PROXY_SECRET = "viewer-proxy-secret-with-at-least-32-characters";
  process.env.XMONITOR_READ_CLIENTS_JSON = JSON.stringify({
    read_clients: {
      zodldashboard: [clientSecret],
      "pgpz-community": {
        secrets: [semanticSecret],
        capabilities: ["read", "semantic:query"],
      },
    },
  });

  const api = await import(`${backendModuleUrl}?semantic-client-auth=${Date.now()}`);
  const semanticHeaders = {
    "x-xmonitor-client-id": "pgpz-community",
    "x-xmonitor-client-secret": semanticSecret,
  };
  const readOnlyHeaders = {
    "x-xmonitor-client-id": "zodldashboard",
    "x-xmonitor-client-secret": clientSecret,
  };

  assert.deepEqual(
    await api.authorizeSemanticQueryRequest(apiGatewayPost(
      "/v1/query/semantic",
      semanticHeaders,
      { query_text: "privacy tools" }
    )),
    { ok: true, mode: "read-client", clientId: "pgpz-community" }
  );
  assert.deepEqual(
    await api.authorizeSemanticQueryRequest(apiGatewayPost(
      "/v1/query/semantic",
      readOnlyHeaders,
      { query_text: "privacy tools" }
    )),
    { ok: false, status: 403, error: "forbidden" }
  );

  const composeResponse = await api.handler(apiGatewayPost(
    "/v1/query/compose",
    semanticHeaders,
    { task_text: "write an answer" }
  ));
  assert.equal(composeResponse.statusCode, 401);

  process.env.XMONITOR_READ_CLIENTS_JSON = JSON.stringify({
    "pgpz-community": {
      secrets: [semanticSecret],
      capabilities: ["semantic:query"],
    },
  });
  const invalidApi = await import(`${backendModuleUrl}?semantic-client-missing-read=${Date.now()}`);
  assert.deepEqual(
    await invalidApi.validateReadClientAuthorization(apiGatewayGet("/v1/feed", semanticHeaders)),
    { ok: false, status: 503, error: "read client auth is not configured" }
  );
});

test("semantic query parsing allowlists theme filters", async () => {
  const api = await import(`${backendModuleUrl}?semantic-theme-filter=${Date.now()}`);
  const parsed = api.parseSemanticQueryBody({
    query_text: "privacy tools",
    themes: ["Privacy / freedom narrative", "not-a-theme"],
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data.themes, ["Privacy / freedom narrative"]);

  const source = await readFile(
    path.join(repositoryRoot, "services/vpc-api-lambda/index.mjs"),
    "utf8"
  );
  assert.match(
    source,
    /appendSummaryMatcherFilter\(where, params, buildSummaryThemeMatcherGroups\(query\.themes\), "p"\)/
  );
});

test("semantic client queries have an independent kill switch, budgets, and metrics", async () => {
  const api = await import(`${backendModuleUrl}?semantic-budget=${Date.now()}`);
  assert.deepEqual(api.semanticClientBudgetSettings({}), {
    enabled: true,
    burstLimit: 120,
    dailyLimit: 1000,
  });
  assert.deepEqual(api.semanticClientBudgetSettings({
    XMONITOR_SEMANTIC_CLIENT_QUERY_ENABLED: "false",
    XMONITOR_SEMANTIC_CLIENT_BURST_LIMIT: "9",
    XMONITOR_SEMANTIC_CLIENT_DAILY_LIMIT: "40",
  }), {
    enabled: false,
    burstLimit: 9,
    dailyLimit: 40,
  });
  assert.equal(api.semanticClientBudgetSettings({
    XMONITOR_SEMANTIC_CLIENT_QUERY_ENABLED: "unexpected",
  }).enabled, false);

  const source = await readFile(
    path.join(repositoryRoot, "services/vpc-api-lambda/index.mjs"),
    "utf8"
  );
  const handlerSource = source.slice(
    source.indexOf("async function handleSemanticQuery"),
    source.indexOf("async function handleComposeQuery")
  );
  assert.ok(handlerSource.indexOf("consumeSemanticClientBudget") < handlerSource.indexOf("createQueryEmbedding"));
  assert.match(handlerSource, /SemanticQueryThrottled/);
  assert.match(handlerSource, /SemanticQueryDuration/);

  const migration = await readFile(
    path.join(repositoryRoot, "db/migrations/033_xmonitor_semantic_client_usage.sql"),
    "utf8"
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS xmonitor_client_usage_windows/);
  assert.match(migration, /PRIMARY KEY \(client_id, capability, window_kind, window_start\)/);

  const statements = [];
  let usageInsertCount = 0;
  const connection = {
    async query(sql) {
      statements.push(String(sql).trim());
      if (String(sql).includes("INSERT INTO xmonitor_client_usage_windows")) {
        usageInsertCount += 1;
        return { rowCount: usageInsertCount === 1 ? 1 : 0 };
      }
      return { rowCount: 0 };
    },
    release() {
      statements.push("RELEASE");
    },
  };
  await assert.rejects(
    api.consumeSemanticClientBudget("pgpz-community", {
      async connect() { return connection; },
    }),
    /semantic client query limit reached/
  );
  assert.ok(statements.includes("ROLLBACK"));
  assert.ok(!statements.includes("COMMIT"));
  assert.equal(statements.at(-1), "RELEASE");

  const provisionSource = await readFile(
    path.join(repositoryRoot, "scripts/aws/provision_vpc_api_lambda.sh"),
    "utf8"
  );
  assert.match(provisionSource, /SEMANTIC_CLIENT_QUERY_ENABLED_EXPLICIT/);
  assert.match(provisionSource, /existing_lambda_env_value XMONITOR_SEMANTIC_CLIENT_QUERY_ENABLED/);
});

test("dashboard host credentials are server-only, validated, and limited to read paths", async () => {
  const originalClientId = process.env.XMONITOR_READ_CLIENT_ID;
  const originalClientSecret = process.env.XMONITOR_READ_CLIENT_SECRET;
  const auth = await import(`${clientAuthModuleUrl}?host-auth=${Date.now()}`);

  try {
    process.env.XMONITOR_READ_CLIENT_ID = "zodldashboard";
    process.env.XMONITOR_READ_CLIENT_SECRET = clientSecret;
    assert.deepEqual(auth.buildXMonitorReadClientHeaders(), {
      "x-xmonitor-client-id": "zodldashboard",
      "x-xmonitor-client-secret": clientSecret,
    });

    assert.equal(auth.isXMonitorReadApiPath("/v1/feed"), true);
    assert.equal(auth.isXMonitorReadApiPath("/api/v1/posts/123"), true);
    assert.equal(auth.isXMonitorReadApiPath("/v1/health"), false);
    assert.equal(auth.isXMonitorReadApiPath("/v1/query/compose"), false);

    delete process.env.XMONITOR_READ_CLIENT_SECRET;
    assert.throws(
      () => auth.buildXMonitorReadClientHeaders(),
      /requires both XMONITOR_READ_CLIENT_ID and XMONITOR_READ_CLIENT_SECRET/
    );
  } finally {
    if (originalClientId === undefined) delete process.env.XMONITOR_READ_CLIENT_ID;
    else process.env.XMONITOR_READ_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.XMONITOR_READ_CLIENT_SECRET;
    else process.env.XMONITOR_READ_CLIENT_SECRET = originalClientSecret;
  }
});

test("all dashboard read routes authorize viewers before proxy or direct database access", async (t) => {
  for (const relativePath of readRoutes) {
    await t.test(relativePath, async () => {
      const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
      const authorizationIndex = source.indexOf("requireXMonitorReadViewer(request)");
      const proxyIndex = source.indexOf("maybeProxyApiRequest(request)");

      assert.ok(authorizationIndex >= 0, "route must enforce the X Monitor viewer boundary");
      assert.ok(proxyIndex > authorizationIndex, "viewer authorization must run before backend proxying");
    });
  }
});

test("the generic dashboard proxy strips inbound read credentials and injects its own", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "lib/xmonitor/backend-api.ts"),
    "utf8"
  );
  const forwardedHeaderList = source.slice(
    source.indexOf("const PROXY_REQUEST_HEADER_NAMES"),
    source.indexOf("];", source.indexOf("const PROXY_REQUEST_HEADER_NAMES")) + 2
  );

  assert.doesNotMatch(forwardedHeaderList, /x-xmonitor-client-(?:id|secret)/);
  assert.match(source, /isXMonitorReadApiPath\(targetPath\)/);
  assert.match(source, /buildXMonitorReadClientHeaders\(\)/);
});

test("post detail page enforces X Monitor permission before reading a post", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "app/posts/[statusId]/page.tsx"),
    "utf8"
  );
  const permissionIndex = source.indexOf('canReadDashboard(viewer, "x-monitor")');
  const readIndex = source.indexOf("createXMonitorReadService()");

  assert.ok(permissionIndex >= 0);
  assert.ok(readIndex > permissionIndex);
});
