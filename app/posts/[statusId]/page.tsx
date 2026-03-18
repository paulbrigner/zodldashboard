import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedViewer } from "@/lib/viewer-auth";
import { readApiBaseUrl } from "@/lib/xmonitor/backend-api";
import { hasDatabaseConfig } from "@/lib/xmonitor/config";
import { getPostDetail } from "@/lib/xmonitor/repository";
import type { PostDetail } from "@/lib/xmonitor/types";
import { LocalDateTime } from "@/app/components/local-date-time";

export const runtime = "nodejs";

type PostPageProps = {
  params: Promise<{ statusId: string }>;
};

function formatFollowersCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Not captured yet";
  return new Intl.NumberFormat("en-US").format(value);
}

function describeAccountAge(iso: string | null | undefined): string {
  if (!iso) return "Not captured yet";
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime())) return "Not captured yet";

  const diffMs = Date.now() - createdAt.getTime();
  if (diffMs < 0) return "Not captured yet";

  const dayMs = 24 * 60 * 60 * 1000;
  const totalDays = Math.max(1, Math.floor(diffMs / dayMs));
  if (totalDays < 30) return `${totalDays} day${totalDays === 1 ? "" : "s"} old`;

  const totalMonths = Math.floor(totalDays / 30);
  if (totalMonths < 24) return `${totalMonths} month${totalMonths === 1 ? "" : "s"} old`;

  const totalYears = Math.floor(totalDays / 365);
  return `${totalYears} year${totalYears === 1 ? "" : "s"} old`;
}

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
  if (!payload || !payload.post) {
    throw new Error("Invalid post detail response payload");
  }

  return payload;
}

export default async function PostPage({ params }: PostPageProps) {
  await requireAuthenticatedViewer("/posts");

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
          <p className="eyebrow">ZODL Team Dashboards</p>
          <h1>Post detail</h1>
          <p className="error-text">{detailError}</p>
          <div className="button-row">
            <Link className="button button-secondary" href="/x-monitor">
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

        <p className="subtle-text">
          Discovered: <LocalDateTime iso={detail.post.discovered_at} />
        </p>
        <p className="detail-post-body">{detail.post.body_text || "(no text captured)"}</p>

        <div className="feed-tags">
          <span className="pill">status_id: {detail.post.status_id}</span>
          <span className="pill">tier: {detail.post.watch_tier || "-"}</span>
          <span className="pill">classification: {detail.post.classification_status}</span>
          <span className="pill">significant: {detail.post.classification_status === "classified" ? String(detail.post.is_significant) : "-"}</span>
          <span className="pill">likes: {detail.post.likes}</span>
          <span className="pill">reposts: {detail.post.reposts}</span>
          <span className="pill">replies: {detail.post.replies}</span>
          <span className="pill">views: {detail.post.views}</span>
        </div>

        <section>
          <h2>Author details</h2>
          <p>
            <strong>Followers:</strong> {formatFollowersCount(detail.post.followers_count)}
          </p>
          <p>
            <strong>Account age:</strong> {describeAccountAge(detail.post.account_created_at)}
            {detail.post.account_created_at ? (
              <>
                {" "}(
                created <LocalDateTime iso={detail.post.account_created_at} />
                )
              </>
            ) : null}
          </p>
          <p>
            <strong>Location:</strong> {detail.post.author_location || "Not captured yet"}
          </p>
        </section>

        <section className="detail-section-spaced">
          <h2>Classification details</h2>
          <p>
            <strong>Reason:</strong>{" "}
            {detail.post.classification_status === "classified"
              ? detail.post.significance_reason || "No significance reason was returned."
              : "Classification pending."}
          </p>
          {detail.post.classified_at ? (
            <p>
              <strong>Classified:</strong> <LocalDateTime iso={detail.post.classified_at} />
            </p>
          ) : null}
          {detail.post.classification_model ? (
            <p>
              <strong>Model:</strong> {detail.post.classification_model}
              {typeof detail.post.classification_confidence === "number"
                ? ` (${Math.round(detail.post.classification_confidence * 100)}% confidence)`
                : ""}
            </p>
          ) : null}
        </section>

        <div className="button-row">
          <a className="button" href={detail.post.url} rel="noreferrer" target="_blank">
            Open on X
          </a>
          <Link className="button button-secondary" href="/x-monitor">
            Back to feed
          </Link>
        </div>
      </section>
    </main>
  );
}
