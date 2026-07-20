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
