export type FeedCursor = {
  discovered_at: string;
  status_id: string;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function encodeFeedCursor(cursor: FeedCursor): string {
  return base64UrlEncode(JSON.stringify(cursor));
}

export function decodeFeedCursor(cursor: string): FeedCursor | null {
  try {
    const parsed = JSON.parse(base64UrlDecode(cursor)) as Partial<FeedCursor>;
    if (typeof parsed.discovered_at !== "string" || typeof parsed.status_id !== "string") {
      return null;
    }
    return { discovered_at: parsed.discovered_at, status_id: parsed.status_id };
  } catch {
    return null;
  }
}
