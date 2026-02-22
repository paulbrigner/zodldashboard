import Link from "next/link";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { readApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { hasDatabaseConfig } from "@/lib/xmonitor/config";
import { getPostDetail } from "@/lib/xmonitor/repository";
import type { PostDetail } from "@/lib/xmonitor/types";

export const runtime = "nodejs";

type PostPageProps = {
  params: Promise<{ statusId: string }>;
};

function buildPostApiUrl(baseUrl: string, statusId: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${normalizedBase}/posts/${encodeURIComponent(statusId)}`);
  return url.toString();
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // fall through
  }
  return `API request failed (${response.status})`;
}

async function fetchPostDetailViaApi(baseUrl: string, statusId: string): Promise<PostDetail | null> {
  const response = await fetch(buildPostApiUrl(baseUrl, statusId), {
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const payload = (await response.json()) as PostDetail;
  if (!payload || !payload.post || !Array.isArray(payload.snapshots)) {
    throw new Error("Invalid post detail response payload");
  }

  return payload;
}

export default async function PostPage({ params }: PostPageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect("/signin");
  }

  const { statusId } = await params;
  if (!statusId) {
    notFound();
  }

  let detail: PostDetail | null = null;
  let detailError: string | null = null;

  const apiBaseUrl = readApiBaseUrl();
  if (apiBaseUrl) {
    try {
      detail = await fetchPostDetailViaApi(apiBaseUrl, statusId);
    } catch (error) {
      detailError = error instanceof Error ? error.message : "Failed to load post detail";
    }
  } else if (hasDatabaseConfig()) {
    try {
      detail = await getPostDetail(statusId);
    } catch (error) {
      detailError = error instanceof Error ? error.message : "Failed to load post detail";
    }
  } else {
    detailError = "No detail backend configured. Set XMONITOR_READ_API_BASE_URL/XMONITOR_BACKEND_API_BASE_URL or DATABASE_URL/PG*.";
  }

  if (detailError) {
    return (
      <main className="page">
        <section className="card">
          <p className="eyebrow">XMonitor Stream A</p>
          <h1>Post detail</h1>
          <p className="error-text">{detailError}</p>
          <div className="button-row">
            <Link className="button button-secondary" href="/">
              Back to feed
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (!detail) {
    notFound();
  }

  return (
    <main className="page detail-page">
      <section className="card detail-card">
        <p className="eyebrow">Post detail</p>
        <h1>@{detail.post.author_handle}</h1>

        <p className="subtle-text">Discovered: {new Date(detail.post.discovered_at).toLocaleString()}</p>
        <p>{detail.post.body_text || "(no text captured)"}</p>

        <div className="feed-tags">
          <span className="pill">status_id: {detail.post.status_id}</span>
          <span className="pill">tier: {detail.post.watch_tier || "-"}</span>
          <span className="pill">significant: {detail.post.is_significant ? "true" : "false"}</span>
          <span className="pill">likes: {detail.post.likes}</span>
          <span className="pill">reposts: {detail.post.reposts}</span>
          <span className="pill">replies: {detail.post.replies}</span>
          <span className="pill">views: {detail.post.views}</span>
        </div>

        <div className="button-row">
          <a className="button" href={detail.post.url} rel="noreferrer" target="_blank">
            Open on X
          </a>
          <Link className="button button-secondary" href="/">
            Back to feed
          </Link>
        </div>

        <section className="detail-block">
          <h2>Metrics snapshots</h2>
          {detail.snapshots.length === 0 ? (
            <p className="subtle-text">No snapshots recorded.</p>
          ) : (
            <div className="snapshot-list">
              {detail.snapshots.map((snapshot) => (
                <article className="snapshot-row" key={`${snapshot.snapshot_type}:${snapshot.snapshot_at}`}>
                  <p>
                    <strong>{snapshot.snapshot_type}</strong> at {new Date(snapshot.snapshot_at).toLocaleString()}
                  </p>
                  <p className="subtle-text">
                    likes {snapshot.likes} | reposts {snapshot.reposts} | replies {snapshot.replies} | views {snapshot.views}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="detail-block">
          <h2>Report state</h2>
          {detail.report ? (
            <div className="report-box">
              <p>
                <strong>Reported:</strong> {new Date(detail.report.reported_at).toLocaleString()}
              </p>
              <p>
                <strong>Channel:</strong> {detail.report.channel || "-"}
              </p>
              <p>
                <strong>Destination:</strong> {detail.report.destination || "-"}
              </p>
              <p>
                <strong>Summary:</strong> {detail.report.summary || "-"}
              </p>
            </div>
          ) : (
            <p className="subtle-text">This post has not been marked as reported.</p>
          )}
        </section>
      </section>
    </main>
  );
}
