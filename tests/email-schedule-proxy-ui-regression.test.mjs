import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const emailProxyRoutes = [
  "app/api/v1/email/schedules/route.ts",
  "app/api/v1/email/schedules/[jobId]/route.ts",
  "app/api/v1/email/schedules/[jobId]/run-now/route.ts",
  "app/api/v1/email/send/route.ts",
];

async function readRepositoryFile(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("all email schedule and send proxies use the Better Auth-aware viewer contract", async (t) => {
  for (const relativePath of emailProxyRoutes) {
    await t.test(relativePath, async () => {
      const source = await readRepositoryFile(relativePath);

      assert.match(
        source,
        /import\s+\{\s*resolveApiRouteViewer\s*\}\s+from\s+["']@\/lib\/api-route-viewer["']/,
        "route must import the dual-auth API viewer resolver"
      );
      assert.match(
        source,
        /import\s+\{\s*buildViewerProxyHeaders\s*\}\s+from\s+["']@\/lib\/xmonitor\/viewer-proxy["']/,
        "route must import the canonical viewer proxy-header builder"
      );
      assert.match(
        source,
        /await\s+resolveApiRouteViewer\(new URL\(request\.url\)\.pathname\)/,
        "route must resolve the current request through the dual-auth viewer path"
      );
      assert.match(
        source,
        /buildViewerProxyHeaders\(viewer\)/,
        "route must derive backend identity headers from the resolved viewer"
      );
      assert.match(
        source,
        /\.\.\.viewerHeaders/,
        "route must forward the canonical viewer headers to the backend"
      );

      assert.doesNotMatch(source, /\bgetServerSession\b/, "route must not fall back to NextAuth session lookup");
      assert.doesNotMatch(source, /from\s+["']next-auth["']/, "route must not import NextAuth directly");
      assert.doesNotMatch(source, /\bauthOptions\b/, "route must not depend on the legacy NextAuth configuration");
      assert.doesNotMatch(
        source,
        /["']x-xmonitor-(?:viewer-email|viewer-auth-mode|user-email|user-name|auth-mode)["']\s*:/,
        "route must not hand-build viewer identity headers"
      );
    });
  }
});

test("schedule load failures are distinct from a successfully loaded empty list", async () => {
  const source = await readRepositoryFile("app/x-monitor/compose-panel.tsx");

  assert.match(
    source,
    /const \[scheduleLoadErrorText, setScheduleLoadErrorText\] = useState<string \| null>\(null\)/,
    "schedule fetch failures need dedicated state"
  );
  assert.match(
    source,
    /const \[hasLoadedSchedules, setHasLoadedSchedules\] = useState\(false\)/,
    "the UI must track whether a schedule list has loaded successfully"
  );

  const successfulLoadTransitions = source.match(
    /setSchedules\(body\.items\);\s*setHasLoadedSchedules\(true\);/g
  );
  assert.equal(
    successfulLoadTransitions?.length,
    2,
    "both initial load and reload should reveal list/empty states only after a valid response"
  );
  assert.match(
    source,
    /setScheduleLoadErrorText\(error instanceof Error \? error\.message : "Failed to load schedules\."\)/,
    "failed loads must populate the dedicated error state"
  );
  assert.match(source, /role="alert"/, "the dedicated load error must be surfaced accessibly");
  assert.match(source, /Schedules could not be loaded/, "initial load failure must be named explicitly");
  assert.match(source, /Schedules could not be refreshed/, "refresh failure must be named explicitly");
  assert.match(source, /onClick=\{handleRetryScheduleLoad\}/, "load failures must offer a retry path");

  const gatedListIndex = source.indexOf('className="scheduled-jobs-columns" hidden={!hasLoadedSchedules}');
  const personalEmptyIndex = source.indexOf("No personal schedules yet.");
  const sharedEmptyIndex = source.indexOf("No shared schedules yet.");

  assert.notEqual(gatedListIndex, -1, "schedule lists and empty states must be gated by successful loading");
  assert.ok(personalEmptyIndex > gatedListIndex, "personal empty state must live inside the successful-load gate");
  assert.ok(sharedEmptyIndex > gatedListIndex, "shared empty state must live inside the successful-load gate");
  assert.equal(source.match(/No personal schedules yet\./g)?.length, 1);
  assert.equal(source.match(/No shared schedules yet\./g)?.length, 1);
});
