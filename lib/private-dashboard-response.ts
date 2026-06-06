import { readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { PrivateHtmlDashboard } from "@/lib/dashboard-catalog";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";

export const privateDashboardHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
};

const privateHtmlHeaders = {
  ...privateDashboardHeaders,
  "Content-Type": "text/html; charset=utf-8",
};

const assetContentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function missingDashboardHtml(dashboard: PrivateHtmlDashboard): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex" />
    <title>${dashboard.missingTitle}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: "Avenir Next", "Trebuchet MS", "Segoe UI", sans-serif;
        color: #0f1c3d;
        background: #f5fbff;
      }
      main {
        width: min(680px, calc(100vw - 2rem));
        border: 1px solid #c2d2f6;
        border-radius: 1rem;
        background: #ffffff;
        padding: 1.5rem;
      }
      h1 {
        margin: 0;
        font-size: 1.6rem;
      }
      p {
        color: #425582;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${dashboard.missingHeading}</h1>
      <p>${dashboard.missingBody}</p>
    </main>
  </body>
</html>`;
}

function contentTypeForPath(pathname: string): string {
  return assetContentTypes[extname(pathname).toLowerCase()] || "application/octet-stream";
}

function isPathInsideDirectory(pathname: string, directory: string): boolean {
  const relativePath = relative(directory, pathname);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !relativePath.includes(`${sep}..${sep}`);
}

function resolvePrivateAssetPath(dashboard: PrivateHtmlDashboard, assetPath: string[]): string | null {
  if (!assetPath.length || assetPath.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }

  const root = dirname(dashboard.getHtmlPath());
  const resolvedAssetPath = resolve(root, ...assetPath);
  return isPathInsideDirectory(resolvedAssetPath, root) ? resolvedAssetPath : null;
}

export async function privateDashboardContentResponse(dashboard: PrivateHtmlDashboard): Promise<Response> {
  const viewer = await requireAuthenticatedViewer(dashboard.href || "/");
  const requestHeaders = await headers();

  if (!dashboard.canAccess(viewer)) {
    await dashboard.recordAccess({
      viewer,
      outcome: "denied_guest",
      statusCode: 302,
      headers: requestHeaders,
    });
    redirect("/");
  }

  const html = await dashboard.readHtml();

  if (!html) {
    await dashboard.recordAccess({
      viewer,
      outcome: "content_missing",
      statusCode: 503,
      headers: requestHeaders,
    });
    return new Response(missingDashboardHtml(dashboard), {
      status: 503,
      headers: privateHtmlHeaders,
    });
  }

  await dashboard.recordAccess({
    viewer,
    outcome: "allowed",
    statusCode: 200,
    headers: requestHeaders,
  });

  return new Response(html, {
    headers: privateHtmlHeaders,
  });
}

export async function privateDashboardAssetResponse(
  dashboard: PrivateHtmlDashboard,
  assetPath: string[]
): Promise<Response> {
  const viewer = await requireAuthenticatedViewer(dashboard.href || "/");

  if (!dashboard.canAccess(viewer)) {
    redirect("/");
  }

  const resolvedAssetPath = resolvePrivateAssetPath(dashboard, assetPath);
  if (!resolvedAssetPath) {
    return new Response("Not found", {
      status: 404,
      headers: {
        ...privateDashboardHeaders,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  try {
    const data = await readFile(resolvedAssetPath);
    return new Response(new Uint8Array(data), {
      headers: {
        ...privateDashboardHeaders,
        "Content-Type": contentTypeForPath(resolvedAssetPath),
      },
    });
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return new Response("Not found", {
        status: 404,
        headers: {
          ...privateDashboardHeaders,
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    throw error;
  }
}
