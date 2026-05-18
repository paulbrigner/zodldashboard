import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readZodlRoadmapHtml } from "@/lib/private-dashboard-content";
import { recordZodlRoadmapAccess } from "@/lib/roadmap-access-events";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHtmlHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
};

function missingRoadmapHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex" />
    <title>Zodl Roadmap unavailable</title>
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
      <h1>Zodl Roadmap content is not configured</h1>
      <p>The private HTML file was not found in the configured roadmap content path.</p>
    </main>
  </body>
</html>`;
}

export async function GET() {
  const viewer = await requireAuthenticatedViewer("/zodl-roadmap");
  const requestHeaders = await headers();

  if (viewer.accessLevel === "guest") {
    await recordZodlRoadmapAccess({
      viewer,
      outcome: "denied_guest",
      statusCode: 302,
      headers: requestHeaders,
    });
    redirect("/");
  }

  const html = await readZodlRoadmapHtml();

  if (!html) {
    await recordZodlRoadmapAccess({
      viewer,
      outcome: "content_missing",
      statusCode: 503,
      headers: requestHeaders,
    });
    return new Response(missingRoadmapHtml(), {
      status: 503,
      headers: privateHtmlHeaders,
    });
  }

  await recordZodlRoadmapAccess({
    viewer,
    outcome: "allowed",
    statusCode: 200,
    headers: requestHeaders,
  });

  return new Response(html, {
    headers: privateHtmlHeaders,
  });
}
