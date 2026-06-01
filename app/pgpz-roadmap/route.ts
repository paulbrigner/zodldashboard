import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readPgpzRoadmapHtml } from "@/lib/private-dashboard-content";
import { recordPgpzRoadmapAccess } from "@/lib/roadmap-access-events";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";
import { canAccessPgpzRoadmap } from "@/lib/viewer-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHtmlHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
};

function missingPgpzRoadmapHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex" />
    <title>PGPZ Roadmap unavailable</title>
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
      <h1>PGPZ Roadmap content is not configured</h1>
      <p>The private HTML file was not found in the configured PGPZ roadmap content path.</p>
    </main>
  </body>
</html>`;
}

export async function GET() {
  const viewer = await requireAuthenticatedViewer("/pgpz-roadmap");
  const requestHeaders = await headers();

  if (!canAccessPgpzRoadmap(viewer.accessLevel)) {
    await recordPgpzRoadmapAccess({
      viewer,
      outcome: "denied_guest",
      statusCode: 302,
      headers: requestHeaders,
    });
    redirect("/");
  }

  const html = await readPgpzRoadmapHtml();

  if (!html) {
    await recordPgpzRoadmapAccess({
      viewer,
      outcome: "content_missing",
      statusCode: 503,
      headers: requestHeaders,
    });
    return new Response(missingPgpzRoadmapHtml(), {
      status: 503,
      headers: privateHtmlHeaders,
    });
  }

  await recordPgpzRoadmapAccess({
    viewer,
    outcome: "allowed",
    statusCode: 200,
    headers: requestHeaders,
  });

  return new Response(html, {
    headers: privateHtmlHeaders,
  });
}
